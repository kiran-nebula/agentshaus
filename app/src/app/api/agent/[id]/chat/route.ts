import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_LLM_MODELS } from '@agents-haus/common';
import { getFlyClient } from '@/lib/fly-machines';
import { normalizeRuntimeProvider } from '@/lib/runtime-provider';

type CronChatCommand =
  | { action: 'list' }
  | { action: 'remove' }
  | { action: 'install'; intervalMinutes?: number; cronExpression?: string; cadenceLabel: string }
  | { action: 'help' }
  | { action: 'invalid'; reason: string };

const DEFAULT_RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS = 20;
const DEFAULT_RUNTIME_SCHEDULER_MODE = 'alpha-maintenance';
const DEFAULT_RUNTIME_SCHEDULER_ENABLED = 'true';
const DEFAULT_RUNTIME_SCHEDULER_INTERVAL_MINUTES = '10';
const DEFAULT_RUNTIME_AUTO_RECLAIM = 'false';
const AUTO_RECLAIM_MEMO_ENV_KEY = 'AGENT_AUTO_RECLAIM_MEMO';
const POSTING_TOPICS_JSON_ENV_KEY = 'AGENT_POSTING_TOPICS_JSON';
const POSTING_TOPICS_CSV_ENV_KEY = 'AGENT_POSTING_TOPICS';
const MAX_AUTO_RECLAIM_MEMO_LENGTH = 300;
const MAX_POSTING_TOPICS = 12;
const MAX_POSTING_TOPIC_LENGTH = 80;
const OPENROUTER_DEFAULT_MODEL_IDS = new Set(
  DEFAULT_LLM_MODELS.map((model) => model.id),
);

type RuntimeAutoReclaimContentCommand =
  | { action: 'show' }
  | {
      action: 'set';
      updates: Partial<{
        memo: string;
        clearMemo: true;
        topics: string[];
        clearTopics: true;
      }>;
    }
  | { action: 'help' }
  | { action: 'invalid'; reason: string };

function normalizeCommandWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizePostingTopic(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeCommandWhitespace(value).slice(0, MAX_POSTING_TOPIC_LENGTH);
  return normalized || null;
}

function normalizePostingTopics(values: unknown[]): string[] {
  const deduped: string[] = [];
  const seen = new Set<string>();

  for (const entry of values) {
    const normalized = normalizePostingTopic(entry);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
    if (deduped.length >= MAX_POSTING_TOPICS) break;
  }

  return deduped;
}

function parsePostingTopicsInput(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return normalizePostingTopics(parsed);
      }
    } catch {
      // Fall through to delimiter parsing.
    }
  }

  return normalizePostingTopics(trimmed.split(/[|,]/));
}

function normalizeAutoReclaimMemo(value: string): string | null {
  const normalized = normalizeCommandWhitespace(value)
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '');
  if (!normalized) return null;
  return normalized.slice(0, MAX_AUTO_RECLAIM_MEMO_LENGTH);
}

function parseMemoValue(rawValue: string): RuntimeAutoReclaimContentCommand {
  const value = rawValue.trim();
  if (!value) {
    return {
      action: 'invalid',
      reason: 'Provide memo text, e.g. `/reclaim memo reclaiming with a Solana market update`',
    };
  }

  if (/^(clear|off|none|reset|default)$/i.test(value)) {
    return { action: 'set', updates: { clearMemo: true } };
  }

  const memo = normalizeAutoReclaimMemo(value);
  if (!memo) {
    return {
      action: 'invalid',
      reason: 'Memo text cannot be empty',
    };
  }

  return { action: 'set', updates: { memo } };
}

function parseTopicsValue(rawValue: string): RuntimeAutoReclaimContentCommand {
  const value = rawValue.trim();
  if (!value) {
    return {
      action: 'invalid',
      reason: 'Provide topics, e.g. `/reclaim topics Solana, AI agents, market structure`',
    };
  }

  if (/^(clear|off|none|reset|default)$/i.test(value)) {
    return { action: 'set', updates: { clearTopics: true } };
  }

  const topics = parsePostingTopicsInput(value);
  if (topics.length === 0) {
    return {
      action: 'invalid',
      reason: 'No valid topics found. Use comma-separated values.',
    };
  }

  return { action: 'set', updates: { topics } };
}

