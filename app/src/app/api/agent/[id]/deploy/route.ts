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
    const { executorKeypair, force } = body;
    if (!executorKeypair) {
      return NextResponse.json({ error: 'executorKeypair is required' }, { status: 400 });
    }

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
    const image = (
      process.env.FLY_RUNTIME_IMAGE ||
      `registry.fly.io/${appName}:deployment-01KHQ23V4R9E6B4W4V98T63BSW`
    ).trim();
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
