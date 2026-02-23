#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_BASE_URL = 'https://agentshaus.vercel.app';
const DEFAULT_INTERVAL_MINUTES = 10;
const DEFAULT_MESSAGE =
  'Run scheduled maintenance: check_epoch_state and check_my_position. If flipped and reclaim cost is reasonable, run auto_reclaim. Return concise JSON summary.';

function usage() {
  console.log(`Usage:
  node scripts/agent-cron.mjs install --agent <SOUL_MINT> [options]
  node scripts/agent-cron.mjs remove [--agent <SOUL_MINT>]
  node scripts/agent-cron.mjs list

Install options:
  --agent <mint>          Required for install
  --interval <minutes>    Cron interval in minutes (default: ${DEFAULT_INTERVAL_MINUTES})
  --base-url <url>        API base URL (default: ${DEFAULT_BASE_URL})
  --job-name <name>       Job name tag (default: alpha-maintenance)
  --files-dir <path>      Context file directory for scheduler
  --log-file <path>       JSONL run log file
  --message <text>        Scheduled prompt override
`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = value;
    i += 1;
  }
  return args;
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

function readCurrentCrontab() {
  const result = spawnSync('crontab', ['-l'], { encoding: 'utf8' });
  if (result.status === 0) return result.stdout || '';

  const combined = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase();
  if (combined.includes('no crontab for')) return '';
  throw new Error(result.stderr || 'Failed to read crontab');
}

function writeCrontab(contents) {
  const result = spawnSync('crontab', ['-'], {
    encoding: 'utf8',
    input: contents,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to write crontab');
  }
}

function markerFor(agent, jobName) {
  return `# agentshaus:${agent}:${jobName}`;
}

function buildCronLine({
  interval,
  appDir,
  configFile,
  cronOutFile,
  marker,
}) {
  return `*/${interval} * * * * cd ${appDir} && /usr/bin/env node scripts/agent-scheduler.mjs --config ${configFile} >> ${cronOutFile} 2>&1 ${marker}`;
}

async function install(args) {
  const agent = args.agent;
  if (!agent) throw new Error('Missing --agent');

  const interval = Number(args.interval || DEFAULT_INTERVAL_MINUTES);
  if (!Number.isFinite(interval) || interval < 1 || interval > 59) {
    throw new Error('Interval must be between 1 and 59 minutes');
  }

  const jobName = args['job-name'] || 'alpha-maintenance';
  const baseUrl = args['base-url'] || DEFAULT_BASE_URL;

  const stateRoot = path.join(os.homedir(), '.agentshaus');
  const jobsDir = path.join(stateRoot, 'jobs');
  const filesDir = expandHome(args['files-dir'] || path.join(stateRoot, 'files', agent));
  const logsDir = path.join(stateRoot, 'logs');

  await ensureDir(jobsDir);
  await ensureDir(filesDir);
  await ensureDir(logsDir);

  const appDir = process.cwd();
  const configFile = path.join(jobsDir, `${agent}.${jobName}.json`);
  const logFile = expandHome(args['log-file'] || path.join(logsDir, `${agent}.${jobName}.jsonl`));
  const cronOutFile = path.join(logsDir, `${agent}.${jobName}.cron.log`);
  const marker = markerFor(agent, jobName);

  const config = {
    agent,
    jobName,
    baseUrl,
    message: args.message || DEFAULT_MESSAGE,
    filesDir,
    logFile,
    timeoutMs: 45000,
    maxFiles: 5,
    maxFileBytes: 4000,
  };

  await fs.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  const filesReadme = path.join(filesDir, 'README.txt');
  try {
    await fs.access(filesReadme);
  } catch {
    await fs.writeFile(
      filesReadme,
      [
        `Add text/markdown files in this folder to include them in scheduled runs for agent ${agent}.`,
        'Files are clipped for safety to keep prompts short.',
        '',
      ].join('\n'),
      'utf8',
    );
  }

  const current = readCurrentCrontab();
  const lines = current
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const filtered = lines.filter((line) => !line.includes(markerFor(agent, jobName)));
  filtered.push(
    buildCronLine({
      interval,
      appDir,
      configFile,
      cronOutFile,
      marker,
    }),
  );

  writeCrontab(`${filtered.join('\n')}\n`);

  console.log('Installed cron job:');
  console.log(`  agent:     ${agent}`);
  console.log(`  interval:  every ${interval} minute(s)`);
  console.log(`  config:    ${configFile}`);
  console.log(`  run logs:  ${logFile}`);
  console.log(`  cron logs: ${cronOutFile}`);
  console.log(`  files dir: ${filesDir}`);
}

function remove(args) {
  const agent = args.agent || null;
  const current = readCurrentCrontab();
  const lines = current
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  const filtered = lines.filter((line) => {
    if (!line.includes('# agentshaus:')) return true;
    if (!agent) return false;
    return !line.includes(`# agentshaus:${agent}:`);
  });

  writeCrontab(filtered.length > 0 ? `${filtered.join('\n')}\n` : '\n');
  console.log(agent ? `Removed cron jobs for ${agent}` : 'Removed all agentshaus cron jobs');
}

function list() {
  const current = readCurrentCrontab();
  const lines = current
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.includes('# agentshaus:'));

  if (lines.length === 0) {
    console.log('No agentshaus cron jobs found.');
    return;
  }

  console.log('Active agentshaus cron jobs:');
  for (const line of lines) {
    console.log(`  ${line}`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const command = args._[0];

  if (!command || command === 'help' || args.help === 'true') {
    usage();
    process.exit(0);
  }

  if (command === 'install') {
    await install(args);
    return;
  }

  if (command === 'remove') {
    remove(args);
    return;
  }

  if (command === 'list') {
    list();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
