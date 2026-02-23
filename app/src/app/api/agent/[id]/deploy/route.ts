import { NextRequest, NextResponse } from 'next/server';
import { createSolanaRpc, createKeyPairFromBytes, getAddressFromPublicKey } from '@solana/kit';
import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';
import { getAgentStatePda, fetchAgentState } from '@agents-haus/sdk';
import { getFlyClient } from '@/lib/fly-machines';

let rpc: Rpc<SolanaRpcApi> | null = null;
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHA_RUNTIME_PROFILES = new Set([
  'alpha-hunter',
  'burn-maximalist',
  'balanced',
  'vibes-poster',
]);

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

function getRuntimeImage(appName: string): string {
  const configured = process.env.FLY_RUNTIME_IMAGE?.trim();
  if (configured) return configured;

  const fallback = `registry.fly.io/${appName}:latest`;
  console.warn(
    `[deploy] FLY_RUNTIME_IMAGE not set, defaulting to ${fallback}. Set FLY_RUNTIME_IMAGE to pin an exact image.`,
  );
  return fallback;
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
    const body = await request.json();
    const { force, profileId, skills, model, scheduler } = body;
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
      true;
    const schedulerModeRaw =
      typeof normalizedScheduler.mode === 'string' && normalizedScheduler.mode.trim()
        ? normalizedScheduler.mode.trim()
        : (process.env.RUNTIME_SCHEDULER_MODE || '').trim();
    const schedulerMode =
      schedulerModeRaw.toLowerCase() === 'alpha-maintenance'
        ? 'alpha-maintenance'
        : 'alpha-maintenance';

    // 3. Check if machine already exists
    const fly = getFlyClient();
    const existing = await fly.findMachineForAgent(soulMint);
    if (existing) {
      if (!force) {
        return NextResponse.json(
          {
            error: 'Machine already exists',
            machineId: existing.id,
            state: existing.state,
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
    const image = getRuntimeImage(appName);
    const machine = await fly.createMachine({
      name: `agent-${soulMint.slice(0, 12)}`,
      image,
      env: {
        SOUL_MINT_ADDRESS: soulMint,
        EXECUTOR_KEYPAIR: sharedExecutorKeypair,
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
        RUNTIME_SCHEDULER_ENABLED: schedulerEnabled ? 'true' : 'false',
        RUNTIME_SCHEDULER_INTERVAL_MINUTES: String(schedulerIntervalMinutes),
        RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS: String(
          schedulerStartupDelaySeconds,
        ),
        RUNTIME_SCHEDULER_MODE: schedulerMode,
        RUNTIME_AUTO_RECLAIM: schedulerAutoReclaim ? 'true' : 'false',
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
      scheduler: {
        enabled: schedulerEnabled,
        intervalMinutes: schedulerIntervalMinutes,
        startupDelaySeconds: schedulerStartupDelaySeconds,
        mode: schedulerMode,
        autoReclaim: schedulerAutoReclaim,
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
