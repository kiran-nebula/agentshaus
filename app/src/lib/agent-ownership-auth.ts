import { fetchCurrentSoulOwner } from '@agents-haus/sdk';
import {
  createSolanaRpc,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from '@solana/kit';
import { NextRequest, NextResponse } from 'next/server';
import {
  getBearerTokenFromAuthorizationHeader,
  getWalletOwnerUserId,
  PrivyConfigurationError,
  verifyPrivyAccessToken,
  verifyPrivyIdentityToken,
} from '@/lib/privy-auth';

let rpc: Rpc<SolanaRpcApi> | null = null;

function getRpc(): Rpc<SolanaRpcApi> {
  if (!rpc) {
    const rpcUrl = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || '').trim();
    if (!rpcUrl) {
      throw new Error('NEXT_PUBLIC_SOLANA_RPC_URL is not configured');
    }
    rpc = createSolanaRpc(rpcUrl);
  }
  return rpc;
}

function unauthorized(
  authHint: string,
  error = 'Unauthorized',
  status: number = 401,
): NextResponse {
  return NextResponse.json({ error, authHint }, { status });
}

export type AgentOwnershipAuthResult =
  | { ok: true; userId: string; ownerWallet: string }
  | { ok: false; response: NextResponse };

/**
 * Verify that the request comes from the current owner of the Soul NFT.
 *
 * Fast path (with identity token, parallelized ~3-5s):
 *   1. verifyPrivyAccessToken (local JWT verify)
 *   2. In parallel: fetchCurrentSoulOwner + verifyPrivyIdentityToken
 *   3. Check if on-chain owner ∈ identity token wallets
 *
 * Fallback path (without identity token, ~5-10s):
 *   1. verifyPrivyAccessToken (local JWT verify)
 *   2. In parallel: fetchCurrentSoulOwner + getWalletOwnerUserId
 *   3. Check if wallet owner userId === JWT userId
 */
export async function requireAgentOwnership(
  request: NextRequest,
  soulMint: string,
): Promise<AgentOwnershipAuthResult> {
  const t0 = Date.now();
  const bearer = getBearerTokenFromAuthorizationHeader(
    request.headers.get('authorization'),
  );
  if (!bearer) {
    return { ok: false, response: unauthorized('missing-bearer-token') };
  }

  // Step 1: Verify JWT (fast, uses cached keys)
  let userId: string;
  try {
    userId = await verifyPrivyAccessToken(bearer);
    console.log(`[auth] verifyAccessToken took ${Date.now() - t0}ms`);
  } catch (err) {
    console.error(`[auth] verifyAccessToken failed after ${Date.now() - t0}ms:`, err instanceof Error ? err.message : err);
    if (err instanceof PrivyConfigurationError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: err.message, authHint: 'privy-server-auth-not-configured' },
          { status: 500 },
        ),
      };
    }
    return { ok: false, response: unauthorized('invalid-bearer-token') };
  }

  // Step 2: Get identity token (if available)
  const idTokenHeader = request.headers.get('x-privy-identity-token');
  const idTokenCookie =
    request.cookies.get('privy-id-token')?.value ||
    request.cookies.get('__privy-id-token')?.value ||
    '';
  const idToken = idTokenHeader?.trim() || idTokenCookie.trim() || null;

  if (idToken) {
    // Fast path: parallel on-chain + identity token
    return verifyWithIdentityToken(userId, soulMint, idToken, t0);
  }

  // Fallback: parallel on-chain + wallet→user reverse lookup
  console.log(`[auth] no identity token, using wallet reverse lookup`);
  return verifyWithWalletLookup(userId, soulMint, t0);
}

