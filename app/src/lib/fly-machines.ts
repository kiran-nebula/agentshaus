/**
 * Fly Machines API client.
 * Docs: https://fly.io/docs/machines/api/machines-resource/
 */

const FLY_API_BASE = 'https://api.machines.dev/v1';

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
  };
  created_at: string;
  updated_at: string;
}

export class FlyMachinesClient {
  constructor(
    private token: string,
    private appName: string,
  ) {}

  private async request<T = any>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${FLY_API_BASE}/apps/${this.appName}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...init?.headers,
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
    return this.request<FlyMachine>('/machines', {
      method: 'POST',
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
    await this.request(`/machines/${machineId}/start`, { method: 'POST' });
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
   * Machines are named `agent-{soulMint.slice(0,12)}`.
   */
  async findMachineForAgent(soulMint: string): Promise<FlyMachine | null> {
    const machines = await this.listMachines();
    const prefix = `agent-${soulMint.slice(0, 12)}`;
    return machines.find((m) => m.name === prefix) || null;
  }
}

export function getFlyClient(): FlyMachinesClient {
  const token = process.env.FLY_API_TOKEN?.trim();
  if (!token) throw new Error('FLY_API_TOKEN is not set');
  const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
  return new FlyMachinesClient(token, appName);
}
