import { NextRequest, NextResponse } from 'next/server';
import { getFlyClient, type FlyMachine } from '@/lib/fly-machines';
import { requireAgentOwnership } from '@/lib/agent-ownership-auth';

type FileRootKey = 'user' | 'workspace';
type RuntimeTreeNode = {
  type?: unknown;
  name?: unknown;
  path?: unknown;
  childCount?: unknown;
  children?: unknown;
  [key: string]: unknown;
};

const RUNTIME_PROXY_TIMEOUT_MS = Number.parseInt(
  process.env.RUNTIME_PROXY_TIMEOUT_MS || '12000',
  10,
);
const ALLOWED_FILE_ROOTS = new Set<FileRootKey>(['user', 'workspace']);
const SENSITIVE_PATH_SEGMENTS = new Set([
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
  '.secrets',
]);
const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa$/i,
  /^id_ed25519$/i,
  /^authorized_keys$/i,
  /^known_hosts$/i,
];

function isSensitiveToken(value: string): boolean {
  const token = value.trim().toLowerCase();
  if (!token) return false;
  return SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(token));
}

function looksSensitivePath(value: string): boolean {
  const normalized = value
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .trim();
  if (!normalized) return false;

  const segments = normalized.split('/').filter(Boolean);
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (SENSITIVE_PATH_SEGMENTS.has(lower) || isSensitiveToken(lower)) {
      return true;
    }
  }

  return false;
}

function sanitizeTreeNode(node: unknown): RuntimeTreeNode | null {
  if (!node || typeof node !== 'object') return null;
  const source = node as RuntimeTreeNode;
  const nodeName = typeof source.name === 'string' ? source.name : '';
  const nodePath =
    typeof source.path === 'string' && source.path.trim()
      ? source.path
      : nodeName;

  if (looksSensitivePath(nodeName) || looksSensitivePath(nodePath)) {
    return null;
  }

  const next: RuntimeTreeNode = { ...source };
  if (Array.isArray(source.children)) {
    const sanitizedChildren = source.children
      .map((child) => sanitizeTreeNode(child))
      .filter((child): child is RuntimeTreeNode => Boolean(child));
    next.children = sanitizedChildren;
    if (source.type === 'directory') {
      next.childCount = sanitizedChildren.length;
    }
  }

  return next;
}

function sanitizeTreePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const source = payload as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };

  if (Array.isArray(source.roots)) {
    next.roots = source.roots
      .filter((root) => {
        if (!root || typeof root !== 'object') return false;
        const key = (root as { key?: unknown }).key;
        return typeof key === 'string' && ALLOWED_FILE_ROOTS.has(key as FileRootKey);
      })
      .map((root) => {
        const entry = root as {
          key?: unknown;
          label?: unknown;
          rootPath?: unknown;
        };
        return {
          key: String(entry.key),
          label: typeof entry.label === 'string' ? entry.label : String(entry.key),
          rootPath:
            typeof entry.rootPath === 'string' ? entry.rootPath : '',
        };
      });
  }

  if ('tree' in source) {
    next.tree = sanitizeTreeNode(source.tree);
  }

  if (
    typeof source.requestedPath === 'string' &&
    looksSensitivePath(source.requestedPath)
  ) {
    next.requestedPath = '.';
  }

  return next;
}

function getRuntimeBaseUrl(): string {
  const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
  return `https://${appName}.fly.dev`;
}

function resolveGatewayAuthToken(machine: FlyMachine): string {
  return (
    process.env.FLY_IRONCLAW_GATEWAY_AUTH_TOKEN ||
    process.env.IRONCLAW_GATEWAY_AUTH_TOKEN ||
    process.env.GATEWAY_AUTH_TOKEN ||
    machine.config?.env?.GATEWAY_AUTH_TOKEN ||
    ''
  ).trim();
}

async function getRunningMachineForAgent(
  soulMint: string,
): Promise<FlyMachine | NextResponse> {
  const fly = getFlyClient();
  const machine = await fly.findMachineForAgent(soulMint);

  if (!machine) {
    return NextResponse.json(
      { error: 'Agent runtime not deployed' },
      { status: 404 },
    );
  }

  if (machine.state !== 'started') {
    return NextResponse.json(
      { error: `Agent runtime is ${machine.state}, not running` },
      { status: 503 },
    );
  }

  return machine;
}

