#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_BASE_URL = 'https://agentshaus.vercel.app';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_FILE_BYTES = 4_000;
const DEFAULT_MESSAGE =
  'Run scheduled maintenance: check_epoch_state and check_my_position. If flipped and reclaim cost is reasonable, run auto_reclaim. Return concise JSON summary.';

function usage() {
  console.log(`Usage:
  node scripts/agent-scheduler.mjs --agent <SOUL_MINT> [options]
  node scripts/agent-scheduler.mjs --config <CONFIG_JSON_PATH>

Options:
  --agent <mint>            Agent soul mint (required unless --config includes it)
  --base-url <url>          API base URL (default: ${DEFAULT_BASE_URL})
  --message <text>          Scheduled prompt message
  --model <model-id>        Optional model override
  --files-dir <path>        Optional directory for context files
  --max-files <n>           Max context files to include (default: ${DEFAULT_MAX_FILES})
  --max-file-bytes <n>      Max bytes per context file (default: ${DEFAULT_MAX_FILE_BYTES})
  --log-file <path>         JSONL log file path
  --timeout-ms <n>          Request timeout in ms (default: ${DEFAULT_TIMEOUT_MS})
  --job-name <name>         Optional job name for logs
  --config <path>           JSON config file (CLI flags override config)
`);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      result[key] = 'true';
      continue;
    }
    result[key] = value;
    i += 1;
  }
  return result;
}

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return os.homedir();
  if (inputPath.startsWith('~/')) return path.join(os.homedir(), inputPath.slice(2));
  return inputPath;
}

async function readConfig(configPath) {
  const expanded = expandHome(configPath);
  const raw = await fs.readFile(expanded, 'utf8');
  return JSON.parse(raw);
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

function withTimeout(signalMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), signalMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function normalizeJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function looksText(buffer) {
  return !buffer.includes(0);
}

async function collectContextFiles(filesDir, maxFiles, maxFileBytes) {
  if (!filesDir) return [];
  const resolvedDir = expandHome(filesDir);

  let dirEntries;
  try {
    dirEntries = await fs.readdir(resolvedDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = dirEntries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(resolvedDir, entry.name))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, maxFiles);

  const contexts = [];
  for (const filePath of files) {
    try {
      const bytes = await fs.readFile(filePath);
      if (!looksText(bytes)) continue;
      const clipped = bytes.subarray(0, maxFileBytes);
      const content = clipped.toString('utf8');
      contexts.push({
        file: filePath,
        truncated: bytes.length > clipped.length,
        content,
      });
    } catch {
      // Ignore unreadable files.
    }
  }
  return contexts;
}

function buildPrompt(message, contexts) {
  if (contexts.length === 0) return message;

  const sections = contexts.map((ctx) => {
    const rel = ctx.file;
    const trunc = ctx.truncated ? '\n[truncated]' : '';
    return `File: ${rel}\n\`\`\`\n${ctx.content}${trunc}\n\`\`\``;
  });

  return `${message}\n\nUse these context files when relevant:\n\n${sections.join('\n\n')}`;
}

async function appendLogLine(logFile, record) {
  const resolvedLog = expandHome(logFile);
  await ensureDir(resolvedLog);
  await fs.appendFile(resolvedLog, `${JSON.stringify(record)}\n`, 'utf8');
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help === 'true' || args.h === 'true') {
    usage();
    process.exit(0);
  }

  const fileConfig = args.config ? await readConfig(args.config) : {};
  const config = {
    ...fileConfig,
    ...args,
  };

  const agent = config.agent || config.soulMint;
  if (!agent) {
    usage();
    throw new Error('Missing required --agent');
  }

  const baseUrl = (config['base-url'] || config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const message = config.message || DEFAULT_MESSAGE;
  const model = config.model || '';
  const maxFiles = Number(config['max-files'] || config.maxFiles || DEFAULT_MAX_FILES);
  const maxFileBytes = Number(
    config['max-file-bytes'] || config.maxFileBytes || DEFAULT_MAX_FILE_BYTES,
  );
  const filesDir = config['files-dir'] || config.filesDir || '';
  const timeoutMs = Number(config['timeout-ms'] || config.timeoutMs || DEFAULT_TIMEOUT_MS);
  const jobName = config['job-name'] || config.jobName || 'scheduled-agent-job';
  const defaultLogFile = path.join(os.homedir(), '.agentshaus', 'logs', `${agent}.jsonl`);
  const logFile = config['log-file'] || config.logFile || defaultLogFile;

  const contexts = await collectContextFiles(filesDir, maxFiles, maxFileBytes);
  const prompt = buildPrompt(message, contexts);
  const startedAt = new Date();

  const logRecord = {
    timestamp: startedAt.toISOString(),
    jobName,
    agent,
    baseUrl,
    filesDir: filesDir || null,
    contextFileCount: contexts.length,
    health: null,
    chat: null,
    success: false,
  };

  // Step 1: health check
  const healthTimeout = withTimeout(timeoutMs);
  try {
    const healthRes = await fetch(`${baseUrl}/api/agent/${agent}/health`, {
      method: 'GET',
      signal: healthTimeout.signal,
      headers: { Accept: 'application/json' },
    });
    const healthRaw = await healthRes.text();
    const healthJson = normalizeJson(healthRaw);

    logRecord.health = {
      status: healthRes.status,
      ok: healthRes.ok,
      body: healthJson || healthRaw.slice(0, 500),
    };

    if (!healthRes.ok || !healthJson || healthJson.ok !== true) {
      await appendLogLine(logFile, {
        ...logRecord,
        error: 'Health check failed',
      });
      console.error(`Health check failed for ${agent} (${healthRes.status})`);
      process.exit(1);
    }
  } finally {
    healthTimeout.cleanup();
  }

  // Step 2: scheduled chat run
  const chatTimeout = withTimeout(timeoutMs);
  try {
    const body = {
      message: prompt,
      history: [],
      ...(model ? { model } : {}),
    };

    const chatRes = await fetch(`${baseUrl}/api/agent/${agent}/chat`, {
      method: 'POST',
      signal: chatTimeout.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const chatRaw = await chatRes.text();
    const chatJson = normalizeJson(chatRaw);

    logRecord.chat = {
      status: chatRes.status,
      ok: chatRes.ok,
      response:
        chatJson && typeof chatJson === 'object'
          ? chatJson
          : { raw: chatRaw.slice(0, 1500) },
    };

    logRecord.success = chatRes.ok;
    await appendLogLine(logFile, logRecord);

    if (!chatRes.ok) {
      console.error(`Scheduled run failed for ${agent} (${chatRes.status})`);
      process.exit(1);
    }

    console.log(
      `Scheduled run succeeded for ${agent} at ${startedAt.toISOString()} (contexts=${contexts.length})`,
    );
  } finally {
    chatTimeout.cleanup();
  }
}

run().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

