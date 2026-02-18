import { NextRequest, NextResponse } from 'next/server';
import { getFlyClient } from '@/lib/fly-machines';

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

    return NextResponse.json({
      deployed: true,
      machineId: machine.id,
      state: machine.state,
      region: machine.region,
      name: machine.name,
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
