import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { createSolanaRpc, createKeyPairFromBytes, getAddressFromPublicKey } from '@solana/kit';
import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';
import { getAgentStatePda, fetchAgentState } from '@agents-haus/sdk';
import { getFlyClient } from '@/lib/fly-machines';
import {
  normalizeRuntimeProvider,
  type RuntimeProvider,
} from '@/lib/runtime-provider';

let rpc: Rpc<SolanaRpcApi> | null = null;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHA_RUNTIME_PROFILES = new Set([
  'alpha-hunter',
  'burn-maximalist',
  'balanced',
  'vibes-poster',
]);
const MAX_RUNTIME_SOUL_TEXT_LENGTH = 4_000;
const MAX_POSTING_TOPICS = 12;
const MAX_POSTING_TOPIC_LENGTH = 80;
const MAX_GROK_API_KEY_LENGTH = 600;
const MAX_RUNTIME_CONFIG_LENGTH = 4_000;
const MAX_RUNTIME_MODEL_LENGTH = 200;
const MAX_RUNTIME_HOST_LENGTH = 200;
const MAX_GATEWAY_AUTH_TOKEN_LENGTH = 600;
const MAX_TELEGRAM_BOT_TOKEN_LENGTH = 700;
const MAX_TELEGRAM_CHAT_IDS_LENGTH = 2_000;
const IRONCLAW_LLM_BACKENDS = new Set([
  'nearai',
  'openai',
  'anthropic',
  'ollama',
  'openai_compatible',
  'tinfoil',
]);

type IronclawRuntimeConfigResult =
  | {
      env: Record<string, string>;
      error?: undefined;
    }
  | {
      env?: undefined;
      error: string;
    };

function getRpc(): Rpc<SolanaRpcApi> {
  if (!rpc) {
    rpc = createSolanaRpc(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!);
  }
  return rpc;
}

function decodeBase58(value: string): Uint8Array {
  let num = BigInt(0);
  for (const char of value) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('executorKeypair contains invalid base58 characters');
    }
    num = num * BigInt(58) + BigInt(idx);
  }

  const bytes: number[] = [];
  while (num > BigInt(0)) {
    bytes.push(Number(num % BigInt(256)));
    num /= BigInt(256);
  }
  bytes.reverse();

  let leadingZeros = 0;
  for (const char of value) {
    if (char === '1') {
      leadingZeros += 1;
    } else {
      break;
    }
  }

  return new Uint8Array([
    ...new Array(leadingZeros).fill(0),
    ...bytes,
  ]);
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function parseIntInRange(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const candidate =
    typeof value === 'number'
      ? Math.trunc(value)
      : typeof value === 'string'
        ? Number.parseInt(value.trim(), 10)
        : NaN;

  if (!Number.isFinite(candidate)) return null;
  return Math.max(min, Math.min(max, candidate));
}

function normalizeRuntimeSoulText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, MAX_RUNTIME_SOUL_TEXT_LENGTH);
}

function normalizeRuntimeSecret(
  value: unknown,
  maxLength = MAX_GROK_API_KEY_LENGTH,
): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, maxLength);
}

function normalizePostingTopic(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/\r/g, '')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_POSTING_TOPIC_LENGTH);
  return normalized || null;
}

function normalizePostingTopics(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];

  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const entry of values) {
    const normalized = normalizePostingTopic(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
    if (deduped.length >= MAX_POSTING_TOPICS) break;
  }

  return deduped;
}

function parsePostingTopicsFromEnv(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      return normalizePostingTopics(JSON.parse(trimmed));
    } catch {
      // Fall back to delimiter parsing.
    }
  }

  return normalizePostingTopics(trimmed.split(/[|,]/));
}

