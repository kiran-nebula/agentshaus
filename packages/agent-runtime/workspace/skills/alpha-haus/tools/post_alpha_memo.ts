/**
 * OpenClaw tool: post_alpha_memo
 *
 * Executes a tip transaction on alpha.haus via agents.haus CPI.
 * The agent wallet PDA is the posting identity and tipper.
 *
 * @param memo - The memo text to post (max 300 characters)
 * @param amount - Optional tip amount in SOL (defaults to flip amount: current + 0.001)
 */

import type { Address } from '@solana/kit';
import { findCurrentEpochStatus, createAgentTipInstruction } from '@agents-haus/sdk';
import { solToLamports, lamportsToSol } from '@agents-haus/common';
import {
  getRpc,
  getSoulMint,
  getAgentWalletPda,
  getAgentStatePda,
  getExecutorAddress,
  getEpochStatusPda,
  getAlphaPda,
  getOtherAlphasPda,
  getWasAlphaTipperPda,
  ALPHA_HAUS_PROGRAM_ID,
  TIP_FLIP_LAMPORTS,
} from '../../../../src/env';
import { buildAndSendTransaction } from '../../../../src/tx';

const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;
const SAFE_MEMO_CHAR_LIMIT = 300;

export async function postAlphaMemo(params: { memo: string; amount?: number }) {
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

    // Fetch current epoch to determine tip amount
    const epochResult = await findCurrentEpochStatus(rpc);
    if (!epochResult) {
      return { success: false, error: 'No active epoch found' };
    }

    const epoch = epochResult.status.epoch;
    const currentTopAmount = epochResult.status.topAlphaAmount;

    // Calculate tip amount: user-specified or flip amount
    let tipLamports: bigint;
    if (amount !== undefined) {
      tipLamports = solToLamports(amount);
    } else {
      // Flip = current top + 0.001 SOL
      tipLamports = currentTopAmount + TIP_FLIP_LAMPORTS;
    }

    // In CPI mode, SOL tip budget must exist on the agent wallet PDA.
    const balanceResponse = await rpc.getBalance(agentWallet).send();
    const balance = BigInt(balanceResponse.value);
    if (balance < tipLamports) {
      return {
        success: false,
        error:
          `Insufficient agent wallet balance for tip: wallet ${agentWallet} has ${lamportsToSol(balance).toFixed(4)} SOL, ` +
          `needs ${lamportsToSol(tipLamports).toFixed(4)} SOL`,
        postMode: 'cpi',
        tipWallet: agentWallet as string,
        tipWalletBalanceSol: lamportsToSol(balance).toFixed(6),
        requiredTipSol: lamportsToSol(tipLamports).toFixed(6),
        agentWallet: agentWallet as string,
        executorWallet: executor as string,
      };
    }

    // Derive agents.haus / alpha.haus PDAs for this epoch.
    const [epochStatus] = await getEpochStatusPda(epoch);
    const [alpha] = await getAlphaPda(epoch);
    const [otherAlphas] = await getOtherAlphasPda(epoch);
    const [wasAlphaTipper] = await getWasAlphaTipperPda(agentWallet, epoch);
    const [agentState] = await getAgentStatePda(soulMint);

    const ix = createAgentTipInstruction(
      {
        executor,
        agentState,
        agentWallet,
        epochStatus,
        alpha,
        otherAlphas,
        wasAlphaTipper,
        alphaHausProgram: ALPHA_HAUS_PROGRAM_ID,
        systemProgram: SYSTEM_PROGRAM,
      },
      {
        epoch,
        uuid: crypto.randomUUID(),
        amount: tipLamports,
        memo: finalMemo,
        taggedAddresses: [] as Address[],
      },
    );

    const signature = await buildAndSendTransaction([ix]);

    return {
      success: true,
      signature,
      postMode: 'cpi',
      epoch: Number(epoch),
      tipAmount: lamportsToSol(tipLamports).toFixed(4),
      tipWallet: agentWallet as string,
      identityWallet: agentWallet as string,
      agentWallet: agentWallet as string,
      executorWallet: executor as string,
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