function parseRuntimeAutoReclaimContentCommand(
  message: string,
): RuntimeAutoReclaimContentCommand | null {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  if (trimmed === '/') {
    return { action: 'help' };
  }

  const setMatch = /^\/set\s+(?:auto[\s-]?reclaim|reclaim)\s+(memo|message|topic|topics)\s+(.+)$/i.exec(
    trimmed,
  );
  if (setMatch) {
    const field = setMatch[1].toLowerCase();
    const value = setMatch[2].trim();
    if (field === 'memo' || field === 'message') {
      return parseMemoValue(value);
    }
    return parseTopicsValue(value);
  }

  const commandMatch = /^\/(?:auto[\s-]?reclaim|reclaim)\b(.*)$/i.exec(trimmed);
  if (!commandMatch) return null;

  const rest = commandMatch[1]?.trim() || '';
  const restLower = rest.toLowerCase();
  if (!rest || restLower === 'help') {
    return { action: 'help' };
  }

  if (/^(show|status|settings?|config(?:uration)?|current)\b/.test(restLower)) {
    return { action: 'show' };
  }

  const memoMatch = /^memo\b[:=\s-]*(.*)$/i.exec(rest);
  if (memoMatch) {
    return parseMemoValue(memoMatch[1] || '');
  }

  const topicsMatch = /^(topic|topics)\b[:=\s-]*(.*)$/i.exec(rest);
  if (topicsMatch) {
    return parseTopicsValue(topicsMatch[2] || '');
  }

  if (
    /^set\s+memo\b/.test(restLower) ||
    /^set\s+(topic|topics)\b/.test(restLower)
  ) {
    const setInnerMatch = /^set\s+(memo|message|topic|topics)\b[:=\s-]*(.*)$/i.exec(
      rest,
    );
    if (setInnerMatch) {
      const field = setInnerMatch[1].toLowerCase();
      const value = setInnerMatch[2] || '';
      if (field === 'memo' || field === 'message') {
        return parseMemoValue(value);
      }
      return parseTopicsValue(value);
    }
  }

  if (lower.startsWith('/reclaim') || lower.startsWith('/auto-reclaim')) {
    return {
      action: 'invalid',
      reason: 'Unknown reclaim command. Use `/reclaim help` for supported commands.',
    };
  }

  return null;
}

function parsePostingTopicsFromRuntimeEnv(env: Record<string, string>): string[] {
  const raw = (env[POSTING_TOPICS_JSON_ENV_KEY] || env[POSTING_TOPICS_CSV_ENV_KEY] || '').trim();
  if (!raw) return [];
  return parsePostingTopicsInput(raw);
}

function resolveRuntimeAutoReclaimContentEnv(env: Record<string, string>) {
  return {
    memo: normalizeAutoReclaimMemo(env[AUTO_RECLAIM_MEMO_ENV_KEY] || '') || '',
    topics: parsePostingTopicsFromRuntimeEnv(env),
  };
}

function formatRuntimeAutoReclaimContent(
  machineId: string,
  env: ReturnType<typeof resolveRuntimeAutoReclaimContentEnv>,
): string {
  const memoDisplay = env.memo ? env.memo : '(unset)';
  const topicsDisplay = env.topics.length > 0 ? env.topics.join(', ') : '(unset)';
  return [
    `Auto reclaim content (${machineId.slice(0, 12)}):`,
    `- ${AUTO_RECLAIM_MEMO_ENV_KEY}=${memoDisplay}`,
    `- ${POSTING_TOPICS_JSON_ENV_KEY}=${topicsDisplay}`,
    '- Resolution order: AGENT_AUTO_RECLAIM_MEMO -> SOUL memo -> posting topics context.',
  ].join('\n');
}

function buildRuntimeAutoReclaimContentHelpText(): string {
  return [
    'Auto reclaim slash commands:',
    '- `/reclaim show`',
    '- `/reclaim memo <text>`',
    '- `/reclaim memo clear`',
    '- `/reclaim topics <topic1, topic2>`',
    '- `/reclaim topics clear`',
    '- `/set reclaim memo <text>`',
    '- `/set reclaim topics <topic1, topic2>`',
  ].join('\n');
}

async function runRuntimeAutoReclaimContentCommand(
  command: RuntimeAutoReclaimContentCommand,
  soulMint: string,
): Promise<string> {
  if (command.action === 'help') {
    return buildRuntimeAutoReclaimContentHelpText();
  }

  if (command.action === 'invalid') {
    return `Auto reclaim command error: ${command.reason}\n\n${buildRuntimeAutoReclaimContentHelpText()}`;
  }

  const fly = getFlyClient();
  const machine = await fly.findMachineForAgent(soulMint);
  if (!machine) {
    return 'Auto reclaim command failed: agent runtime is not deployed.';
  }

  const currentEnv = machine.config?.env || {};
  const resolvedCurrent = resolveRuntimeAutoReclaimContentEnv(currentEnv);
  if (command.action === 'show') {
    return formatRuntimeAutoReclaimContent(machine.id, resolvedCurrent);
  }

  const nextResolved = {
    ...resolvedCurrent,
  };

  if (command.updates.clearMemo) {
    nextResolved.memo = '';
  } else if (typeof command.updates.memo === 'string') {
    nextResolved.memo = command.updates.memo;
  }

  if (command.updates.clearTopics) {
    nextResolved.topics = [];
  } else if (Array.isArray(command.updates.topics)) {
    nextResolved.topics = normalizePostingTopics(command.updates.topics);
  }

  const nextEnv = {
    ...currentEnv,
    [AUTO_RECLAIM_MEMO_ENV_KEY]: nextResolved.memo,
    [POSTING_TOPICS_JSON_ENV_KEY]:
      nextResolved.topics.length > 0
        ? JSON.stringify(nextResolved.topics)
        : '',
    [POSTING_TOPICS_CSV_ENV_KEY]: nextResolved.topics.join('|'),
  };

  await fly.updateMachineConfig(machine.id, {
    ...machine.config,
    env: nextEnv,
  });

  let restartStatus = '- restart: not required';
  if (machine.state === 'started' || machine.state === 'starting') {
    try {
      await fly.restartMachine(machine.id);
      restartStatus = '- restart: requested';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'restart failed';
      restartStatus = `- restart: skipped (${message})`;
    }
  }

  return [
    'Updated auto reclaim content settings.',
    formatRuntimeAutoReclaimContent(machine.id, nextResolved),
    restartStatus,
  ].join('\n');
}

