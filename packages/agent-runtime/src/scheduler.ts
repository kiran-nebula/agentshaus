import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { autoReclaim } from '../workspace/skills/alpha-haus/tools/auto_reclaim';
import { checkEpochState } from '../workspace/skills/alpha-haus/tools/check_epoch_state';
import { checkMyPosition } from '../workspace/skills/alpha-haus/tools/check_my_position';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export type RuntimeSchedulerMode = 'alpha-maintenance';
export type RuntimeSchedulerStatus = 'disabled' | 'idle' | 'running' | 'ok' | 'error';

export interface RuntimeSchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
  startupDelaySeconds: number;
  mode: RuntimeSchedulerMode;
  autoReclaim: boolean;
  alphaHausEnabled: boolean;
}

export interface RuntimeSchedulerSnapshot {
  enabled: boolean;
  active: boolean;
  mode: RuntimeSchedulerMode;
  autoReclaim: boolean;
  intervalMinutes: number;
  startupDelaySeconds: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: RuntimeSchedulerStatus;
  lastError: string | null;
  runCount: number;
  lastReclaimSignature: string | null;
}

type OpenClawAutomationConfig = {
  enabled?: unknown;
  intervalMinutes?: unknown;
  startupDelaySeconds?: unknown;
  mode?: unknown;
  autoReclaim?: unknown;
};

type OpenClawConfig = {
  automation?: OpenClawAutomationConfig;
};

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parseBooleanUnknown(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== 'string') return undefined;

  const normalized = resolveTemplateString(value).trim().toLowerCase();
  if (!normalized) return undefined;
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return undefined;
}

function parseIntegerUnknown(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseInt(resolveTemplateString(value).trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSchedulerMode(value: unknown): RuntimeSchedulerMode | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = resolveTemplateString(value).trim().toLowerCase();
  if (normalized === 'alpha-maintenance') return 'alpha-maintenance';
  return undefined;
}

function resolveTemplateString(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^\$\{([A-Z0-9_]+)\}$/);
  if (!match) return trimmed;

  const envValue = process.env[match[1]];
  return typeof envValue === 'string' ? envValue : '';
}

function getOpenClawConfigPath(): string {
  const fromEnv = (process.env.OPENCLAW_CONFIG_PATH || '').trim();
  if (fromEnv) return fromEnv;
  return path.resolve(process.cwd(), 'openclaw.json');
}

