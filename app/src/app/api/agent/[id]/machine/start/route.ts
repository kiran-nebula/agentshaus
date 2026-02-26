import { NextRequest, NextResponse } from 'next/server';
import { getFlyClient } from '@/lib/fly-machines';
import { requireAgentOwnership } from '@/lib/agent-ownership-auth';

export const maxDuration = 60;

/**
 * POST /api/agent/[id]/machine/start
 * Start a stopped machine for this agent.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: soulMint } = await params;
    const ownership = await requireAgentOwnership(request, soulMint);
    if (!ownership.ok) {
      return ownership.response;
    }

    const fly = getFlyClient();
    const machine = await fly.findMachineForAgent(soulMint);

    if (!machine) {
      return NextResponse.json({ error: 'No machine found' }, { status: 404 });
    }

    if (machine.state === 'started') {
      return NextResponse.json({ machineId: machine.id, state: 'started' });
    }

    await fly.startMachine(machine.id);
    return NextResponse.json({ machineId: machine.id, state: 'starting' });
  } catch (err) {
    console.error('Machine start error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start machine' },
      { status: 500 },
    );
  }
}