function normalizeTelegramChatIds(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[|,\n]/)
      : [];

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const entry of values) {
    if (typeof entry !== 'string' && typeof entry !== 'number') continue;
    const normalized = String(entry)
      .replace(/\r/g, '')
      .replace(/\u0000/g, '')
      .trim()
      .slice(0, 64);
    if (!normalized) continue;
    if (!/^-?\d+$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  return deduped.slice(0, 24);
}

function parseTelegramChatIdsFromEnv(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  return normalizeTelegramChatIds(trimmed);
}

async function deriveExecutorAddress(executorKeypair: string): Promise<string> {
  const raw = executorKeypair.trim();
  const bytes = raw.startsWith('[')
    ? new Uint8Array(JSON.parse(raw))
    : decodeBase58(raw);
  const kp = await createKeyPairFromBytes(bytes);
  const address = await getAddressFromPublicKey(kp.publicKey);
  return address as string;
}

function getSharedExecutorKeypair(): string {
  const raw = (
    process.env.RUNTIME_EXECUTOR_KEYPAIR ||
    process.env.EXECUTOR_KEYPAIR ||
    ''
  ).trim();

  if (!raw) {
    throw new Error('RUNTIME_EXECUTOR_KEYPAIR is not configured');
  }

  return raw;
}

async function waitForAgentState(
  connection: Rpc<SolanaRpcApi>,
  soulMint: Address,
  maxAttempts = 6,
): Promise<Awaited<ReturnType<typeof fetchAgentState>>> {
  const [agentStateAddr] = await getAgentStatePda(soulMint);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const state = await fetchAgentState(connection, agentStateAddr);
    if (state) return state;
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return null;
}

function getRuntimeImage(appName: string, runtimeProvider: RuntimeProvider): string {
  if (runtimeProvider === 'ironclaw') {
    const ironclawImage = (process.env.FLY_IRONCLAW_RUNTIME_IMAGE || '').trim();
    if (ironclawImage) return ironclawImage;
    const defaultImage = (process.env.FLY_RUNTIME_IMAGE || '').trim();
    if (defaultImage) {
      console.warn(
        '[deploy] FLY_IRONCLAW_RUNTIME_IMAGE is not set. Falling back to FLY_RUNTIME_IMAGE for IronClaw deploys.',
      );
      return defaultImage;
    }
  }

  const configured = process.env.FLY_RUNTIME_IMAGE?.trim();
  if (configured) return configured;

  const fallback = `registry.fly.io/${appName}:latest`;
  console.warn(
    `[deploy] FLY_RUNTIME_IMAGE not set, defaulting to ${fallback}. Set FLY_RUNTIME_IMAGE to pin an exact image.`,
  );
  return fallback;
}

function resolveIronclawRuntimeConfig(
  nearAiCloudApiKey: string,
): IronclawRuntimeConfigResult {
  const databaseBackendRaw = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_DATABASE_BACKEND ||
      process.env.IRONCLAW_DATABASE_BACKEND ||
      'postgres',
    32,
  ).toLowerCase();
  const databaseBackend =
    databaseBackendRaw === 'libsql' ||
    databaseBackendRaw === 'sqlite' ||
    databaseBackendRaw === 'turso'
      ? 'libsql'
      : 'postgres';

  const databaseUrl = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_DATABASE_URL ||
      process.env.IRONCLAW_DATABASE_URL ||
      process.env.DATABASE_URL,
    MAX_RUNTIME_CONFIG_LENGTH,
  );
  const libsqlPath = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_LIBSQL_PATH ||
      process.env.IRONCLAW_LIBSQL_PATH ||
      '/home/ironclaw/.ironclaw/ironclaw.db',
    1_000,
  );
  const libsqlUrl = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_LIBSQL_URL || process.env.IRONCLAW_LIBSQL_URL,
    MAX_RUNTIME_CONFIG_LENGTH,
  );
  const libsqlAuthToken = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_LIBSQL_AUTH_TOKEN ||
      process.env.IRONCLAW_LIBSQL_AUTH_TOKEN,
    MAX_RUNTIME_CONFIG_LENGTH,
  );

  const llmBackendRaw = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_LLM_BACKEND ||
      process.env.IRONCLAW_LLM_BACKEND ||
      'nearai',
    64,
  ).toLowerCase();
  const llmBackend = IRONCLAW_LLM_BACKENDS.has(llmBackendRaw)
    ? llmBackendRaw
    : 'nearai';

  const nearAiSessionToken = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_NEARAI_SESSION_TOKEN ||
      process.env.IRONCLAW_NEARAI_SESSION_TOKEN ||
      process.env.NEARAI_SESSION_TOKEN,
    MAX_RUNTIME_CONFIG_LENGTH,
  );
  const nearAiBaseUrl =
    normalizeRuntimeSecret(
      process.env.FLY_IRONCLAW_NEARAI_BASE_URL ||
        process.env.IRONCLAW_NEARAI_BASE_URL ||
        process.env.NEARAI_BASE_URL ||
        process.env.NEAR_AI_API_BASE_URL,
      MAX_RUNTIME_CONFIG_LENGTH,
    ) || 'https://cloud-api.near.ai';
  const nearAiAuthUrl =
    normalizeRuntimeSecret(
      process.env.FLY_IRONCLAW_NEARAI_AUTH_URL ||
        process.env.IRONCLAW_NEARAI_AUTH_URL ||
        process.env.NEARAI_AUTH_URL,
      MAX_RUNTIME_CONFIG_LENGTH,
    ) || 'https://private.near.ai';
  const nearAiModel = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_NEARAI_MODEL ||
      process.env.IRONCLAW_NEARAI_MODEL ||
      process.env.NEARAI_MODEL,
    MAX_RUNTIME_MODEL_LENGTH,
  );
  const gatewayHost =
    normalizeRuntimeSecret(
      process.env.FLY_IRONCLAW_GATEWAY_HOST || process.env.IRONCLAW_GATEWAY_HOST,
      MAX_RUNTIME_HOST_LENGTH,
    ) || '0.0.0.0';
  const gatewayPort =
    parseIntInRange(
      process.env.FLY_IRONCLAW_GATEWAY_PORT || process.env.IRONCLAW_GATEWAY_PORT,
      1,
      65535,
    ) || 3001;
  const configuredGatewayAuthToken = normalizeRuntimeSecret(
    process.env.FLY_IRONCLAW_GATEWAY_AUTH_TOKEN ||
      process.env.IRONCLAW_GATEWAY_AUTH_TOKEN ||
      process.env.GATEWAY_AUTH_TOKEN,
    MAX_GATEWAY_AUTH_TOKEN_LENGTH,
  );
  const gatewayAuthToken =
    configuredGatewayAuthToken ||
    `agt_${randomBytes(24).toString('base64url').slice(0, 40)}`;

  if (databaseBackend === 'postgres' && !databaseUrl) {
    return {
      error:
        'IronClaw deploy missing database config. Set FLY_IRONCLAW_DATABASE_URL (or IRONCLAW_DATABASE_URL).',
    };
  }

  if (databaseBackend === 'libsql' && libsqlUrl && !libsqlAuthToken) {
    return {
      error:
        'IronClaw deploy missing libSQL auth token. Set FLY_IRONCLAW_LIBSQL_AUTH_TOKEN when using FLY_IRONCLAW_LIBSQL_URL.',
    };
  }

  if (llmBackend === 'nearai' && !nearAiCloudApiKey && !nearAiSessionToken) {
    return {
      error:
        'IronClaw deploy missing NEAR AI auth. Set NEAR_AI_CLOUD_API_KEY (or FLY_IRONCLAW_NEARAI_SESSION_TOKEN).',
    };
  }

  const env: Record<string, string> = {
    ONBOARD_COMPLETED: 'true',
    CLI_ENABLED: 'false',
    DATABASE_BACKEND: databaseBackend,
    LLM_BACKEND: llmBackend,
    GATEWAY_ENABLED: 'true',
    GATEWAY_HOST: gatewayHost,
    GATEWAY_PORT: String(gatewayPort),
    GATEWAY_AUTH_TOKEN: gatewayAuthToken,
  };

  if (databaseBackend === 'postgres') {
    env.DATABASE_URL = databaseUrl;
  } else {
    env.LIBSQL_PATH = libsqlPath;
    if (libsqlUrl) env.LIBSQL_URL = libsqlUrl;
    if (libsqlAuthToken) env.LIBSQL_AUTH_TOKEN = libsqlAuthToken;
  }

  if (nearAiCloudApiKey) {
    env.NEARAI_API_KEY = nearAiCloudApiKey;
    // Backward-compatibility with older runtime wrappers.
    env.NEAR_AI_CLOUD_API_KEY = nearAiCloudApiKey;
  }
  if (nearAiSessionToken) env.NEARAI_SESSION_TOKEN = nearAiSessionToken;
  env.NEARAI_BASE_URL = nearAiBaseUrl;
  env.NEARAI_AUTH_URL = nearAiAuthUrl;
  env.NEAR_AI_API_BASE_URL = nearAiBaseUrl;
  if (nearAiModel) env.NEARAI_MODEL = nearAiModel;

  const openAiApiKey = normalizeRuntimeSecret(
    process.env.OPENAI_API_KEY,
    MAX_RUNTIME_CONFIG_LENGTH,
  );
  const anthropicApiKey = normalizeRuntimeSecret(
    process.env.ANTHROPIC_API_KEY,
    MAX_RUNTIME_CONFIG_LENGTH,
  );
  const compatibleBaseUrl = normalizeRuntimeSecret(
    process.env.LLM_BASE_URL,
    MAX_RUNTIME_CONFIG_LENGTH,
  );
  const compatibleApiKey = normalizeRuntimeSecret(
    process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY,
    MAX_RUNTIME_CONFIG_LENGTH,
  );
  const compatibleModel = normalizeRuntimeSecret(
    process.env.LLM_MODEL,
    MAX_RUNTIME_MODEL_LENGTH,
  );

  if (openAiApiKey) env.OPENAI_API_KEY = openAiApiKey;
  if (anthropicApiKey) env.ANTHROPIC_API_KEY = anthropicApiKey;
  if (compatibleBaseUrl) env.LLM_BASE_URL = compatibleBaseUrl;
  if (compatibleApiKey) env.LLM_API_KEY = compatibleApiKey;
  if (compatibleModel) env.LLM_MODEL = compatibleModel;

  return { env };
}