function loadOpenClawAutomationConfig(): OpenClawAutomationConfig {
  const configPath = getOpenClawConfigPath();
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as OpenClawConfig;
    if (!parsed.automation || typeof parsed.automation !== 'object') {
      return {};
    }
    return parsed.automation;
  } catch (err) {
    console.warn(
      `[scheduler] Failed to parse openclaw config at ${configPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {};
  }
}

export function loadRuntimeSchedulerConfig(alphaHausEnabled: boolean): RuntimeSchedulerConfig {
  const automationDefaults = loadOpenClawAutomationConfig();

  const defaultEnabled =
    parseBooleanUnknown(automationDefaults.enabled) ?? alphaHausEnabled;
  const defaultIntervalMinutes = clampInteger(
    parseIntegerUnknown(automationDefaults.intervalMinutes) ?? 10,
    1,
    1440,
  );
  const defaultStartupDelaySeconds = clampInteger(
    parseIntegerUnknown(automationDefaults.startupDelaySeconds) ?? 20,
    0,
    3600,
  );
  const defaultMode = parseSchedulerMode(automationDefaults.mode) || 'alpha-maintenance';
  const defaultAutoReclaim =
    parseBooleanUnknown(automationDefaults.autoReclaim) ?? true;

  return {
    enabled:
      parseBooleanUnknown(process.env.RUNTIME_SCHEDULER_ENABLED) ?? defaultEnabled,
    intervalMinutes: clampInteger(
      parseIntegerUnknown(process.env.RUNTIME_SCHEDULER_INTERVAL_MINUTES) ??
        defaultIntervalMinutes,
      1,
      1440,
    ),
    startupDelaySeconds: clampInteger(
      parseIntegerUnknown(process.env.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS) ??
        defaultStartupDelaySeconds,
      0,
      3600,
    ),
    mode:
      parseSchedulerMode(process.env.RUNTIME_SCHEDULER_MODE) || defaultMode,
    autoReclaim:
      parseBooleanUnknown(process.env.RUNTIME_AUTO_RECLAIM) ?? defaultAutoReclaim,
    alphaHausEnabled,
  };
}

function safeLogJson(value: unknown): string {
  return JSON.stringify(value, (_, nestedValue) =>
    typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue,
  );
}

export class RuntimeScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private stopped = false;
  private readonly snapshotState: RuntimeSchedulerSnapshot;

  constructor(private readonly config: RuntimeSchedulerConfig) {
    this.snapshotState = {
      enabled: config.enabled,
      active: false,
      mode: config.mode,
      autoReclaim: config.autoReclaim,
      intervalMinutes: config.intervalMinutes,
      startupDelaySeconds: config.startupDelaySeconds,
      nextRunAt: null,
      lastRunAt: null,
      lastRunStatus: config.enabled ? 'idle' : 'disabled',
      lastError: null,
      runCount: 0,
      lastReclaimSignature: null,
    };
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped || !this.active) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const nextRunAt = new Date(Date.now() + delayMs);
    this.snapshotState.nextRunAt = nextRunAt.toISOString();
    this.timer = setTimeout(() => {
      void this.runCycle();
    }, delayMs);
  }

  private async runCycle(): Promise<void> {
    if (this.stopped || !this.active) return;

    this.snapshotState.lastRunAt = new Date().toISOString();
    this.snapshotState.lastRunStatus = 'running';
    this.snapshotState.lastError = null;
    this.snapshotState.nextRunAt = null;

    try {
      const epochState = await checkEpochState();
      const position = await checkMyPosition();

      let reclaimResult: unknown = null;
      let reclaimTriggered = false;

      if (this.config.autoReclaim && this.config.mode === 'alpha-maintenance') {
        const flippedAlpha =
          Boolean(epochState.agentHasTipped) && !Boolean(epochState.agentIsAlpha);
        const flippedBurn =
          Boolean(epochState.agentHasBurned) && !Boolean(epochState.agentIsBurner);

        if (flippedAlpha || flippedBurn) {
          reclaimTriggered = true;
          reclaimResult = await autoReclaim();

          if (
            reclaimResult &&
            typeof reclaimResult === 'object' &&
            'reclaimSignature' in reclaimResult &&
            typeof (reclaimResult as { reclaimSignature?: unknown }).reclaimSignature ===
              'string'
          ) {
            this.snapshotState.lastReclaimSignature = (
              reclaimResult as { reclaimSignature: string }
            ).reclaimSignature;
          }
        }
      }

      this.snapshotState.runCount += 1;
      this.snapshotState.lastRunStatus = 'ok';

      console.log(
        [
          `[scheduler] cycle=${this.snapshotState.runCount}`,
          `epoch=${epochState.epoch ?? 'n/a'}`,
          `alpha=${epochState.agentIsAlpha ?? false}`,
          `burner=${epochState.agentIsBurner ?? false}`,
          `tipWallet=${(position as { tipWallet?: string }).tipWallet ?? 'n/a'}`,
          reclaimTriggered
            ? `reclaim=${safeLogJson(reclaimResult).slice(0, 180)}`
            : 'reclaim=skipped',
        ].join(' '),
      );
    } catch (err) {
      this.snapshotState.lastRunStatus = 'error';
      this.snapshotState.lastError =
        err instanceof Error ? err.message : String(err);
      console.error('[scheduler] cycle error:', err);
    } finally {
      this.scheduleNext(this.config.intervalMinutes * 60_000);
    }
  }

  start(): void {
    if (!this.config.enabled) {
      this.active = false;
      this.snapshotState.active = false;
      this.snapshotState.lastRunStatus = 'disabled';
      console.log('[scheduler] disabled by config');
      return;
    }

    if (!this.config.alphaHausEnabled) {
      this.active = false;
      this.snapshotState.active = false;
      this.snapshotState.lastRunStatus = 'disabled';
      console.log('[scheduler] disabled because alpha-haus skill is not enabled');
      return;
    }

    this.active = true;
    this.snapshotState.active = true;
    this.snapshotState.lastRunStatus = 'idle';

    console.log(
      `[scheduler] enabled mode=${this.config.mode} interval=${this.config.intervalMinutes}m startupDelay=${this.config.startupDelaySeconds}s autoReclaim=${this.config.autoReclaim}`,
    );

    this.scheduleNext(this.config.startupDelaySeconds * 1000);
  }

  stop(): void {
    this.stopped = true;
    this.active = false;
    this.snapshotState.active = false;
    this.snapshotState.nextRunAt = null;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getSnapshot(): RuntimeSchedulerSnapshot {
    return { ...this.snapshotState };
  }
}
