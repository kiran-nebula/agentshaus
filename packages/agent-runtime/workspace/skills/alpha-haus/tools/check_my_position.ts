/**
 * OpenClaw tool: check_my_position
 *
 * Checks the agent's current competitive position in this epoch.
 * Returns tip/burn counts, whether agent holds TOP ALPHA or TOP BURNER,
 * and estimated rewards if the epoch ended now.
 */

import { findCurrentEpochStatus, fetchAgentState, fetchAgentWalletBalance } from '@agents-haus/sdk';
import { lamportsToSol, formatSol } from '@agents-haus/common';
import {
  getRpc,
  getSoulMint,
  getAgentWalletPda,
  getAgentStatePda,
  getExecutorAddress,
} from '../../../../src/env';

export async function checkMyPosition() {
  try {
    const rpc = getRpc();
    const soulMint = getSoulMint();
    const executorAddress = await getExecutorAddress();
    const [agentWallet] = await getAgentWalletPda(soulMint);
    const alphaTipWallet = agentWallet;
    const [agentStateAddress] = await getAgentStatePda(soulMint);

    // Fetch agent state from on-chain
    const agentState = await fetchAgentState(rpc, agentStateAddress);
    if (!agentState) {
      return {
        error: 'Agent state account not found — agent may not be created yet',
      };
    }

    // Fetch wallet balances
    const walletBalance = await fetchAgentWalletBalance(rpc, alphaTipWallet);
    const burnWalletBalance = await fetchAgentWalletBalance(rpc, agentWallet);
    const executorBalanceResp = await rpc.getBalance(executorAddress).send();
    const executorBalance = BigInt(executorBalanceResp.value);
    const tipWalletBalanceSol = lamportsToSol(walletBalance).toFixed(4);
    const burnWalletBalanceSol = lamportsToSol(burnWalletBalance).toFixed(4);
    const executorBalanceSol = lamportsToSol(executorBalance).toFixed(6);
    const spendingWallets = {
      postMode: 'cpi',
      tipWallet: alphaTipWallet as string,
      tipWalletBalanceSol,
      burnWallet: agentWallet as string,
      burnWalletBalanceSol,
      executorFeeWallet: executorAddress as string,
      executorFeeWalletBalanceSol: executorBalanceSol,
      note:
        'ALPHA_POST_MODE=cpi: SOL tips and token burns spend from agent wallet. Executor wallet only covers transaction fees.',
    };

    // Fetch current epoch
    const epochResult = await findCurrentEpochStatus(rpc);
    if (!epochResult) {
      return {
        agentWallet: agentWallet as string,
        isActive: agentState.isActive,
        strategy: agentState.strategy,
        isTopAlpha: false,
        isTopBurner: false,
        totalTips: Number(agentState.totalTips),
        totalBurns: Number(agentState.totalBurns),
        totalSolSpent: formatSol(agentState.totalSolSpent),
        totalRewards: formatSol(agentState.totalRewards),
        epochsWonAlpha: Number(agentState.epochsWonAlpha),
        epochsWonBurner: Number(agentState.epochsWonBurner),
        currentEpoch: null,
        currentTopAlphaAmount: 0,
        currentTopBurnAmount: 0,
        walletBalance: tipWalletBalanceSol,
        postMode: 'cpi',
        alphaTipWallet: alphaTipWallet as string,
        executorWallet: executorAddress as string,
        executorBalance: executorBalanceSol,
        agentWalletBalance: burnWalletBalanceSol,
        spendingWallets,
        error: 'No active epoch found',
      };
    }

    const { status } = epochResult;
    const isTopAlpha =
      status.topAlpha !== null && status.topAlpha === alphaTipWallet;
    const isTopBurner =
      status.topBurner !== null && status.topBurner === agentWallet;

    const topAlphaHeldBy = status.topAlpha === alphaTipWallet ? 'tip_wallet' : null;
    const legacyTopAlphaByExecutor = status.topAlpha === executorAddress;

    // Estimate rewards:
    // TOP ALPHA gets ~20% of epoch token emissions
    // TOP BURNER gets ~15% of epoch token emissions
    let estimatedRewardDesc = 'none';
    if (isTopAlpha && isTopBurner) {
      estimatedRewardDesc = '~35% of epoch tokens (TOP ALPHA + TOP BURNER)';
    } else if (isTopAlpha) {
      estimatedRewardDesc = '~20% of epoch tokens (TOP ALPHA)';
    } else if (isTopBurner) {
      estimatedRewardDesc = '~15% of epoch tokens (TOP BURNER)';
    }

    // Calculate flip cost for the agent to take position
    const flipAlphaCost = status.topAlphaAmount + 1_000_000n; // + 0.001 SOL
    const flipBurnCost = status.topBurnAmount + 1_000_000n; // + 1 token (6 dec)

    return {
      agentWallet: agentWallet as string,
      isActive: agentState.isActive,
      strategy: agentState.strategy,
      isTopAlpha,
      isTopBurner,
      totalTips: Number(agentState.totalTips),
      totalBurns: Number(agentState.totalBurns),
      totalSolSpent: formatSol(agentState.totalSolSpent),
      totalRewards: formatSol(agentState.totalRewards),
      epochsWonAlpha: Number(agentState.epochsWonAlpha),
      epochsWonBurner: Number(agentState.epochsWonBurner),
      currentEpoch: Number(status.epoch),
      currentTopAlpha: status.topAlpha,
      currentTopAlphaAmount: lamportsToSol(status.topAlphaAmount).toFixed(4),
      currentTopBurner: status.topBurner,
      currentTopBurnAmount: Number(status.topBurnAmount),
      flipAlphaCostSol: lamportsToSol(flipAlphaCost).toFixed(4),
      flipBurnCostTokens: Number(flipBurnCost) / 1_000_000,
      estimatedRewards: estimatedRewardDesc,
      walletBalance: tipWalletBalanceSol,
      postMode: 'cpi',
      tipWallet: alphaTipWallet as string,
      alphaTipWallet: alphaTipWallet as string,
      executorWallet: executorAddress as string,
      executorBalance: executorBalanceSol,
      agentWalletBalance: burnWalletBalanceSol,
      spendingWallets,
      topAlphaHeldBy,
      legacyTopAlphaByExecutor,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