async function runRuntimeAutoReclaimContentCommandSafe(
  command: RuntimeAutoReclaimContentCommand,
  soulMint: string,
): Promise<string> {
  try {
    return await runRuntimeAutoReclaimContentCommand(command, soulMint);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'unknown auto reclaim content error';
    return `Auto reclaim command failed: ${message}`;
  }
}

function parseCronCadence(messageLower: string):
  | { intervalMinutes?: number; cronExpression?: string; cadenceLabel: string }
  | { error: string }
  | null {
  const daily = /\b(daily|every\s+day)\b/.exec(messageLower);
  if (daily) {
    return { cronExpression: '0 0 * * *', cadenceLabel: 'daily' };
  }

  const minuteMatch = /every\s+(\d+)\s*(m|min|mins|minute|minutes)\b/.exec(messageLower)
    || /\b(\d+)\s*(m|min|mins|minute|minutes)\b/.exec(messageLower);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 59) {
      return { error: 'Minute cadence must be between 1 and 59' };
    }
    return {
      intervalMinutes: minutes,
      cadenceLabel: `every ${minutes} minute(s)`,
    };
  }

  const hourMatch = /every\s+(\d+)\s*(h|hr|hrs|hour|hours)\b/.exec(messageLower)
    || /\b(\d+)\s*(h|hr|hrs|hour|hours)\b/.exec(messageLower);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
      return { error: 'Hour cadence must be between 1 and 24' };
    }
    if (hours === 24) {
      return { cronExpression: '0 0 * * *', cadenceLabel: 'daily' };
    }
    return {
      cronExpression: `0 */${hours} * * *`,
      cadenceLabel: `every ${hours} hour(s)`,
    };
  }

  return null;
}

function parseCronChatCommand(message: string): CronChatCommand | null {
  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  const explicit = lower.startsWith('/cron');
  const mentionsCron = /\bcron\b/.test(lower);

  if (!explicit && !mentionsCron) return null;

  if (/\b(list|show|status|jobs?)\b/.test(lower)) {
    return { action: 'list' };
  }

  if (/\b(remove|stop|disable|delete|cancel)\b/.test(lower)) {
    return { action: 'remove' };
  }

  if (/\b(start|install|enable|run|set|schedule)\b/.test(lower)) {
    const cadence = parseCronCadence(lower);
    if (cadence && 'error' in cadence) {
      return { action: 'invalid', reason: cadence.error };
    }

    if (cadence) {
      return { action: 'install', ...cadence };
    }

    if (explicit) {
      return {
        action: 'install',
        intervalMinutes: 10,
        cadenceLabel: 'every 10 minute(s)',
      };
    }
  }

  if (explicit) {
    return { action: 'help' };
  }

  if (mentionsCron) {
    const cadence = parseCronCadence(lower);
    if (cadence && 'error' in cadence) {
      return { action: 'invalid', reason: cadence.error };
    }
    if (cadence) {
      return { action: 'install', ...cadence };
    }
  }

  return null;
}

type RuntimeSchedulerEnvUpdate = Partial<{
  RUNTIME_SCHEDULER_ENABLED: 'true' | 'false';
  RUNTIME_SCHEDULER_INTERVAL_MINUTES: string;
  RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS: string;
  RUNTIME_SCHEDULER_MODE: typeof DEFAULT_RUNTIME_SCHEDULER_MODE;
  RUNTIME_AUTO_RECLAIM: 'true' | 'false';
}>;

type RuntimeSchedulerChatCommand =
  | { action: 'show' }
  | { action: 'set'; updates: RuntimeSchedulerEnvUpdate }
  | { action: 'help' }
  | { action: 'invalid'; reason: string };

function parseRuntimeSchedulerIntervalMinutes(messageLower: string): number | null {
  if (/\b(daily|every\s+day|once\s+a\s+day)\b/.test(messageLower)) {
    return 1440;
  }

  const minuteMatch =
    /(?:every|interval(?:\s+to)?|set(?:\s+interval)?(?:\s+to)?)\s+(\d+)\s*(?:m|min|mins|minute|minutes)\b/.exec(
      messageLower,
    ) ||
    /\b(\d+)\s*(?:m|min|mins|minute|minutes)\b/.exec(messageLower);
  if (minuteMatch) {
    const minutes = Number(minuteMatch[1]);
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440) {
      return minutes;
    }
    return null;
  }

  const hourMatch =
    /(?:every|interval(?:\s+to)?|set(?:\s+interval)?(?:\s+to)?)\s+(\d+)\s*(?:h|hr|hrs|hour|hours)\b/.exec(
      messageLower,
    ) ||
    /\b(\d+)\s*(?:h|hr|hrs|hour|hours)\b/.exec(messageLower);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    if (Number.isFinite(hours) && hours >= 1 && hours <= 24) {
      return hours * 60;
    }
  }

  return null;
}

function parseRuntimeSchedulerStartupDelaySeconds(messageLower: string): number | null {
  const startupMatch =
    /(?:startup(?:\s+delay)?|first\s+run\s+delay|delay)\s*(?:to|=|of)?\s*(\d+)\s*(?:s|sec|secs|second|seconds)\b/.exec(
      messageLower,
    ) ||
    /\b(\d+)\s*(?:s|sec|secs|second|seconds)\s+(?:startup|delay)\b/.exec(
      messageLower,
    );

  if (!startupMatch) return null;
  const seconds = Number(startupMatch[1]);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
    return null;
  }
  return seconds;
}

