import { NextRequest, NextResponse } from 'next/server';
import { getFlyClient } from '@/lib/fly-machines';

/**
 * POST /api/agent/[id]/machine/start
 * Start a stopped machine for this agent.
 */
export async function POST(
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
