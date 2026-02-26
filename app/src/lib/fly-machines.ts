/**
 * Fly Machines API client.
 * Docs: https://fly.io/docs/machines/api/machines-resource/
 */

const FLY_API_BASE = 'https://api.machines.dev/v1';
const FLY_DEFAULT_TIMEOUT_MS = 30_000;
const FLY_CREATE_TIMEOUT_MS = 55_000;

export interface FlyMachine {
  id: string;
  name: string;
  state: string;
  region: string;
  config: {
    image: string;
    env: Record<string, string>;
    guest: {
      cpu_kind: string;
      cpus: number;
      memory_mb: number;
    };
    [key: string]: unknown;
  };
  created_at: string;
  updated_at: string;
}

export type FlyMachineConfig = FlyMachine['config'];

export class FlyMachinesClient {
  constructor(
    private token: string,
    private appName: string,
  ) {}

  private async request<T = any>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const timeoutMs = init?.timeoutMs ?? FLY_DEFAULT_TIMEOUT_MS;
    const { timeoutMs: _, ...fetchInit } = init ?? {};
    const res = await fetch(`${FLY_API_BASE}/apps/${this.appName}${path}`, {
      ...fetchInit,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...fetchInit?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Fly API ${res.status}: ${body}`);
    }

    // Some endpoints return empty on success (stop, start, delete)
    const text = await res.text();
    return text ? JSON.parse(text) : ({} as T);
  }

  async createMachine(opts: {
    name: string;
    region?: string;
    image: string;
    env: Record<string, string>;
    cpus?: number;
    memoryMb?: number;
  }): Promise<FlyMachine> {
    // Use skip_launch=true so createMachine returns quickly (~2-3s).
    // The caller should follow up with startMachine() to boot the container.
    return this.request<FlyMachine>('/machines?skip_launch=true', {
      method: 'POST',
      timeoutMs: FLY_CREATE_TIMEOUT_MS,
      body: JSON.stringify({
        name: opts.name,
        region: opts.region || 'iad',
        config: {
          image: opts.image,
          env: opts.env,
          guest: {
            cpu_kind: 'shared',
            cpus: opts.cpus ?? 1,
            memory_mb: opts.memoryMb ?? 512,
          },
          auto_destroy: false,
          services: [
            {
              protocol: 'tcp',
              internal_port: 3001,
              autostart: true,
              autostop: 'off',
              ports: [
                { port: 443, handlers: ['tls', 'http'] },
                { port: 80, handlers: ['http'], force_https: true },
              ],
            },
          ],
        },
      }),
    });
  }

  async getMachine(machineId: string): Promise<FlyMachine> {
    return this.request<FlyMachine>(`/machines/${machineId}`);
  }

  async listMachines(): Promise<FlyMachine[]> {
    return this.request<FlyMachine[]>('/machines');
  }

  async startMachine(machineId: string): Promise<void> {
    try {
      await this.request(`/machines/${machineId}/start`, { method: 'POST' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Newer Fly behavior can return machines in `created`, where /start fails but /restart succeeds.
      if (message.includes("unable to start machine from current state: 'created'")) {
        try {
          await this.request(`/machines/${machineId}/restart`, { method: 'POST' });
          return;
        } catch {
          // Fall through to no-op update fallback below.
        }

        // Last-resort fallback: perform a no-op machine update with the existing config.
        // This mirrors `flyctl machine update` behavior that can transition `created` -> `started`.
        const machine = await this.getMachine(machineId);
        await this.request(`/machines/${machineId}?skip_health_checks=true`, {
          method: 'POST',
          body: JSON.stringify({ config: machine.config }),
        });
        return;
      }
      throw err;
    }
  }

  async restartMachine(machineId: string): Promise<void> {
    await this.request(`/machines/${machineId}/restart`, { method: 'POST' });
  }

  async updateMachineConfig(machineId: string, config: FlyMachineConfig): Promise<FlyMachine> {
    return this.request<FlyMachine>(`/machines/${machineId}?skip_health_checks=true`, {
      method: 'POST',
      body: JSON.stringify({ config }),
    });
  }

  async stopMachine(machineId: string): Promise<void> {
    await this.request(`/machines/${machineId}/stop`, { method: 'POST' });
  }

  async destroyMachine(machineId: string, force = false): Promise<void> {
    const query = force ? '?force=true' : '';
    await this.request(`/machines/${machineId}${query}`, { method: 'DELETE' });
  }

  /**
   * Find the machine for a given agent soul mint address.
   * Prefer exact SOUL_MINT_ADDRESS env match, then fall back to name prefix.
   */
  async findMachineForAgent(soulMint: string): Promise<FlyMachine | null> {
    const machines = await this.listMachines();
    const exactEnvMatch = machines.find(
      (machine) => machine.config?.env?.SOUL_MINT_ADDRESS === soulMint,
    );
    if (exactEnvMatch) return exactEnvMatch;

    const prefix = `agent-${soulMint.slice(0, 12)}`;
    return machines.find((machine) => machine.name === prefix) || null;
  }
}

export function getFlyClient(): FlyMachinesClient {
  const token = process.env.FLY_API_TOKEN?.trim();
  if (!token) throw new Error('FLY_API_TOKEN is not set');
  const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
  return new FlyMachinesClient(token, appName);
}