function parseRuntimeSchedulerChatCommand(message: string): RuntimeSchedulerChatCommand | null {
  const trimmed = message.trim();
  const messageLower = trimmed.toLowerCase();
  const explicit = messageLower.startsWith('/scheduler');
  const mentionsScheduler =
    /\bruntime\s+scheduler\b/.test(messageLower) || /\bscheduler\b/.test(messageLower);
  const mentionsAutoReclaim =
    /auto[\s-]?(reclaim|claim)|automatically\s+reclaim|reclaim\s+lost\s+alpha/.test(
      messageLower,
    );
  const mentionsSchedulerEnv =
    /runtime_scheduler_enabled|runtime_scheduler_interval_minutes|runtime_scheduler_startup_delay_seconds|runtime_scheduler_mode|runtime_auto_reclaim/.test(
      messageLower,
    );

  if (
    !explicit &&
    !mentionsScheduler &&
    !mentionsAutoReclaim &&
    !mentionsSchedulerEnv
  ) {
    return null;
  }

  if (explicit && /\bhelp\b/.test(messageLower)) {
    return { action: 'help' };
  }

  if (
    /(?:\bwhat(?:'s| is)?\b.*\bset\b|\bshow\b|\blist\b|\bstatus\b|\bsettings?\b|\bconfig(?:uration)?\b|\bcurrent\b)/.test(
      messageLower,
    ) &&
    (mentionsScheduler || mentionsAutoReclaim || mentionsSchedulerEnv || explicit)
  ) {
    return { action: 'show' };
  }

  const updates: RuntimeSchedulerEnvUpdate = {};

  const envEnabled = /runtime_scheduler_enabled\s*=\s*(true|false)/.exec(
    messageLower,
  );
  if (envEnabled) {
    updates.RUNTIME_SCHEDULER_ENABLED =
      envEnabled[1] === 'true' ? 'true' : 'false';
  }

  const envInterval = /runtime_scheduler_interval_minutes\s*=\s*(\d+)/.exec(
    messageLower,
  );
  if (envInterval) {
    const intervalMinutes = Number(envInterval[1]);
    if (intervalMinutes < 1 || intervalMinutes > 1440) {
      return {
        action: 'invalid',
        reason: 'RUNTIME_SCHEDULER_INTERVAL_MINUTES must be between 1 and 1440',
      };
    }
    updates.RUNTIME_SCHEDULER_INTERVAL_MINUTES = String(intervalMinutes);
  }

  const envStartup =
    /runtime_scheduler_startup_delay_seconds\s*=\s*(\d+)/.exec(messageLower);
  if (envStartup) {
    const startupDelaySeconds = Number(envStartup[1]);
    if (startupDelaySeconds < 0 || startupDelaySeconds > 3600) {
      return {
        action: 'invalid',
        reason:
          'RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS must be between 0 and 3600',
      };
    }
    updates.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS = String(startupDelaySeconds);
  }

  const envMode = /runtime_scheduler_mode\s*=\s*([a-z-_]+)/.exec(messageLower);
  if (envMode) {
    if (envMode[1] !== DEFAULT_RUNTIME_SCHEDULER_MODE) {
      return {
        action: 'invalid',
        reason: `RUNTIME_SCHEDULER_MODE must be ${DEFAULT_RUNTIME_SCHEDULER_MODE}`,
      };
    }
    updates.RUNTIME_SCHEDULER_MODE = DEFAULT_RUNTIME_SCHEDULER_MODE;
  }

  const envAutoReclaim = /runtime_auto_reclaim\s*=\s*(true|false)/.exec(
    messageLower,
  );
  if (envAutoReclaim) {
    updates.RUNTIME_AUTO_RECLAIM =
      envAutoReclaim[1] === 'true' ? 'true' : 'false';
  }

  if (
    /\b(enable|turn\s+on|start)\b.*\b(scheduler|runtime\s+scheduler)\b/.test(
      messageLower,
    ) ||
    /\b(scheduler|runtime\s+scheduler)\b.*\b(enable|turn\s+on)\b/.test(
      messageLower,
    )
  ) {
    updates.RUNTIME_SCHEDULER_ENABLED = 'true';
  }
  if (
    /\b(disable|turn\s+off|stop|pause)\b.*\b(scheduler|runtime\s+scheduler)\b/.test(
      messageLower,
    ) ||
    /\b(scheduler|runtime\s+scheduler)\b.*\b(disable|turn\s+off|stop|pause)\b/.test(
      messageLower,
    )
  ) {
    updates.RUNTIME_SCHEDULER_ENABLED = 'false';
  }

  const intervalMinutes = parseRuntimeSchedulerIntervalMinutes(messageLower);
  if (
    intervalMinutes !== null &&
    (mentionsScheduler ||
      explicit ||
      /\binterval\b|\bevery\b|\bdaily\b/.test(messageLower))
  ) {
    updates.RUNTIME_SCHEDULER_INTERVAL_MINUTES = String(intervalMinutes);
  }

  const startupDelaySeconds =
    parseRuntimeSchedulerStartupDelaySeconds(messageLower);
  if (startupDelaySeconds !== null) {
    updates.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS = String(
      startupDelaySeconds,
    );
  }

  if (
    /\balpha[-\s]?maintenance\b/.test(messageLower) ||
    /\bmaintenance\s+mode\b/.test(messageLower)
  ) {
    updates.RUNTIME_SCHEDULER_MODE = DEFAULT_RUNTIME_SCHEDULER_MODE;
  }

  const disableAutoReclaim =
    /\b(disable|dsiable|turn\s+off|stop|no|don'?t|do\s+not)\b[^.]*\b(auto[\s-]?(reclaim|claim)|automatically\s+reclaim)\b/.test(
      messageLower,
    ) ||
    /\b(auto[\s-]?(reclaim|claim))\b[^.]*\b(off|disabled|false)\b/.test(
      messageLower,
    );
  const enableAutoReclaim =
    /\b(enable|turn\s+on|start|set|try)\b[^.]*\b(auto[\s-]?(reclaim|claim)|automatically\s+reclaim|reclaim\s+lost\s+alpha)\b/.test(
      messageLower,
    ) ||
    /\b(auto[\s-]?(reclaim|claim)|automatically\s+reclaim|reclaim\s+lost\s+alpha)\b[^.]*\b(on|enabled|true)\b/.test(
      messageLower,
    );

  if (disableAutoReclaim) {
    updates.RUNTIME_AUTO_RECLAIM = 'false';
  } else if (enableAutoReclaim) {
    updates.RUNTIME_AUTO_RECLAIM = 'true';
  }

  if (Object.keys(updates).length > 0) {
    return { action: 'set', updates };
  }

  if (explicit) {
    return { action: 'help' };
  }

  if (mentionsScheduler || mentionsAutoReclaim || mentionsSchedulerEnv) {
    return { action: 'show' };
  }

  return null;
}

function runCronScript(args: string[]): { ok: boolean; output: string; error?: string } {
  const scriptPath = path.join(process.cwd(), 'scripts', 'agent-cron.mjs');
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 30_000,
  });

  if (result.error) {
    return { ok: false, output: '', error: result.error.message };
  }

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();
  if (result.status !== 0) {
    return {
      ok: false,
      output: stdout,
      error: stderr || `agent-cron exited with status ${result.status}`,
    };
  }

  return { ok: true, output: stdout || 'OK' };
}

