/**
 * agents.haus Agent Runtime
 *
 * This is the entry point for the OpenClaw-based agent runtime.
 * Each agent instance runs as an isolated process with its own
 * SOUL.md identity, alpha-haus skill tools, and heartbeat monitoring.
 *
 * Default LLM: Kimi K2.5 via OpenRouter (moonshotai/kimi-k2.5)
 */

import { fetchAgentState } from '@agents-haus/sdk';
import { STRATEGY_LABELS, type Strategy } from '@agents-haus/common';
import { getRpc, getSoulMint, getAgentStatePda, getExecutorAddress } from './env';

// Re-export tools for OpenClaw registration
export { checkEpochState } from '../workspace/skills/alpha-haus/tools/check_epoch_state';
export { postAlphaMemo } from '../workspace/skills/alpha-haus/tools/post_alpha_memo';
export { postBurnMemo } from '../workspace/skills/alpha-haus/tools/post_burn_memo';
export { checkMyPosition } from '../workspace/skills/alpha-haus/tools/check_my_position';
export { autoReclaim } from '../workspace/skills/alpha-haus/tools/auto_reclaim';

const REQUIRED_ENV_VARS = [
  'SOLANA_RPC_URL',
  'EXECUTOR_KEYPAIR',
  'SOUL_MINT_ADDRESS',
];

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function main() {
  console.log('agents.haus runtime starting...');

  // Validate environment
  validateEnv();

  const rpc = getRpc();
  const soulMint = getSoulMint();
  const executor = await getExecutorAddress();
  const [agentStateAddress] = await getAgentStatePda(soulMint);

  // Fetch on-chain agent state
  const agentState = await fetchAgentState(rpc, agentStateAddress);
  if (!agentState) {
    console.error(`Agent state not found for soul mint: ${soulMint}`);
    console.error('Has the agent been created on-chain?');
    process.exit(1);
  }

  const strategyLabel =
    STRATEGY_LABELS[agentState.strategy as Strategy] || `Unknown(${agentState.strategy})`;

  console.log('---');
  console.log(`Soul Mint:  ${soulMint}`);
  console.log(`Executor:   ${executor}`);
  console.log(`Strategy:   ${strategyLabel}`);
  console.log(`Active:     ${agentState.isActive}`);
  console.log(`Version:    ${agentState.agentVersion}`);
  console.log('---');

  if (!agentState.isActive) {
    console.warn('Agent is paused. Waiting for activation...');
  }

  // Heartbeat: check epoch state periodically
  const HEARTBEAT_INTERVAL_MS = 60_000; // 60 seconds

  async function heartbeat() {
    try {
      const { checkEpochState } = await import(
        '../workspace/skills/alpha-haus/tools/check_epoch_state'
      );
      const state = await checkEpochState();
      console.log(
        `[heartbeat] epoch=${state.epoch} alpha=${state.agentIsAlpha} burner=${state.agentIsBurner} tipped=${state.agentHasTipped}`,
      );
    } catch (err) {
      console.error('[heartbeat] error:', err);
    }
  }

  // Run initial heartbeat
  await heartbeat();

  // Schedule periodic heartbeat
  setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);

  console.log(`Heartbeat running every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  console.log('Agent runtime ready. Waiting for OpenClaw gateway calls...');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