async function verifyWithIdentityToken(
  userId: string,
  soulMint: string,
  idToken: string,
  t0: number,
): Promise<AgentOwnershipAuthResult> {
  const t1 = Date.now();
  const [ownerResult, identityResult] = await Promise.allSettled([
    fetchCurrentSoulOwner(getRpc(), soulMint as Address),
    verifyPrivyIdentityToken(idToken),
  ]);
  console.log(`[auth] parallel lookups (idToken) took ${Date.now() - t1}ms`);

  const ownerWallet = resolveOwnerWallet(ownerResult);
  if (typeof ownerWallet !== 'string') return ownerWallet; // error response

  if (identityResult.status === 'rejected') {
    console.error(`[auth] verifyPrivyIdentityToken failed:`, identityResult.reason);
    if (identityResult.reason instanceof PrivyConfigurationError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: identityResult.reason.message, authHint: 'privy-server-auth-not-configured' },
          { status: 500 },
        ),
      };
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify identity', authHint: 'identity-verification-failed' },
        { status: 500 },
      ),
    };
  }

  const { userId: tokenUserId, walletAddresses } = identityResult.value;
  console.log(`[auth] owner=${ownerWallet.slice(0, 8)}..., tokenUser=${tokenUserId.slice(0, 12)}..., wallets=${walletAddresses.size}`);

  if (tokenUserId !== userId) {
    console.warn(`[auth] userId mismatch: jwt=${userId}, idToken=${tokenUserId}`);
    return { ok: false, response: unauthorized('user-id-mismatch') };
  }

  if (!walletAddresses.has(ownerWallet)) {
    return ownershipDenied(ownerWallet, walletAddresses, t0);
  }

  console.log(`[auth] ownership verified (idToken path) in ${Date.now() - t0}ms`);
  return { ok: true, userId, ownerWallet };
}

async function verifyWithWalletLookup(
  userId: string,
  soulMint: string,
  t0: number,
): Promise<AgentOwnershipAuthResult> {
  const t1 = Date.now();
  const [ownerResult, walletOwnerResult] = await Promise.allSettled([
    fetchCurrentSoulOwner(getRpc(), soulMint as Address).then(async (owner) => {
      if (!owner) return { owner: null, walletOwnerUserId: null };
      const walletOwnerUserId = await getWalletOwnerUserId(owner as string);
      return { owner: owner as string, walletOwnerUserId };
    }),
    // No-op placeholder to keep the allSettled pattern — the real work is chained above.
    Promise.resolve(null),
  ]);
  console.log(`[auth] sequential lookups (wallet) took ${Date.now() - t1}ms`);

  if (ownerResult.status === 'rejected') {
    console.error(`[auth] owner+wallet lookup failed:`, ownerResult.reason);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify Soul ownership', authHint: 'owner-lookup-failed' },
        { status: 500 },
      ),
    };
  }

  const { owner: ownerWallet, walletOwnerUserId } = ownerResult.value;
  if (!ownerWallet) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Soul NFT not found', authHint: 'soul-not-found' },
        { status: 404 },
      ),
    };
  }

  console.log(`[auth] owner=${ownerWallet.slice(0, 8)}..., walletOwner=${walletOwnerUserId?.slice(0, 12) || 'null'}`);

  if (!walletOwnerUserId || walletOwnerUserId !== userId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Forbidden: current user is not the Soul NFT owner',
          authHint: 'owner-wallet-not-linked',
          currentOwner: ownerWallet,
        },
        { status: 403 },
      ),
    };
  }

  console.log(`[auth] ownership verified (wallet lookup path) in ${Date.now() - t0}ms`);
  return { ok: true, userId, ownerWallet };
}

function resolveOwnerWallet(
  result: PromiseSettledResult<unknown>,
): string | AgentOwnershipAuthResult {
  if (result.status === 'rejected') {
    console.error(`[auth] fetchCurrentSoulOwner failed:`, result.reason);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify Soul ownership', authHint: 'owner-lookup-failed' },
        { status: 500 },
      ),
    };
  }
  const ownerWallet = result.value as string | null;
  if (!ownerWallet) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Soul NFT not found', authHint: 'soul-not-found' },
        { status: 404 },
      ),
    };
  }
  return ownerWallet;
}

function ownershipDenied(
  ownerWallet: string,
  walletAddresses: Set<string>,
  t0: number,
): AgentOwnershipAuthResult {
  console.warn(`[auth] ownership denied: owner ${ownerWallet.slice(0, 8)}... not in wallets [${[...walletAddresses].map(a => a.slice(0, 8) + '...').join(', ')}], totalTime=${Date.now() - t0}ms`);
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'Forbidden: current user is not the Soul NFT owner',
        authHint: 'owner-wallet-not-linked',
        currentOwner: ownerWallet,
      },
      { status: 403 },
    ),
  };
}