function buildCronHelpText(): string {
  return [
    'Cron control commands:',
    '- `/cron list`',
    '- `/cron remove`',
    '- `/cron install every 10 minutes`',
    '- `/cron install every 2 hours`',
    '- `/cron install daily`',
    '',
    'Hosted deployments use Fly runtime scheduler env vars.',
    'Local/self-hosted machines can also use OS crontab.',
  ].join('\n');
}

function isCrontabUnavailableError(error: string | undefined): boolean {
  if (!error) return false;
  const normalized = error.toLowerCase();
  return (
    normalized.includes('crontab command is not available') ||
    normalized.includes('enoent') ||
    normalized.includes('no such file or directory')
  );
}

type CronBackend = 'auto' | 'local' | 'runtime';

function resolveCronBackend(): CronBackend {
  const configured = (process.env.CRON_COMMAND_BACKEND || '').trim().toLowerCase();
  if (configured === 'auto' || configured === 'local' || configured === 'runtime') {
    return configured;
  }

  // Hosted serverless environments do not provide OS crontab, so default
  // to runtime scheduler controls backed by Fly machine env vars.
  if (
    process.env.VERCEL === '1' ||
    process.env.VERCEL_ENV === 'production' ||
    process.env.VERCEL_ENV === 'preview'
  ) {
    return 'runtime';
  }

  return 'auto';
}

function parseCronExpressionToIntervalMinutes(expression: string): number | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== '*' || month !== '*' || dayOfWeek !== '*') {
    return null;
  }

  const minuteEvery = minute.match(/^\*\/(\d+)$/);
  if (minuteEvery && hour === '*') {
    const minutes = Number(minuteEvery[1]);
    if (Number.isFinite(minutes) && minutes >= 1 && minutes <= 59) {
      return minutes;
    }
  }

  const hourEvery = hour.match(/^\*\/(\d+)$/);
  if (minute === '0' && hourEvery) {
    const hours = Number(hourEvery[1]);
    if (Number.isFinite(hours) && hours >= 1 && hours <= 24) {
      return hours * 60;
    }
  }

  if (minute === '0' && hour === '0') {
    return 1440;
  }

  return null;
}

function resolveRuntimeSchedulerIntervalMinutes(command: CronChatCommand): number | null {
  if (command.action !== 'install') return null;

  if (typeof command.intervalMinutes === 'number') {
    return command.intervalMinutes;
  }

  if (command.cronExpression) {
    return parseCronExpressionToIntervalMinutes(command.cronExpression);
  }

  return 10;
}

function runLocalCronCommand(
  command: CronChatCommand,
  soulMint: string,
): { ok: boolean; output: string; error?: string } {
  if (command.action === 'list') {
    return runCronScript(['list']);
  }

  if (command.action === 'remove') {
    return runCronScript(['remove', '--agent', soulMint]);
  }

  if (command.action === 'install') {
    const installArgs = ['install', '--agent', soulMint];
    if (command.cronExpression) {
      installArgs.push('--cron', command.cronExpression);
    } else {
      installArgs.push('--interval', String(command.intervalMinutes || 10));
    }
    return runCronScript(installArgs);
  }

  return { ok: false, output: '', error: 'Unsupported local cron command' };
}