async function forwardRuntimeJson(response: Response): Promise<NextResponse> {
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => null);
    return { error: text || 'Invalid runtime response' };
  });

  return NextResponse.json(payload, { status: response.status });
}

async function fetchRuntimeWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RUNTIME_PROXY_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * GET /api/agent/[id]/files
 * Proxy file tree requests to the running runtime instance.
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

    const machine = await getRunningMachineForAgent(soulMint);
    if (machine instanceof NextResponse) return machine;

    const search = new URLSearchParams();
    const rootParam = (
      request.nextUrl.searchParams.get('root') || 'user'
    ).trim().toLowerCase();
    if (!ALLOWED_FILE_ROOTS.has(rootParam as FileRootKey)) {
      return NextResponse.json(
        { error: 'Requested root is restricted' },
        { status: 403 },
      );
    }
    const root = rootParam as FileRootKey;
    const path = request.nextUrl.searchParams.get('path');
    const depth = request.nextUrl.searchParams.get('depth');
    search.set('root', root);
    if (path) {
      if (looksSensitivePath(path)) {
        return NextResponse.json(
          { error: 'Access to sensitive paths is blocked' },
          { status: 403 },
        );
      }
      search.set('path', path);
    }
    if (depth) search.set('depth', depth);

    const gatewayToken = resolveGatewayAuthToken(machine);
    const runtimeHeaders: Record<string, string> = {
      'fly-force-instance-id': machine.id,
    };
    if (gatewayToken) {
      runtimeHeaders.Authorization = `Bearer ${gatewayToken}`;
    }

    const runtimeResponse = await fetchRuntimeWithTimeout(
      `${getRuntimeBaseUrl()}/v1/files/tree?${search.toString()}`,
      {
        method: 'GET',
        headers: runtimeHeaders,
      },
    );

    const payload = await runtimeResponse.json().catch(async () => {
      const text = await runtimeResponse.text().catch(() => null);
      return { error: text || 'Invalid runtime response' };
    });

    if (!runtimeResponse.ok) {
      return NextResponse.json(payload, { status: runtimeResponse.status });
    }

    return NextResponse.json(sanitizeTreePayload(payload), {
      status: runtimeResponse.status,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        {
          error: `Runtime request timed out after ${RUNTIME_PROXY_TIMEOUT_MS}ms`,
        },
        { status: 504 },
      );
    }
    console.error('Files tree proxy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch file tree' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/agent/[id]/files
 * Upload a file into workspace/user-files on the runtime instance.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: soulMint } = await params;
    const ownership = await requireAgentOwnership(request, soulMint);
    if (!ownership.ok) {
      return ownership.response;
    }

    const machine = await getRunningMachineForAgent(soulMint);
    if (machine instanceof NextResponse) return machine;

    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const outbound = new FormData();
    outbound.set('file', file);
    const requestedPath = incoming.get('path');
    if (isSensitiveToken(file.name)) {
      return NextResponse.json(
        { error: 'Uploading sensitive filenames is blocked' },
        { status: 400 },
      );
    }
    if (typeof requestedPath === 'string' && requestedPath.trim()) {
      if (looksSensitivePath(requestedPath.trim())) {
        return NextResponse.json(
          { error: 'Uploading to sensitive paths is blocked' },
          { status: 400 },
        );
      }
      outbound.set('path', requestedPath.trim());
    }

    const uploadGatewayToken = resolveGatewayAuthToken(machine);
    const uploadHeaders: Record<string, string> = {
      'fly-force-instance-id': machine.id,
    };
    if (uploadGatewayToken) {
      uploadHeaders.Authorization = `Bearer ${uploadGatewayToken}`;
    }

    const runtimeResponse = await fetchRuntimeWithTimeout(`${getRuntimeBaseUrl()}/v1/files/upload`, {
      method: 'POST',
      headers: uploadHeaders,
      body: outbound,
    });

    return forwardRuntimeJson(runtimeResponse);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        {
          error: `Runtime request timed out after ${RUNTIME_PROXY_TIMEOUT_MS}ms`,
        },
        { status: 504 },
      );
    }
    console.error('Files upload proxy error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to upload file' },
      { status: 500 },
    );
  }
}
