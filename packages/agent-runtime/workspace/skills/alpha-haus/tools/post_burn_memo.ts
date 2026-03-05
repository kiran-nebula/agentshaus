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
  BURN_FLIP_TOKENS,
} from '../../../../src/env';
import { buildAndSendTransaction } from '../../../../src/tx';

const addressEncoder = getAddressEncoder();

/** Derive the epoch token mint PDA: seeds = ["epoch_token_mint", epoch_le_bytes] */
async function getEpochTokenMint(epoch: bigint): Promise<Address> {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  const [addr] = await getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [new TextEncoder().encode('epoch_token_mint'), epochBytes],
  });
  return addr;
}

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

    // Scan all Token-2022 accounts in the agent wallet to find epoch tokens.
    // The alpha.haus program enforces that token_mint is a PDA derived from
    // ["epoch_token_mint", burn_epoch]. We accept tokens from ANY epoch.
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
    // Build a map of mint -> { address, balance } for tokens with balances
    const mintMap = new Map<string, { address: Address; balance: bigint }>();
    for (const entry of entries) {
      try {
        const info = entry.account.data.parsed.info;
        const balance = BigInt(info.tokenAmount.amount);
        if (balance > 0n) {
          mintMap.set(info.mint, { address: entry.pubkey, balance });
        }
      } catch {
        // skip malformed entries
      }
    }

    if (mintMap.size === 0) {
      return {
        success: false,
        error: `No epoch tokens found in agent wallet. Send epoch tokens to the agent PDA: ${agentWallet}`,
      };
    }

    // Match wallet mints to epoch PDAs: check current epoch first, then scan backwards.
    let burnEpoch: bigint | null = null;
    let tokenMint: Address | null = null;
    let agentTokenAccount: Address | null = null;
    let tokenBalance = 0n;

    // Try current epoch first (most common), then backwards up to 200 epochs
    const searchStart = epoch;
    const searchEnd = epoch > 200n ? epoch - 200n : 1n;
    for (let e = searchStart; e >= searchEnd; e--) {
      const candidateMint = await getEpochTokenMint(e);
      const found = mintMap.get(candidateMint as string);
      if (found && found.balance >= burnAmount) {
        burnEpoch = e;
        tokenMint = candidateMint;
        agentTokenAccount = found.address;
        tokenBalance = found.balance;
        break;
      }
    }

    if (!burnEpoch || !tokenMint || !agentTokenAccount) {
      // List what we found for a helpful error
      const currentMint = await getEpochTokenMint(epoch);
      const walletMints = [...mintMap.entries()]
        .map(([m, v]) => `${m} (balance: ${v.balance})`)
        .join(', ');
      return {
        success: false,
        error: `No usable epoch tokens with sufficient balance (need ${burnAmount}). Wallet has: ${walletMints}. Current epoch ${epoch} mint: ${currentMint}. Send epoch tokens to the agent PDA: ${agentWallet}`,
      };
    }

    // Derive alpha.haus burn PDAs — competition PDAs use the CURRENT epoch,
    // but burn_epoch + token_mint correspond to the epoch whose tokens we burn.
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
        burnEpoch: burnEpoch,
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
      burnEpoch: Number(burnEpoch),
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