function resolveRuntimeSchedulerEnv(env: Record<string, string>) {
  return {
    RUNTIME_SCHEDULER_ENABLED:
      env.RUNTIME_SCHEDULER_ENABLED || DEFAULT_RUNTIME_SCHEDULER_ENABLED,
    RUNTIME_SCHEDULER_INTERVAL_MINUTES:
      env.RUNTIME_SCHEDULER_INTERVAL_MINUTES ||
      DEFAULT_RUNTIME_SCHEDULER_INTERVAL_MINUTES,
    RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS:
      env.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS ||
      String(DEFAULT_RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS),
    RUNTIME_SCHEDULER_MODE:
      env.RUNTIME_SCHEDULER_MODE || DEFAULT_RUNTIME_SCHEDULER_MODE,
    RUNTIME_AUTO_RECLAIM: env.RUNTIME_AUTO_RECLAIM || DEFAULT_RUNTIME_AUTO_RECLAIM,
  };
}

function formatRuntimeSchedulerEnv(
  machineId: string,
  env: ReturnType<typeof resolveRuntimeSchedulerEnv>,
): string {
  return [
    `Runtime scheduler (${machineId.slice(0, 12)}):`,
    `- RUNTIME_SCHEDULER_ENABLED=${env.RUNTIME_SCHEDULER_ENABLED}`,
    `- RUNTIME_SCHEDULER_INTERVAL_MINUTES=${env.RUNTIME_SCHEDULER_INTERVAL_MINUTES}`,
    `- RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS=${env.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS}`,
    `- RUNTIME_SCHEDULER_MODE=${env.RUNTIME_SCHEDULER_MODE}`,
    `- RUNTIME_AUTO_RECLAIM=${env.RUNTIME_AUTO_RECLAIM}`,
  ].join('\n');
}

function buildRuntimeSchedulerHelpText(): string {
  return [
    'Runtime scheduler controls:',
    '- `show scheduler settings`',
    '- `enable scheduler`',
    '- `disable scheduler`',
    '- `set scheduler interval to 10 minutes`',
    '- `set startup delay to 20 seconds`',
    '- `set mode to alpha-maintenance`',
    '- `enable auto reclaim` / `disable auto reclaim`',
    '',
    'Advanced:',
    '- `RUNTIME_SCHEDULER_ENABLED=true`',
    '- `RUNTIME_SCHEDULER_INTERVAL_MINUTES=10`',
    '- `RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS=20`',
    '- `RUNTIME_SCHEDULER_MODE=alpha-maintenance`',
    '- `RUNTIME_AUTO_RECLAIM=false`',
  ].join('\n');
}

async function runRuntimeSchedulerChatCommand(
  command: RuntimeSchedulerChatCommand,
  soulMint: string,
): Promise<string> {
  if (command.action === 'help') {
    return buildRuntimeSchedulerHelpText();
  }

  if (command.action === 'invalid') {
    return `Scheduler command error: ${command.reason}\n\n${buildRuntimeSchedulerHelpText()}`;
  }

  const fly = getFlyClient();
  const machine = await fly.findMachineForAgent(soulMint);

  if (!machine) {
    return 'Runtime scheduler command failed: agent runtime is not deployed.';
  }

  const currentEnv = machine.config?.env || {};
  const resolvedCurrent = resolveRuntimeSchedulerEnv(currentEnv);
  if (command.action === 'show') {
    return formatRuntimeSchedulerEnv(machine.id, resolvedCurrent);
  }

  const nextResolved = {
    ...resolvedCurrent,
    ...command.updates,
  };
  const nextEnv = {
    ...currentEnv,
    ...nextResolved,
  };

  await fly.updateMachineConfig(machine.id, {
    ...machine.config,
    env: nextEnv,
  });

  let restartStatus = '- restart: not required';
  if (machine.state === 'started' || machine.state === 'starting') {
    try {
      await fly.restartMachine(machine.id);
      restartStatus = '- restart: requested';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'restart failed';
      restartStatus = `- restart: skipped (${message})`;
    }
  }

  return [
    'Updated runtime scheduler settings.',
    formatRuntimeSchedulerEnv(machine.id, nextResolved),
    restartStatus,
  ].join('\n');
}

async function runRuntimeSchedulerChatCommandSafe(
  command: RuntimeSchedulerChatCommand,
  soulMint: string,
): Promise<string> {
  try {
    return await runRuntimeSchedulerChatCommand(command, soulMint);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'unknown runtime scheduler error';
    return `Runtime scheduler command failed: ${message}`;
  }
}

