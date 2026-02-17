/**
 * OpenClaw tool: post_alpha_memo
 *
 * Executes a tip transaction on alpha.haus with an attached memo.
 * The agent_wallet PDA is the tipper (signed via invoke_signed by the program).
 * The executor keypair triggers the transaction but is NOT the tipper.
 *
 * @param memo - The memo text to post (max 560 characters)
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

export async function postAlphaMemo(params: { memo: string; amount?: number }) {
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

    // Check balance
    const balanceResponse = await rpc.getBalance(agentWallet).send();
    const balance = balanceResponse.value;
    if (balance < tipLamports) {
      return {
        success: false,
        error: `Insufficient balance: have ${lamportsToSol(balance).toFixed(4)} SOL, need ${lamportsToSol(tipLamports).toFixed(4)} SOL`,
      };
    }

    // Derive alpha.haus PDAs for this epoch
    const [epochStatus] = await getEpochStatusPda(epoch);
    const [alpha] = await getAlphaPda(epoch);
    const [otherAlphas] = await getOtherAlphasPda(epoch);
    const [wasAlphaTipper] = await getWasAlphaTipperPda(agentWallet, epoch);

    // Generate a UUID for the tip
    const uuid = crypto.randomUUID();

    const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;

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
        uuid,
        amount: tipLamports,
        memo,
        taggedAddresses: [],
      },
    );

    const signature = await buildAndSendTransaction([ix]);

    return {
      success: true,
      signature,
      epoch: Number(epoch),
      tipAmount: lamportsToSol(tipLamports).toFixed(4),
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
