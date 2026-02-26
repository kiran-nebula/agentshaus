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
import { startGateway } from './gateway';
import { loadRuntimeSchedulerConfig, RuntimeScheduler } from './scheduler';
import { hydrateSoulTemplateFromEnv } from './soul';
import { loadTelegramBridgeConfigFromEnv, TelegramBridge } from './telegram';

const REQUIRED_ENV_VARS = [
  'SOLANA_RPC_URL',
  'EXECUTOR_KEYPAIR',
  'SOUL_MINT_ADDRESS',
];

function parseCsvEnv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

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

  await hydrateSoulTemplateFromEnv();

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
  const profileId = (process.env.AGENT_PROFILE_ID || 'alpha-hunter').trim();
  const configuredSkills = parseCsvEnv(process.env.AGENT_SKILLS);
  const explicitSkills = new Set(configuredSkills);
  const alphaHausEnabled =
    explicitSkills.size === 0 || explicitSkills.has('alpha-haus');

  console.log('---');
  console.log(`Soul Mint:  ${soulMint}`);
  console.log(`Executor:   ${executor}`);
  console.log(`Strategy:   ${strategyLabel}`);
  console.log(`Profile:    ${profileId}`);
  console.log(`Skills:     ${configuredSkills.join(',') || 'alpha-haus (default)'}`);
  console.log(`Model:      ${(process.env.AGENT_MODEL || 'moonshotai/kimi-k2.5').trim()}`);
  console.log(`Active:     ${agentState.isActive}`);
  console.log(`Version:    ${agentState.agentVersion}`);
  console.log('---');

  if (!agentState.isActive) {
    console.warn('Agent is paused. Waiting for activation...');
  }

  const heartbeatStatus = {
    enabled: alphaHausEnabled,
    intervalSeconds: 60,
    lastRunAt: null as string | null,
    lastError: null as string | null,
  };

  if (alphaHausEnabled) {
    // Heartbeat: check epoch state periodically for alpha.haus agents.
    const HEARTBEAT_INTERVAL_MS = 60_000;

    async function heartbeat() {
      heartbeatStatus.lastRunAt = new Date().toISOString();
      try {
        const { checkEpochState } = await import(
          '../workspace/skills/alpha-haus/tools/check_epoch_state'
        );
        const state = await checkEpochState();
        heartbeatStatus.lastError = null;
        console.log(
          `[heartbeat] epoch=${state.epoch} alpha=${state.agentIsAlpha} burner=${state.agentIsBurner} tipped=${state.agentHasTipped}`,
        );
      } catch (err) {
        heartbeatStatus.lastError = err instanceof Error ? err.message : String(err);
        console.error('[heartbeat] error:', err);
      }
    }

    await heartbeat();
    setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    console.log(`Heartbeat running every ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  } else {
    heartbeatStatus.enabled = false;
    console.log('Heartbeat disabled (alpha-haus skill not enabled).');
  }

  const scheduler = new RuntimeScheduler(
    loadRuntimeSchedulerConfig(alphaHausEnabled),
  );
  scheduler.start();
  const telegramBridge = new TelegramBridge(loadTelegramBridgeConfigFromEnv());

  const shutdown = (signal: string) => {
    console.log(`[runtime] received ${signal}, shutting down`);
    telegramBridge.stop();
    scheduler.stop();
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Start the chat gateway HTTP server
  startGateway({
    getRuntimeStatus: () => ({
      heartbeat: heartbeatStatus,
      scheduler: scheduler.getSnapshot(),
      telegram: telegramBridge.getSnapshot(),
    }),
  });
  telegramBridge.start();

  console.log('Agent runtime ready.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
