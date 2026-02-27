import { NextRequest, NextResponse } from 'next/server';
import { getFlyClient } from '@/lib/fly-machines';
import { requireAgentOwnership } from '@/lib/agent-ownership-auth';
import { normalizeRuntimeProvider } from '@/lib/runtime-provider';

/**
 * GET /api/agent/[id]/health
 * Runtime health check for one agent machine.
 */
export async function GET(
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
      return NextResponse.json(
        { ok: false, deployed: false, error: 'Agent runtime not deployed' },
        { status: 404 },
      );
    }

    const machineSummary = {
      machineId: machine.id,
      name: machine.name,
      state: machine.state,
      region: machine.region,
      updatedAt: machine.updated_at,
    };

    if (machine.state !== 'started') {
      return NextResponse.json(
        {
          ok: false,
          deployed: true,
          machine: machineSummary,
          runtime: {
            reachable: false,
            status: machine.state,
          },
        },
        { status: 503 },
      );
    }

    const runtimeProvider = normalizeRuntimeProvider(
      machine.config?.env?.AGENT_RUNTIME_PROVIDER ||
        machine.config?.env?.RUNTIME_PROVIDER,
    );
    const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
    const healthPath = runtimeProvider === 'ironclaw' ? '/api/health' : '/health';
    const healthUrl = `https://${appName}.fly.dev${healthPath}`;

    const runtimeResponse = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        'fly-force-instance-id': machine.id,
      },
      cache: 'no-store',
    });

    if (!runtimeResponse.ok) {
      const details = await runtimeResponse.text();
      return NextResponse.json(
        {
          ok: false,
          deployed: true,
          machine: machineSummary,
          runtime: {
            reachable: false,
            status: 'error',
            details: details.slice(0, 500),
          },
        },
        { status: 502 },
      );
    }

    const runtimeHealth = await runtimeResponse.json();

    return NextResponse.json({
      ok: true,
      deployed: true,
      machine: machineSummary,
      runtime: {
        reachable: true,
        ...runtimeHealth,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Health check failed',
      },
      { status: 500 },
    );
  }
}
