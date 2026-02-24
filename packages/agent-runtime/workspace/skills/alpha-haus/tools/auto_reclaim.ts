/**
 * OpenClaw tool: auto_reclaim
 *
 * Two functions:
 * 1. If the agent was flipped from TOP ALPHA or TOP BURNER, and auto-reclaim
 *    is enabled (strategy != VibesPoster), re-tips or re-burns to reclaim.
 * 2. Checks for unclaimed rewards from previous epochs and claims them.
 */

import type { Address } from '@solana/kit';
import {
  findCurrentEpochStatus,
  fetchAgentState,
  fetchAgentWalletBalance,
  createAgentTipInstruction,
  createAgentBurnInstruction,
  createClaimRewardsInstruction,
} from '@agents-haus/sdk';
import { lamportsToSol } from '@agents-haus/common';
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
  getTopBurnerPda,
  getOtherBurnersPda,
  getWasTopBurnerPda,
  ALPHA_HAUS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ALPHA_SOL_MINT,
  TIP_FLIP_LAMPORTS,
  BURN_FLIP_TOKENS,
} from '../../../../src/env';
import { buildAndSendTransaction } from '../../../../src/tx';
import { getAutoReclaimMemoFromSoul } from '../../../../src/soul';

const Strategy = {
  AlphaHunter: 0,
  BurnMaximalist: 1,
  Balanced: 2,
  VibesPoster: 3,
} as const;

const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;

export async function autoReclaim() {
  const result = {
    reclaimed: false,
    reclaimType: null as 'tip' | 'burn' | null,
    reclaimAmount: 0,
    reclaimSignature: null as string | null,
    rewardsClaimed: false,
    rewardsAmount: 0,
    rewardsSignature: null as string | null,
    error: null as string | null,
  };

  try {
    const rpc = getRpc();
    const soulMint = getSoulMint();
    const executor = await getExecutorAddress();
    const [agentWallet] = await getAgentWalletPda(soulMint);
    const [agentStateAddress] = await getAgentStatePda(soulMint);

    const agentState = await fetchAgentState(rpc, agentStateAddress);
    if (!agentState) {
      result.error = 'Agent state not found';
      return result;
    }

    if (!agentState.isActive) {
      result.error = 'Agent is paused';
      return result;
    }

    const epochResult = await findCurrentEpochStatus(rpc);
    if (!epochResult) {
      result.error = 'No active epoch found';
      return result;
    }

    const { status } = epochResult;
    const epoch = status.epoch;

    // --- 1. Check if agent was flipped and needs to reclaim ---

    if (agentState.strategy !== Strategy.VibesPoster) {
      const walletBalance = await fetchAgentWalletBalance(rpc, agentWallet);

      // Check if agent was previously top alpha but got flipped
      const isNotCurrentAlpha =
        status.topAlpha === null || status.topAlpha !== agentWallet;
      const isNotCurrentBurner =
        status.topBurner === null || status.topBurner !== agentWallet;

      let shouldReclaimAlpha = false;
      let shouldReclaimBurn = false;

      if (agentState.strategy === Strategy.AlphaHunter || agentState.strategy === Strategy.Balanced) {
        // Check if agent has tipped this epoch (was_alpha_tipper PDA exists)
        try {
          const [wasAlphaTipperPda] = await getWasAlphaTipperPda(agentWallet, epoch);
          const account = await rpc
            .getAccountInfo(wasAlphaTipperPda, { encoding: 'base64' })
            .send();
          if (account.value !== null && isNotCurrentAlpha) {
            shouldReclaimAlpha = true;
          }
        } catch {
          // hasn't tipped — no reclaim needed
        }
      }

      if (agentState.strategy === Strategy.BurnMaximalist) {
        try {
          const [wasTopBurnerPda] = await getWasTopBurnerPda(agentWallet, epoch);
          const account = await rpc
            .getAccountInfo(wasTopBurnerPda, { encoding: 'base64' })
            .send();
          if (account.value !== null && isNotCurrentBurner) {
            shouldReclaimBurn = true;
          }
        } catch {
          // hasn't burned
        }
      }

      // Execute reclaim tip
      if (shouldReclaimAlpha) {
        const flipAmount = status.topAlphaAmount + TIP_FLIP_LAMPORTS;
        if (walletBalance >= flipAmount) {
          const reclaimMemo = await getAutoReclaimMemoFromSoul();
          const [epochStatus] = await getEpochStatusPda(epoch);
          const [alpha] = await getAlphaPda(epoch);
          const [otherAlphas] = await getOtherAlphasPda(epoch);
          const [wasAlphaTipper] = await getWasAlphaTipperPda(agentWallet, epoch);

          const ix = createAgentTipInstruction(
            {
              executor,
              agentState: agentStateAddress,
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
              amount: flipAmount,
              memo: reclaimMemo,
              taggedAddresses: [],
            },
          );

          const sig = await buildAndSendTransaction([ix]);
          result.reclaimed = true;
          result.reclaimType = 'tip';
          result.reclaimAmount = Number(lamportsToSol(flipAmount).toFixed(4));
          result.reclaimSignature = sig;
        } else {
          result.error = `Insufficient balance to reclaim alpha: need ${lamportsToSol(flipAmount).toFixed(4)} SOL`;
        }
      }

      // Execute reclaim burn (only if we didn't already reclaim via tip)
      if (shouldReclaimBurn && !result.reclaimed) {
        result.error =
          result.error || 'Burn reclaim not yet implemented in auto_reclaim';
      }
    }

    // --- 2. Check for unclaimed rewards from previous epochs ---

    if (epoch > 1n) {
      const prevEpoch = epoch - 1n;
      try {
        const [epochStatus] = await getEpochStatusPda(prevEpoch);
        const [wasAlphaTipper] = await getWasAlphaTipperPda(agentWallet, prevEpoch);
        const [wasTopBurner] = await getWasTopBurnerPda(agentWallet, prevEpoch);

        const epochStatusAccount = await rpc
          .getAccountInfo(epochStatus, { encoding: 'base64' })
          .send();

        if (epochStatusAccount.value !== null) {
          const balanceBefore = await fetchAgentWalletBalance(rpc, agentWallet);

          const claimIx = createClaimRewardsInstruction(
            {
              caller: executor,
              soulAsset: soulMint,
              agentState: agentStateAddress,
              agentWallet,
              epochStatus,
              wasAlphaTipper,
              wasTopBurner,
              alphaHausProgram: ALPHA_HAUS_PROGRAM_ID,
              systemProgram: SYSTEM_PROGRAM,
            },
            prevEpoch,
          );

          const sig = await buildAndSendTransaction([claimIx]);

          const balanceAfter = await fetchAgentWalletBalance(rpc, agentWallet);
          const rewardsReceived = balanceAfter - balanceBefore;

          if (rewardsReceived > 0n) {
            result.rewardsClaimed = true;
            result.rewardsAmount = Number(lamportsToSol(rewardsReceived).toFixed(4));
            result.rewardsSignature = sig;
          }
        }
      } catch {
        // No rewards to claim — normal
      }
    }

    return result;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    return result;
  }
}
