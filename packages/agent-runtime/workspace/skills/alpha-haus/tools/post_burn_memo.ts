/**
 * OpenClaw tool: post_burn_memo
 *
 * Executes a token burn transaction on alpha.haus with an attached memo.
 * Requires Token-2022 compatible tokens in the agent's token account.
 *
 * @param memo - The memo text to post (max 300 characters)
 * @param amount - Burn amount in tokens (defaults to flip amount: current + 1)
 */

import type { Address } from '@solana/kit';
import { findCurrentEpochStatus, createAgentBurnInstruction } from '@agents-haus/sdk';
import {
  getRpc,
  getSoulMint,
  getAgentWalletPda,
  getAgentStatePda,
  getExecutorAddress,
  getEpochStatusPda,
  getTopBurnerPda,
  getOtherBurnersPda,
  getWasTopBurnerPda,
  ALPHA_HAUS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  BURN_FLIP_TOKENS,
} from '../../../../src/env';
import { buildAndSendTransaction } from '../../../../src/tx';

const SAFE_MEMO_CHAR_LIMIT = 300;

export async function postBurnMemo(params: { memo: string; amount?: number }) {
  const { memo, amount } = params;
  const normalizedMemo = memo.trim();
  if (!normalizedMemo) return { success: false, error: 'Memo cannot be empty' };
  const finalMemo =
    normalizedMemo.length > SAFE_MEMO_CHAR_LIMIT
      ? normalizedMemo.slice(0, SAFE_MEMO_CHAR_LIMIT).trim()
      : normalizedMemo;
  const memoTruncated = finalMemo.length !== normalizedMemo.length;

  try {
    const rpc = getRpc();
    const soulMint = getSoulMint();
    const executor = await getExecutorAddress();
    const [agentWallet] = await getAgentWalletPda(soulMint);
    const [agentState] = await getAgentStatePda(soulMint);

    // Fetch current epoch
    const epochResult = await findCurrentEpochStatus(rpc);
    if (!epochResult) {
      return { success: false, error: 'No active epoch found' };
    }

    const epoch = epochResult.status.epoch;
    const currentTopBurn = epochResult.status.topBurnAmount;

    // Calculate burn amount
    let burnAmount: bigint;
    if (amount !== undefined) {
      burnAmount = BigInt(Math.round(amount * 1_000_000)); // 6 decimals
    } else {
      burnAmount = currentTopBurn + BURN_FLIP_TOKENS;
    }

    // Find the agent's epoch token account by scanning Token-2022 accounts.
    // Any epoch token from the alpha.haus program is valid for burns.
    type TokenAccountEntry = {
      pubkey: Address;
      account: {
        data: { parsed: { info: { mint: string; tokenAmount: { amount: string } } } };
      };
    };
    const tokenAccounts = await (rpc as any)
      .getTokenAccountsByOwner(
        agentWallet,
        { programId: TOKEN_2022_PROGRAM_ID },
        { encoding: 'jsonParsed' },
      )
      .send();

    const entries: TokenAccountEntry[] = tokenAccounts?.value ?? [];
    // Pick the account with the highest balance
    let bestAccount: { address: Address; mint: Address; balance: bigint } | null = null;
    for (const entry of entries) {
      try {
        const info = entry.account.data.parsed.info;
        const balance = BigInt(info.tokenAmount.amount);
        if (balance > 0n && (!bestAccount || balance > bestAccount.balance)) {
          bestAccount = {
            address: entry.pubkey,
            mint: info.mint as Address,
            balance,
          };
        }
      } catch {
        // skip malformed entries
      }
    }

    if (!bestAccount) {
      return {
        success: false,
        error: 'No epoch tokens found in agent wallet — send epoch tokens to the agent PDA before burning',
      };
    }

    const agentTokenAccount = bestAccount.address;
    const tokenMint = bestAccount.mint;
    const tokenBalance = bestAccount.balance;

    if (tokenBalance < burnAmount) {
      return {
        success: false,
        error: `Insufficient token balance: have ${tokenBalance}, need ${burnAmount}`,
      };
    }

    // Derive alpha.haus burn PDAs
    const [epochStatus] = await getEpochStatusPda(epoch);
    const [topBurner] = await getTopBurnerPda(epoch);
    const [otherBurners] = await getOtherBurnersPda(epoch);
    const [wasTopBurner] = await getWasTopBurnerPda(agentWallet, epoch);

    const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;

    const ix = createAgentBurnInstruction(
      {
        executor,
        agentState,
        agentWallet,
        epochStatus,
        topBurner,
        otherBurners,
        agentTokenAccount,
        tokenMint,
        wasTopBurner,
        alphaHausProgram: ALPHA_HAUS_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM,
      },
      {
        currEpoch: epoch,
        burnEpoch: epoch,
        burnAmount,
        memo: finalMemo,
        taggedAddresses: [],
      },
    );

    const signature = await buildAndSendTransaction([ix]);

    return {
      success: true,
      signature,
      epoch: Number(epoch),
      burnAmount: Number(burnAmount) / 1_000_000,
      memo: finalMemo,
      memoTruncated,
    };
  } catch (err) {
    return {
      success: false,
      signature: null as string | null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