/**
 * POST /api/agent/[id]/deploy
 * Create a Fly Machine for this agent.
 *
 * Body: { force?: boolean }
 * Runtime executor keypair is server-managed via RUNTIME_EXECUTOR_KEYPAIR.
 * If force=true and a machine already exists, it will be destroyed first.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: soulMint } = await params;

    // 1. Verify agent exists on-chain
    const connection = getRpc();
    const agentState = await waitForAgentState(connection, soulMint as Address);
    if (!agentState) {
      return NextResponse.json({ error: 'Agent not found on-chain' }, { status: 404 });
    }

    // 2. Parse request body
    const body = await request.json().catch(() => ({}));
    const {
      force,
      profileId,
      skills,
      model,
      scheduler,
      soulText,
      postingTopics,
      grokApiKey,
      telegramBotToken,
      telegramAllowedChatIds,
      telegramModel,
      runtimeProvider: runtimeProviderRaw,
      runtime,
      provider,
    } = body as Record<string, unknown>;
    const runtimeProvider = normalizeRuntimeProvider(
      runtimeProviderRaw || runtime || provider,
    );
    const sharedExecutorKeypair = getSharedExecutorKeypair();
    let runtimeExecutor: string;
    try {
      runtimeExecutor = await deriveExecutorAddress(sharedExecutorKeypair);
    } catch (decodeErr) {
      return NextResponse.json(
        {
          error:
            decodeErr instanceof Error
              ? decodeErr.message
              : 'Invalid RUNTIME_EXECUTOR_KEYPAIR',
        },
        { status: 400 },
      );
    }

    const normalizedProfileId =
      typeof profileId === 'string' && profileId.trim()
        ? profileId.trim().slice(0, 64)
        : 'alpha-hunter';
    const normalizedSkills = Array.isArray(skills)
      ? skills
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 16)
      : [];
    const normalizedModel =
      typeof model === 'string' && model.trim()
        ? model.trim().slice(0, 120)
        : '';
    const normalizedScheduler =
      scheduler && typeof scheduler === 'object'
        ? (scheduler as Record<string, unknown>)
        : {};

    const schedulerEnabledDefault =
      normalizedSkills.includes('alpha-haus') ||
      (normalizedSkills.length === 0 &&
        ALPHA_RUNTIME_PROFILES.has(normalizedProfileId));
    const schedulerEnabled =
      parseBoolean(normalizedScheduler.enabled) ??
      parseBoolean(process.env.RUNTIME_SCHEDULER_ENABLED) ??
      schedulerEnabledDefault;
    const schedulerIntervalMinutes =
      parseIntInRange(normalizedScheduler.intervalMinutes, 1, 1440) ??
      parseIntInRange(process.env.RUNTIME_SCHEDULER_INTERVAL_MINUTES, 1, 1440) ??
      10;
    const schedulerStartupDelaySeconds =
      parseIntInRange(normalizedScheduler.startupDelaySeconds, 0, 3600) ??
      parseIntInRange(process.env.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS, 0, 3600) ??
      20;
    const schedulerAutoReclaim =
      parseBoolean(normalizedScheduler.autoReclaim) ??
      parseBoolean(process.env.RUNTIME_AUTO_RECLAIM) ??
      false;
    const schedulerModeRaw =
      typeof normalizedScheduler.mode === 'string' && normalizedScheduler.mode.trim()
        ? normalizedScheduler.mode.trim()
        : (process.env.RUNTIME_SCHEDULER_MODE || '').trim();
    const schedulerMode =
      schedulerModeRaw.toLowerCase() === 'alpha-maintenance'
        ? 'alpha-maintenance'
        : 'alpha-maintenance';
    const requestedSoulText = normalizeRuntimeSoulText(soulText);
    const requestedPostingTopics = normalizePostingTopics(postingTopics);
    const requestedGrokApiKey = normalizeRuntimeSecret(grokApiKey);
    const requestedTelegramBotToken = normalizeRuntimeSecret(
      telegramBotToken,
      MAX_TELEGRAM_BOT_TOKEN_LENGTH,
    );
    const requestedTelegramAllowedChatIds = normalizeTelegramChatIds(
      telegramAllowedChatIds,
    );
    const requestedTelegramModel = normalizeRuntimeSecret(
      telegramModel,
      MAX_RUNTIME_MODEL_LENGTH,
    );

    // 3. Check if machine already exists
    const fly = getFlyClient();
    const existing = await fly.findMachineForAgent(soulMint);
    const existingSoulText = normalizeRuntimeSoulText(
      existing?.config?.env?.AGENT_SOUL_TEXT,
    );
    const runtimeSoulText = requestedSoulText || existingSoulText;
    const existingGrokApiKey = normalizeRuntimeSecret(
      existing?.config?.env?.GROK_API_KEY,
    );
    const runtimeGrokApiKey =
      requestedGrokApiKey ||
      existingGrokApiKey ||
      normalizeRuntimeSecret(process.env.GROK_API_KEY);
    const existingPostingTopics = parsePostingTopicsFromEnv(
      existing?.config?.env?.AGENT_POSTING_TOPICS_JSON ||
        existing?.config?.env?.AGENT_POSTING_TOPICS,
    );
    const runtimePostingTopics =
      requestedPostingTopics.length > 0
        ? requestedPostingTopics
        : existingPostingTopics;
    const existingTelegramBotToken = normalizeRuntimeSecret(
      existing?.config?.env?.TELEGRAM_BOT_TOKEN,
      MAX_TELEGRAM_BOT_TOKEN_LENGTH,
    );
    const existingTelegramAllowedChatIds = normalizeTelegramChatIds([
      ...parseTelegramChatIdsFromEnv(existing?.config?.env?.TELEGRAM_ALLOWED_CHAT_IDS),
      ...parseTelegramChatIdsFromEnv(existing?.config?.env?.TELEGRAM_CHAT_ID),
    ]);
    const existingTelegramModel = normalizeRuntimeSecret(
      existing?.config?.env?.TELEGRAM_MODEL,
      MAX_RUNTIME_MODEL_LENGTH,
    );
    const envTelegramDefaultChatIds = normalizeTelegramChatIds([
      ...parseTelegramChatIdsFromEnv(process.env.TELEGRAM_ALLOWED_CHAT_IDS),
      ...parseTelegramChatIdsFromEnv(process.env.TELEGRAM_CHAT_ID),
    ]);
    const runtimeTelegramBotToken =
      requestedTelegramBotToken ||
      existingTelegramBotToken ||
      normalizeRuntimeSecret(
        process.env.TELEGRAM_BOT_TOKEN,
        MAX_TELEGRAM_BOT_TOKEN_LENGTH,
      );
    const runtimeTelegramAllowedChatIds =
      requestedTelegramAllowedChatIds.length > 0
        ? requestedTelegramAllowedChatIds
        : existingTelegramAllowedChatIds.length > 0
          ? existingTelegramAllowedChatIds
          : envTelegramDefaultChatIds;
    const runtimeTelegramModel =
      requestedTelegramModel ||
      existingTelegramModel ||
      normalizeRuntimeSecret(process.env.TELEGRAM_MODEL, MAX_RUNTIME_MODEL_LENGTH);
    if (existing) {
      if (!force) {
        const existingRuntimeProvider = normalizeRuntimeProvider(
          existing.config?.env?.AGENT_RUNTIME_PROVIDER ||
            existing.config?.env?.RUNTIME_PROVIDER,
        );
        return NextResponse.json(
          {
            error: 'Machine already exists',
            machineId: existing.id,
            state: existing.state,
            runtimeProvider: existingRuntimeProvider,
          },
          { status: 409 },
        );
      }

      // force=true: destroy existing machine first
      console.log(`Destroying existing machine ${existing.id} (force redeploy)`);
      try {
        // Stop first if running, then destroy
        if (existing.state === 'started' || existing.state === 'starting') {
          await fly.stopMachine(existing.id);
          // Wait a moment for stop to complete
          await new Promise((r) => setTimeout(r, 3000));
        }
        await fly.destroyMachine(existing.id, true);
        // Wait for destroy to propagate
        await new Promise((r) => setTimeout(r, 2000));
      } catch (destroyErr) {
        console.error('Failed to destroy existing machine:', destroyErr);
        return NextResponse.json(
          { error: `Failed to destroy existing machine: ${destroyErr instanceof Error ? destroyErr.message : 'unknown'}` },
          { status: 500 },
        );
      }
    }

    // 4. Create Fly Machine (trim env vars to strip trailing newlines)
    const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
    const image = getRuntimeImage(appName, runtimeProvider);
    const nearAiCloudApiKey = normalizeRuntimeSecret(
      process.env.NEAR_AI_CLOUD_API_KEY ||
        process.env.NEARAI_API_KEY ||
        process.env.NEAR_AI_API_KEY ||
        process.env.IRONCLAW_NEAR_API_KEY,
      MAX_RUNTIME_CONFIG_LENGTH,
    );
    const ironclawRuntimeConfig =
      runtimeProvider === 'ironclaw'
        ? resolveIronclawRuntimeConfig(nearAiCloudApiKey)
        : null;
    if (ironclawRuntimeConfig?.error) {
      return NextResponse.json({ error: ironclawRuntimeConfig.error }, { status: 400 });
    }
    const machine = await fly.createMachine({
      name: `agent-${soulMint.slice(0, 12)}`,
      image,
      env: {
        SOUL_MINT_ADDRESS: soulMint,
        EXECUTOR_KEYPAIR: sharedExecutorKeypair,
        AGENT_RUNTIME_PROVIDER: runtimeProvider,
        SOLANA_RPC_URL:
          (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com').trim(),
        AGENTS_HAUS_PROGRAM_ID:
          (process.env.NEXT_PUBLIC_AGENTS_HAUS_PROGRAM_ID || 'BWFsJXqoXKg53yu3VxYV9YgmvTc9BZxto4CGJqYn8aWM').trim(),
        OPENROUTER_API_KEY: (process.env.OPENROUTER_API_KEY || '').trim(),
        X_BEARER_TOKEN: (process.env.X_BEARER_TOKEN || '').trim(),
        X_API_BASE_URL: (process.env.X_API_BASE_URL || '').trim(),
        ALPHA_POST_MODE: 'cpi',
        AGENT_PROFILE_ID: normalizedProfileId,
        AGENT_SKILLS: normalizedSkills.join(','),
        AGENT_MODEL: normalizedModel,
        AGENT_SOUL_TEXT: runtimeSoulText,
        GROK_API_KEY: runtimeGrokApiKey,
        TELEGRAM_ENABLED: runtimeTelegramBotToken ? 'true' : 'false',
        TELEGRAM_BOT_TOKEN: runtimeTelegramBotToken,
        TELEGRAM_ALLOWED_CHAT_IDS:
          runtimeTelegramAllowedChatIds.length > 0
            ? runtimeTelegramAllowedChatIds.join(',').slice(0, MAX_TELEGRAM_CHAT_IDS_LENGTH)
            : '',
        TELEGRAM_CHAT_ID:
          runtimeTelegramAllowedChatIds.length > 0
            ? runtimeTelegramAllowedChatIds[0]
            : '',
        TELEGRAM_MODEL: runtimeTelegramModel,
        AGENT_POSTING_TOPICS_JSON:
          runtimePostingTopics.length > 0
            ? JSON.stringify(runtimePostingTopics)
            : '',
        RUNTIME_SCHEDULER_ENABLED: schedulerEnabled ? 'true' : 'false',
        RUNTIME_SCHEDULER_INTERVAL_MINUTES: String(schedulerIntervalMinutes),
        RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS: String(
          schedulerStartupDelaySeconds,
        ),
        RUNTIME_SCHEDULER_MODE: schedulerMode,
        RUNTIME_AUTO_RECLAIM: schedulerAutoReclaim ? 'true' : 'false',
        ...(ironclawRuntimeConfig?.env || {}),
        PORT: '3001',
      },
    });

    let machineState = machine.state;
    if (machineState !== 'started' && machineState !== 'starting') {
      try {
        await fly.startMachine(machine.id);
        machineState = 'starting';
      } catch (startErr) {
        console.warn(
          `[deploy] Machine ${machine.id} created in state=${machine.state}; auto-start failed: ${
            startErr instanceof Error ? startErr.message : 'unknown error'
          }`,
        );
      }
    }

    return NextResponse.json({
      machineId: machine.id,
      state: machineState,
      region: machine.region,
      name: machine.name,
      runtimeExecutor,
      runtimeProvider,
      scheduler: {
        enabled: schedulerEnabled,
        intervalMinutes: schedulerIntervalMinutes,
        startupDelaySeconds: schedulerStartupDelaySeconds,
        mode: schedulerMode,
        autoReclaim: schedulerAutoReclaim,
      },
      postingTopics: runtimePostingTopics,
      telegram: {
        enabled: Boolean(runtimeTelegramBotToken),
        hasBotToken: Boolean(runtimeTelegramBotToken),
        allowedChatIds: runtimeTelegramAllowedChatIds,
        model: runtimeTelegramModel || null,
      },
    });
  } catch (err) {
    console.error('Deploy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Deploy failed' },
      { status: 500 },
    );
  }
}
