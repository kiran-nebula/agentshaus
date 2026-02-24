import { NextRequest, NextResponse } from 'next/server';
import { createKeyPairFromBytes, getAddressFromPublicKey } from '@solana/kit';
import { getFlyClient } from '@/lib/fly-machines';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function parseCsv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function parseIntValue(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePostingTopics(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return trimmed
    .split(/[|,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function decodeBase58(value: string): Uint8Array {
  let num = BigInt(0);
  for (const char of value) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('Invalid base58 input');
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

async function deriveExecutorAddress(executorSecret: string | undefined): Promise<string | null> {
  if (!executorSecret) return null;

  try {
    const trimmed = executorSecret.trim();
    const bytes = trimmed.startsWith('[')
      ? new Uint8Array(JSON.parse(trimmed))
      : decodeBase58(trimmed);
    const kp = await createKeyPairFromBytes(bytes);
    const address = await getAddressFromPublicKey(kp.publicKey);
    return address as string;
  } catch {
    return null;
  }
}

/**
 * GET /api/agent/[id]/machine
 * Get machine status for this agent.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: soulMint } = await params;
    const fly = getFlyClient();
    const machine = await fly.findMachineForAgent(soulMint);

    if (!machine) {
      return NextResponse.json({ deployed: false });
    }

    const env = machine.config?.env || {};
    const runtimeExecutor = await deriveExecutorAddress(env.EXECUTOR_KEYPAIR);
    const schedulerEnabled = parseBoolean(env.RUNTIME_SCHEDULER_ENABLED);
    const schedulerIntervalMinutes = parseIntValue(
      env.RUNTIME_SCHEDULER_INTERVAL_MINUTES,
    );
    const schedulerStartupDelaySeconds = parseIntValue(
      env.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS,
    );

    return NextResponse.json({
      deployed: true,
      machineId: machine.id,
      state: machine.state,
      region: machine.region,
      name: machine.name,
      runtimeExecutor,
      profileId: env.AGENT_PROFILE_ID || null,
      skills: parseCsv(env.AGENT_SKILLS),
      model: env.AGENT_MODEL || null,
      hasGrokApiKey: Boolean((env.GROK_API_KEY || '').trim()),
      postingTopics: parsePostingTopics(env.AGENT_POSTING_TOPICS_JSON),
      alphaPostMode: env.ALPHA_POST_MODE || 'cpi',
      scheduler: {
        enabled: schedulerEnabled,
        intervalMinutes: schedulerIntervalMinutes,
        startupDelaySeconds: schedulerStartupDelaySeconds,
        mode: env.RUNTIME_SCHEDULER_MODE || null,
        autoReclaim: parseBoolean(env.RUNTIME_AUTO_RECLAIM),
      },
      createdAt: machine.created_at,
      updatedAt: machine.updated_at,
    });
  } catch (err) {
    console.error('Machine status error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get machine status' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/agent/[id]/machine
 * Destroy the machine for this agent.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: soulMint } = await params;
    const fly = getFlyClient();
    const machine = await fly.findMachineForAgent(soulMint);

    if (!machine) {
      return NextResponse.json({ error: 'No machine found' }, { status: 404 });
    }

    await fly.destroyMachine(machine.id, true);
    return NextResponse.json({ destroyed: true, machineId: machine.id });
  } catch (err) {
    console.error('Machine destroy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to destroy machine' },
      { status: 500 },
    );
  }
}
