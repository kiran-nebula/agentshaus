import { NextRequest, NextResponse } from 'next/server';
import { getFlyClient } from '@/lib/fly-machines';

/**
 * POST /api/agent/[id]/machine/stop
 * Stop a running machine for this agent.
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

    if (machine.state === 'stopped') {
      return NextResponse.json({ machineId: machine.id, state: 'stopped' });
    }

    await fly.stopMachine(machine.id);
    return NextResponse.json({ machineId: machine.id, state: 'stopping' });
  } catch (err) {
    console.error('Machine stop error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to stop machine' },
      { status: 500 },
    );
  }
}
