import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getFlyClient } from '@/lib/fly-machines';

type CronChatCommand =
  | { action: 'list' }
  | { action: 'remove' }
  | { action: 'install'; intervalMinutes?: number; cronExpression?: string; cadenceLabel: string }
  | { action: 'help' }
  | { action: 'invalid'; reason: string };

const DEFAULT_RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS = 20;
const DEFAULT_RUNTIME_SCHEDULER_MODE = 'alpha-maintenance';
const DEFAULT_RUNTIME_AUTO_RECLAIM = 'true';

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

  if (command.action === 'list') {
    return [
      `Runtime scheduler (${machine.id.slice(0, 12)}):`,
      `- enabled: ${currentEnv.RUNTIME_SCHEDULER_ENABLED || 'false'}`,
      `- intervalMinutes: ${currentEnv.RUNTIME_SCHEDULER_INTERVAL_MINUTES || '10'}`,
      `- startupDelaySeconds: ${currentEnv.RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS || String(DEFAULT_RUNTIME_SCHEDULER_STARTUP_DELAY_SECONDS)}`,
      `- mode: ${currentEnv.RUNTIME_SCHEDULER_MODE || DEFAULT_RUNTIME_SCHEDULER_MODE}`,
      `- autoReclaim: ${currentEnv.RUNTIME_AUTO_RECLAIM || DEFAULT_RUNTIME_AUTO_RECLAIM}`,
    ].join('\n');
  }

  let nextEnabled = currentEnv.RUNTIME_SCHEDULER_ENABLED || 'false';
  let nextInterval = currentEnv.RUNTIME_SCHEDULER_INTERVAL_MINUTES || '10';

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
      '- enabled: false',
      restartStatus,
    ].join('\n');
  }

  return [
    `Runtime scheduler enabled (${command.cadenceLabel}).`,
    `Machine: ${machine.id.slice(0, 12)}`,
    `- enabled: true`,
    `- intervalMinutes: ${nextInterval}`,
    `- mode: ${nextEnv.RUNTIME_SCHEDULER_MODE}`,
    `- autoReclaim: ${nextEnv.RUNTIME_AUTO_RECLAIM}`,
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

    // Route to the specific machine via Fly's Anycast proxy + fly-force-instance-id header.
    // The machine's services config exposes internal_port 3001 on external port 443.
    const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
    const chatUrl = `https://${appName}.fly.dev/v1/chat/completions`;

    const chatResponse = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'fly-force-instance-id': machine.id,
      },
      body: JSON.stringify({
        messages,
        model: requestedModel,
        stream: false,
      }),
    });

    if (!chatResponse.ok) {
      const errText = await chatResponse.text();
      console.error('OpenClaw chat error:', chatResponse.status, errText);
      return NextResponse.json(
        { error: 'Failed to reach agent runtime', details: errText },
        { status: 502 },
      );
    }

    const data = await chatResponse.json();
    const assistantMessage =
      data.choices?.[0]?.message?.content || data.response || 'No response';
    const responseModel =
      typeof data.model === 'string' && data.model.trim()
        ? data.model.trim()
        : requestedModel;

    return NextResponse.json({ response: assistantMessage, model: responseModel });
  } catch (err) {
    console.error('Chat proxy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Chat failed' },
      { status: 500 },
    );
  }
}
