import { NextRequest, NextResponse } from 'next/server';
import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';
import { createSolanaRpc } from '@solana/kit';
import { fetchCurrentSoulOwner } from '@agents-haus/sdk';
import { getFlyClient, type FlyMachine } from '@/lib/fly-machines';
import {
  getBearerTokenFromAuthorizationHeader,
  isWalletLinkedToPrivyUser,
  PrivyConfigurationError,
  verifyPrivyAccessToken,
} from '@/lib/privy-auth';

const RUNTIME_PROXY_TIMEOUT_MS = Number.parseInt(
  process.env.RUNTIME_PROXY_TIMEOUT_MS || '12000',
  10,
);

let rpc: Rpc<SolanaRpcApi> | null = null;

function getRuntimeBaseUrl(): string {
  const appName = (process.env.FLY_APP_NAME || 'agents-haus-runtime').trim();
  return `https://${appName}.fly.dev`;
}

function getRpc(): Rpc<SolanaRpcApi> {
  if (!rpc) {
    const endpoint =
      (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com').trim();
    rpc = createSolanaRpc(endpoint);
  }
  return rpc;
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

async function enforceWalletOwnership(
  request: NextRequest,
  soulMint: string,
): Promise<NextResponse | null> {
  const token = getBearerTokenFromAuthorizationHeader(
    request.headers.get('authorization'),
  );
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let userId: string;
  try {
    userId = await verifyPrivyAccessToken(token);
  } catch (err) {
    if (err instanceof PrivyConfigurationError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
  }

  let currentOwner: Address | null;
  try {
    currentOwner = await fetchCurrentSoulOwner(getRpc(), soulMint as Address);
  } catch (err) {
    console.error('Failed to resolve current soul owner for files auth:', err);
    return NextResponse.json(
      { error: 'Failed to verify current soul owner' },
      { status: 500 },
    );
  }

  if (!currentOwner) {
    return NextResponse.json({ error: 'Agent Soul NFT not found' }, { status: 404 });
  }

  const identityToken =
    request.headers.get('x-privy-identity-token') ||
    request.headers.get('x-privy-id-token');

  try {
    const isOwner = await isWalletLinkedToPrivyUser(
      userId,
      String(currentOwner),
      { idToken: identityToken },
    );
    if (!isOwner) {
      return NextResponse.json(
        {
          error: 'Only the current Soul NFT owner can access agent files',
          currentOwner: String(currentOwner),
        },
        { status: 403 },
      );
    }
  } catch (err) {
    if (err instanceof PrivyConfigurationError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error('Privy wallet lookup failed for files auth:', err);
    return NextResponse.json(
      { error: 'Failed to verify wallet ownership' },
      { status: 503 },
    );
  }

  return null;
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
    const ownershipFailure = await enforceWalletOwnership(request, soulMint);
    if (ownershipFailure) return ownershipFailure;

    const machine = await getRunningMachineForAgent(soulMint);
    if (machine instanceof NextResponse) return machine;

    const search = new URLSearchParams();
    const root = request.nextUrl.searchParams.get('root');
    const path = request.nextUrl.searchParams.get('path');
    const depth = request.nextUrl.searchParams.get('depth');
    if (root) search.set('root', root);
    if (path) search.set('path', path);
    if (depth) search.set('depth', depth);

    const runtimeResponse = await fetchRuntimeWithTimeout(
      `${getRuntimeBaseUrl()}/v1/files/tree?${search.toString()}`,
      {
        method: 'GET',
        headers: {
          'fly-force-instance-id': machine.id,
        },
      },
    );

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
    const ownershipFailure = await enforceWalletOwnership(request, soulMint);
    if (ownershipFailure) return ownershipFailure;

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
    if (typeof requestedPath === 'string' && requestedPath.trim()) {
      outbound.set('path', requestedPath.trim());
    }

    const runtimeResponse = await fetchRuntimeWithTimeout(`${getRuntimeBaseUrl()}/v1/files/upload`, {
      method: 'POST',
      headers: {
        'fly-force-instance-id': machine.id,
      },
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
