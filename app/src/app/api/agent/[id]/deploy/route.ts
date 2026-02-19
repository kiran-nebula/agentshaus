import { NextRequest, NextResponse } from 'next/server';
import { createSolanaRpc } from '@solana/kit';
import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';
import { getAgentStatePda, fetchAgentState } from '@agents-haus/sdk';
import { getFlyClient } from '@/lib/fly-machines';

let rpc: Rpc<SolanaRpcApi> | null = null;
function getRpc(): Rpc<SolanaRpcApi> {
  if (!rpc) {
    rpc = createSolanaRpc(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!);
  }
  return rpc;
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
 * Body: { executorKeypair: string, force?: boolean }
 * The executor keypair is a JSON array of bytes (64-byte Solana keypair format).
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
    const [agentStateAddr] = await getAgentStatePda(soulMint as Address);
    const agentState = await fetchAgentState(connection, agentStateAddr);
    if (!agentState) {
      return NextResponse.json({ error: 'Agent not found on-chain' }, { status: 404 });
    }

    // 2. Parse request body
    const body = await request.json();
    const { executorKeypair, force, profileId, skills, model } = body;
    if (!executorKeypair) {
      return NextResponse.json({ error: 'executorKeypair is required' }, { status: 400 });
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
        EXECUTOR_KEYPAIR: executorKeypair,
        SOLANA_RPC_URL:
          (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com').trim(),
        AGENTS_HAUS_PROGRAM_ID:
          (process.env.NEXT_PUBLIC_AGENTS_HAUS_PROGRAM_ID || 'BWFsJXqoXKg53yu3VxYV9YgmvTc9BZxto4CGJqYn8aWM').trim(),
        OPENROUTER_API_KEY: (process.env.OPENROUTER_API_KEY || '').trim(),
        X_BEARER_TOKEN: (process.env.X_BEARER_TOKEN || '').trim(),
        X_API_BASE_URL: (process.env.X_API_BASE_URL || '').trim(),
        AGENT_PROFILE_ID: normalizedProfileId,
        AGENT_SKILLS: normalizedSkills.join(','),
        AGENT_MODEL: normalizedModel,
        PORT: '3001',
      },
    });

    return NextResponse.json({
      machineId: machine.id,
      state: machine.state,
      region: machine.region,
      name: machine.name,
    });
  } catch (err) {
    console.error('Deploy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Deploy failed' },
      { status: 500 },
    );
  }
}
