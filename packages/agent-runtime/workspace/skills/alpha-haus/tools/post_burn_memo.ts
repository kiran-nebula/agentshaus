/**
 * OpenClaw tool: post_burn_memo
 *
 * Executes a token burn transaction on alpha.haus with an attached memo.
 * Requires Token-2022 compatible tokens in the agent's token account.
 *
 * @param memo - The memo text to post (max 560 characters)
 * @param amount - Burn amount in tokens (defaults to flip amount: current + 1)
 */

import type { Address } from '@solana/kit';
import { getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
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
  ALPHA_SOL_MINT,
  BURN_FLIP_TOKENS,
} from '../../../../src/env';
import { buildAndSendTransaction } from '../../../../src/tx';

const addressEncoder = getAddressEncoder();

/** Derive the associated token account for Token-2022 */
async function getAssociatedTokenAddress(
  wallet: Address,
  mint: Address,
): Promise<Address> {
  const ASSOCIATED_TOKEN_PROGRAM_ID =
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address;
  const [ata] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ID,
    seeds: [
      addressEncoder.encode(wallet),
      addressEncoder.encode(TOKEN_2022_PROGRAM_ID),
      addressEncoder.encode(mint),
    ],
  });
  return ata;
}

export async function postBurnMemo(params: { memo: string; amount?: number }) {
  const { memo, amount } = params;

  if (memo.length > 560) {
    return { success: false, error: 'Memo exceeds 560 character limit' };
  }

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

    // Derive agent's token account (Token-2022 ATA for ALPHA_SOL_MINT)
    const agentTokenAccount = await getAssociatedTokenAddress(
      agentWallet,
      ALPHA_SOL_MINT,
    );

    // Check token balance
    try {
      const tokenInfo = await rpc
        .getTokenAccountBalance(agentTokenAccount)
        .send();
      const tokenBalance = BigInt(tokenInfo.value.amount);
      if (tokenBalance < burnAmount) {
        return {
          success: false,
          error: `Insufficient token balance: have ${tokenBalance}, need ${burnAmount}`,
        };
      }
    } catch {
      return {
        success: false,
        error: 'Agent token account does not exist — no tokens to burn',
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
        tokenMint: ALPHA_SOL_MINT,
        wasTopBurner,
        alphaHausProgram: ALPHA_HAUS_PROGRAM_ID,
        token2022Program: TOKEN_2022_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM,
      },
      {
        currEpoch: epoch,
        burnEpoch: epoch,
        burnAmount,
        memo,
        taggedAddresses: [],
      },
    );

    const signature = await buildAndSendTransaction([ix]);

    return {
      success: true,
      signature,
      epoch: Number(epoch),
      burnAmount: Number(burnAmount) / 1_000_000,
      memo,
    };
  } catch (err) {
    return {
      success: false,
      signature: null as string | null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
