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
  isWalletLinkedToPrivyUser,
  PrivyConfigurationError,
  verifyPrivyAccessToken,
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
 * Uses Privy JWT auth + on-chain mpl-core owner lookup.
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

  let ownerWallet: string;
  try {
    const t1 = Date.now();
    const owner = await fetchCurrentSoulOwner(getRpc(), soulMint as Address);
    console.log(`[auth] fetchCurrentSoulOwner took ${Date.now() - t1}ms, owner=${owner ? (owner as string).slice(0, 8) + '...' : 'null'}`);
    if (!owner) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Soul NFT not found', authHint: 'soul-not-found' },
          { status: 404 },
        ),
      };
    }
    ownerWallet = owner as string;
  } catch (err) {
    console.error(`[auth] Failed to resolve Soul owner after ${Date.now() - t0}ms:`, err);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify Soul ownership', authHint: 'owner-lookup-failed' },
        { status: 500 },
      ),
    };
  }

  try {
    const t2 = Date.now();
    const idTokenHeader = request.headers.get('x-privy-identity-token');
    const idTokenCookie =
      request.cookies.get('privy-id-token')?.value ||
      request.cookies.get('__privy-id-token')?.value ||
      '';
    const idToken = idTokenHeader?.trim() || idTokenCookie.trim() || null;
    console.log(`[auth] checking wallet link: userId=${userId.slice(0, 12)}..., owner=${ownerWallet.slice(0, 8)}..., hasIdToken=${!!idToken}`);
    const ownsSoul = await isWalletLinkedToPrivyUser(userId, ownerWallet, {
      idToken,
    });
    console.log(`[auth] isWalletLinkedToPrivyUser took ${Date.now() - t2}ms, result=${ownsSoul}`);
    if (!ownsSoul) {
      const hasIdentityToken = Boolean(idToken?.trim());
      const authHint = hasIdentityToken
        ? 'identity-token-present-but-owner-wallet-not-linked'
        : 'owner-wallet-not-linked';
      console.warn(`[auth] ownership denied: authHint=${authHint}, totalTime=${Date.now() - t0}ms`);
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'Forbidden: current user is not the Soul NFT owner',
            authHint,
            currentOwner: ownerWallet,
          },
          { status: 403 },
        ),
      };
    }
  } catch (err) {
    if (err instanceof PrivyConfigurationError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: err.message, authHint: 'privy-server-auth-not-configured' },
          { status: 500 },
        ),
      };
    }
    console.error(`[auth] Privy ownership check failed after ${Date.now() - t0}ms:`, err);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify ownership', authHint: 'ownership-check-failed' },
        { status: 500 },
      ),
    };
  }

  console.log(`[auth] ownership verified in ${Date.now() - t0}ms`);
  return { ok: true, userId, ownerWallet };
}
