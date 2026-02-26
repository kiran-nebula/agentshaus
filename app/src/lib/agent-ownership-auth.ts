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
 * Fast path (parallelized):
 *   1. verifyPrivyAccessToken (local JWT verify, ~100ms)
 *   2. In parallel:
 *      a. fetchCurrentSoulOwner (1 RPC call)
 *      b. verifyPrivyIdentityToken (1 Privy call → wallet addresses)
 *   3. Check if on-chain owner ∈ identity token wallets
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

  // Step 2: Run on-chain lookup and identity token verification in parallel
  const idTokenHeader = request.headers.get('x-privy-identity-token');
  const idTokenCookie =
    request.cookies.get('privy-id-token')?.value ||
    request.cookies.get('__privy-id-token')?.value ||
    '';
  const idToken = idTokenHeader?.trim() || idTokenCookie.trim() || null;

  if (!idToken) {
    console.warn(`[auth] no identity token provided, cannot verify ownership quickly`);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'Identity token required for ownership verification',
          authHint: 'missing-identity-token',
        },
        { status: 401 },
      ),
    };
  }

  const t1 = Date.now();
  const [ownerResult, identityResult] = await Promise.allSettled([
    fetchCurrentSoulOwner(getRpc(), soulMint as Address),
    verifyPrivyIdentityToken(idToken),
  ]);
  console.log(`[auth] parallel lookups took ${Date.now() - t1}ms`);

  // Check on-chain owner
  if (ownerResult.status === 'rejected') {
    console.error(`[auth] fetchCurrentSoulOwner failed:`, ownerResult.reason);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify Soul ownership', authHint: 'owner-lookup-failed' },
        { status: 500 },
      ),
    };
  }
  const ownerWallet = ownerResult.value as string | null;
  if (!ownerWallet) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Soul NFT not found', authHint: 'soul-not-found' },
        { status: 404 },
      ),
    };
  }

  // Check identity token wallets
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

  // Verify the token belongs to the same user
  if (tokenUserId !== userId) {
    console.warn(`[auth] userId mismatch: jwt=${userId}, idToken=${tokenUserId}`);
    return {
      ok: false,
      response: unauthorized('user-id-mismatch'),
    };
  }

  // Check if on-chain owner wallet is linked to this user
  if (!walletAddresses.has(ownerWallet)) {
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

  console.log(`[auth] ownership verified in ${Date.now() - t0}ms`);
  return { ok: true, userId, ownerWallet };
}
