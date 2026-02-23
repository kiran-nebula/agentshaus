import { NextRequest, NextResponse } from 'next/server';
import { getFlyClient, type FlyMachine } from '@/lib/fly-machines';

type MachineStatus = {
  deployed: boolean;
  state: string | null;
  machineId: string | null;
  region: string | null;
  name: string | null;
};

function normalizeSoulMints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const mint = item.trim();
    if (!mint || seen.has(mint)) continue;
    seen.add(mint);
    out.push(mint);
    if (out.length >= 200) break;
  }

  return out;
}

function emptyStatus(): MachineStatus {
  return {
    deployed: false,
    state: null,
    machineId: null,
    region: null,
    name: null,
  };
}

function findMachineForSoulMint(
  machines: FlyMachine[],
  soulMint: string,
): FlyMachine | null {
  const exactEnvMatch = machines.find(
    (machine) => machine.config?.env?.SOUL_MINT_ADDRESS === soulMint,
  );
  if (exactEnvMatch) return exactEnvMatch;

  const prefix = `agent-${soulMint.slice(0, 12)}`;
  return machines.find((machine) => machine.name === prefix) || null;
}

/**
 * POST /api/agent/machines
 * Batch machine status lookup for many soul mints with one Fly API call.
 *
 * Body: { soulMints: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const soulMints = normalizeSoulMints(body?.soulMints);
    if (soulMints.length === 0) {
      return NextResponse.json({ machines: {} });
    }

    const fly = getFlyClient();
    const machines = await fly.listMachines();

    const machineMap: Record<string, MachineStatus> = {};
    for (const soulMint of soulMints) {
      const machine = findMachineForSoulMint(machines, soulMint);
      if (!machine) {
        machineMap[soulMint] = emptyStatus();
        continue;
      }

      machineMap[soulMint] = {
        deployed: true,
        state: machine.state || null,
        machineId: machine.id || null,
        region: machine.region || null,
        name: machine.name || null,
      };
    }

    return NextResponse.json({
      machines: machineMap,
    });
  } catch (err) {
    console.error('Machine batch lookup error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch machine states' },
      { status: 500 },
    );
  }
}