async function runRuntimeSchedulerCommand(
  command: Extract<CronChatCommand, { action: 'list' | 'remove' | 'install' }>,
  soulMint: string,
): Promise<string> {
  const fly = getFlyClient();
  const machine = await fly.findMachineForAgent(soulMint);

  if (!machine) {
    return 'Runtime scheduler command failed: agent runtime is not deployed.';
  }

  const currentEnv = machine.config?.env || {};
  const resolvedCurrent = resolveRuntimeSchedulerEnv(currentEnv);

  if (command.action === 'list') {
    return formatRuntimeSchedulerEnv(machine.id, resolvedCurrent);
  }

  let nextEnabled = resolvedCurrent.RUNTIME_SCHEDULER_ENABLED;
  let nextInterval = resolvedCurrent.RUNTIME_SCHEDULER_INTERVAL_MINUTES;

  if (command.action === 'remove') {
    nextEnabled = 'false';
  }

  if (command.action === 'install') {
    const intervalMinutes = resolveRuntimeSchedulerIntervalMinutes(command);
    if (!intervalMinutes) {
      return [
        'Runtime scheduler supports fixed intervals only.',
        'Use one of:',
        '- `/cron install every 10 minutes`',
        '- `/cron install every 2 hours`',
        '- `/cron install daily`',
      ].join('\n');
    }

    nextEnabled = 'true';
    nextInterval = String(intervalMinutes);
  }

  const nextEnv = {
    ...currentEnv,
    RUNTIME_SCHEDULER_ENABLED: nextEnabled,
    RUNTIME_SCHEDULER_INTERVAL_MINUTES: nextInterval,
    RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS:
      currentEnv.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS ||
      String(DEFAULT_RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS),
    RUNTIME_SCHEDULER_MODE:
      currentEnv.RUNTIME_SCHEDULER_MODE || DEFAULT_RUNTIME_SCHEDULER_MODE,
    RUNTIME_AUTO_RECLAIM:
      currentEnv.RUNTIME_AUTO_RECLAIM || DEFAULT_RUNTIME_AUTO_RECLAIM,
  };

  await fly.updateMachineConfig(machine.id, {
    ...machine.config,
    env: nextEnv,
  });

  let restartStatus = '- restart: not required';
  if (machine.state === 'started' || machine.state === 'starting') {
    try {
      await fly.restartMachine(machine.id);
      restartStatus = '- restart: requested';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'restart failed';
      restartStatus = `- restart: skipped (${message})`;
    }
  }

  if (command.action === 'remove') {
    return [
      'Runtime scheduler disabled.',
      `Machine: ${machine.id.slice(0, 12)}`,
      '- RUNTIME_SCHEDULER_ENABLED=false',
      restartStatus,
    ].join('\n');
  }

  return [
    `Runtime scheduler enabled (${command.cadenceLabel}).`,
    formatRuntimeSchedulerEnv(machine.id, resolveRuntimeSchedulerEnv(nextEnv)),
    restartStatus,
  ].join('\n');
}

async function runRuntimeSchedulerCommandSafe(
  command: Extract<CronChatCommand, { action: 'list' | 'remove' | 'install' }>,
  soulMint: string,
): Promise<string> {
  try {
    return await runRuntimeSchedulerCommand(command, soulMint);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown runtime scheduler error';
    return `Runtime scheduler command failed: ${message}`;
  }
}

async function handleCronChatCommand(command: CronChatCommand, soulMint: string): Promise<string> {
  if (command.action === 'help') {
    return buildCronHelpText();
  }

  if (command.action === 'invalid') {
    return `Cron command error: ${command.reason}\n\n${buildCronHelpText()}`;
  }

  const backend = resolveCronBackend();
  const commandType = command as Extract<CronChatCommand, { action: 'list' | 'remove' | 'install' }>;

  if (backend === 'runtime') {
    return runRuntimeSchedulerCommandSafe(commandType, soulMint);
  }

  const localResult = runLocalCronCommand(commandType, soulMint);
  if (localResult.ok) {
    if (command.action === 'install') {
      return `Cron installed (${command.cadenceLabel}).\n${localResult.output}`;
    }
    return localResult.output;
  }

  if (backend !== 'local' && isCrontabUnavailableError(localResult.error)) {
    return runRuntimeSchedulerCommandSafe(commandType, soulMint);
  }

  if (command.action === 'install') {
    return `Failed to install cron job: ${localResult.error || 'unknown error'}`;
  }
  if (command.action === 'remove') {
    return `Failed to remove cron job: ${localResult.error || 'unknown error'}`;
  }
  return `Failed to list cron jobs: ${localResult.error || 'unknown error'}`;
}

/**
 * POST /api/agent/[id]/chat
 * Proxy chat messages to the agent's OpenClaw gateway running on Fly.
 *
 * Body: { message: string, history?: { role: string; content: string }[] }
 *
 * The OpenClaw gateway runs on port 3001 inside the Fly machine.
 * The machine has a services config that exposes 3001 via the app's .fly.dev domain.
 * We use the `fly-force-instance-id` header to route to the specific machine.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: soulMint } = await params;
    const body = await request.json();
    const { message, history, model } = body;
    const requestedModel =
      typeof model === 'string' && model.trim() ? model.trim() : 'default';

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    const runtimeAutoReclaimContentCommand =
      parseRuntimeAutoReclaimContentCommand(message);
    if (runtimeAutoReclaimContentCommand) {
      const response = await runRuntimeAutoReclaimContentCommandSafe(
        runtimeAutoReclaimContentCommand,
        soulMint,
      );
      return NextResponse.json({ response });
    }

    const runtimeSchedulerCommand = parseRuntimeSchedulerChatCommand(message);
    if (runtimeSchedulerCommand) {
      const response = await runRuntimeSchedulerChatCommandSafe(
        runtimeSchedulerCommand,
        soulMint,
      );
      return NextResponse.json({ response });
    }

    const cronCommand = parseCronChatCommand(message);
    if (cronCommand) {
      const response = await handleCronChatCommand(cronCommand, soulMint);
      return NextResponse.json({ response });
    }

    // Find the machine for this agent
    const fly = getFlyClient();
    const machine = await fly.findMachineForAgent(soulMint);

    if (!machine) {
      return NextResponse.json({ error: 'Agent runtime not deployed' }, { status: 404 });
    }

    if (machine.state !== 'started') {
      return NextResponse.json(
        { error: `Agent runtime is ${machine.state}, not running` },
        { status: 503 },
      );
    }

    // Build messages array for OpenClaw chat completions endpoint
    const messages = [...(history || []), { role: 'user', content: message }];

    const runtimeProvider = normalizeRuntimeProvider(
      machine.config?.env?.AGENT_RUNTIME_PROVIDER ||
        machine.config?.env?.RUNTIME_PROVIDER,
    );
    const runtimeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'fly-force-instance-id': machine.id,
    };
    if (runtimeProvider === 'ironclaw') {
      const gatewayAuthToken = (
        process.env.FLY_IRONCLAW_GATEWAY_AUTH_TOKEN ||
        process.env.IRONCLAW_GATEWAY_AUTH_TOKEN ||
        process.env.GATEWAY_AUTH_TOKEN ||
        machine.config?.env?.GATEWAY_AUTH_TOKEN ||
        ''
      ).trim();
      if (!gatewayAuthToken) {
        return NextResponse.json(
          { error: 'IronClaw runtime missing gateway auth token. Redeploy runtime.' },
          { status: 502 },
        );
      }
      runtimeHeaders.Authorization = `Bearer ${gatewayAuthToken}`;
    }

    // Route to the specific machine via Fly's Anycast proxy + fly-force-instance-id header.
    // The machine's services config exposes internal_port 3001 on external port 443.
    const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
    const chatUrl = `https://${appName}.fly.dev/v1/chat/completions`;
    const requestBody: Record<string, unknown> = {
      messages,
      stream: false,
    };
    const ironclawLlmBackend =
      runtimeProvider === 'ironclaw'
        ? (machine.config?.env?.LLM_BACKEND || '').trim().toLowerCase()
        : '';
    let ironclawDefaultModel: string | null = null;
    let ironclawActiveModel: string | null = null;
    if (runtimeProvider === 'ironclaw') {
      if (ironclawLlmBackend === 'nearai' || !ironclawLlmBackend) {
        ironclawDefaultModel = (
          machine.config?.env?.NEARAI_MODEL ||
          process.env.FLY_IRONCLAW_NEARAI_MODEL ||
          process.env.NEARAI_MODEL ||
          'zai-org/GLM-latest'
        ).trim();
        const shouldUseDefaultModel =
          requestedModel === 'default' ||
          OPENROUTER_DEFAULT_MODEL_IDS.has(requestedModel);
        ironclawActiveModel = shouldUseDefaultModel
          ? ironclawDefaultModel
          : requestedModel;
        requestBody.model = ironclawActiveModel;
      } else {
        // Non-NEAR backends select model from runtime config and may ignore per-request overrides.
        ironclawActiveModel = (machine.config?.env?.LLM_MODEL || process.env.LLM_MODEL || '').trim() || null;
        requestBody.model = ironclawActiveModel || requestedModel;
      }
    } else {
      requestBody.model = requestedModel;
    }

    const sendChatRequest = () =>
      fetch(chatUrl, {
        method: 'POST',
        headers: runtimeHeaders,
        body: JSON.stringify(requestBody),
      });
    let chatResponse = await sendChatRequest();

    if (!chatResponse.ok) {
      let errText = await chatResponse.text();
      const modelNotFound =
        runtimeProvider === 'ironclaw' &&
        (ironclawLlmBackend === 'nearai' || !ironclawLlmBackend) &&
        /model\\s+'[^']+'\\s+not found/i.test(errText);

      // Some UI presets are OpenRouter-only; retry once with IronClaw's runtime model.
      if (
        modelNotFound &&
        ironclawDefaultModel &&
        requestBody.model !== ironclawDefaultModel
      ) {
        requestBody.model = ironclawDefaultModel;
        ironclawActiveModel = ironclawDefaultModel;
        chatResponse = await sendChatRequest();
        if (!chatResponse.ok) {
          errText = await chatResponse.text();
        }
      }

      if (!chatResponse.ok) {
        console.error('OpenClaw chat error:', chatResponse.status, errText);
        const errorMessage =
          runtimeProvider === 'ironclaw' &&
          /model\\s+'[^']+'\\s+not found/i.test(errText)
            ? 'Selected model is unavailable on IronClaw runtime.'
            : 'Failed to reach agent runtime';
        return NextResponse.json(
          { error: errorMessage, details: errText },
          { status: 502 },
        );
      }
    }

    const data = await chatResponse.json();
    const assistantMessage =
      data.choices?.[0]?.message?.content || data.response || 'No response';
    const responseModel =
      typeof data.model === 'string' && data.model.trim()
        ? data.model.trim()
        : typeof requestBody.model === 'string' && requestBody.model.trim()
          ? requestBody.model.trim()
          : ironclawActiveModel || requestedModel;

    return NextResponse.json({ response: assistantMessage, model: responseModel });
  } catch (err) {
    console.error('Chat proxy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Chat failed' },
      { status: 500 },
    );
  }
}
