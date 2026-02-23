import { PrivyClient } from '@privy-io/server-auth';

const PRIVY_API_TIMEOUT_MS = Number.parseInt(
  process.env.PRIVY_API_TIMEOUT_MS || '5000',
  10,
);
const OWNERSHIP_CACHE_TTL_MS = Number.parseInt(
  process.env.PRIVY_OWNERSHIP_CACHE_TTL_MS || '30000',
  10,
);
const OWNERSHIP_CACHE_MAX_ENTRIES = 2000;

export class PrivyConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrivyConfigurationError';
  }
}

let privyClient: PrivyClient | null = null;
const ownershipCache = new Map<string, number>();

function getPrivyClient(): PrivyClient {
  if (privyClient) return privyClient;

  const appId = (process.env.NEXT_PUBLIC_PRIVY_APP_ID || '').trim();
  const appSecret = (process.env.PRIVY_APP_SECRET || '').trim();
  if (!appId || !appSecret) {
    throw new PrivyConfigurationError(
      'Privy server auth is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET.',
    );
  }

  privyClient = new PrivyClient(appId, appSecret, {
    timeout: PRIVY_API_TIMEOUT_MS,
  });
  return privyClient;
}

export function getBearerTokenFromAuthorizationHeader(
  authorization: string | null,
): string | null {
  if (!authorization) return null;
  const [scheme, ...rest] = authorization.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || rest.length === 0) {
    return null;
  }
  const token = rest.join(' ').trim();
  return token || null;
}

export async function verifyPrivyAccessToken(token: string): Promise<string> {
  const claims = await getPrivyClient().verifyAuthToken(token);
  return claims.userId;
}

function getOwnershipCacheKey(userId: string, walletAddress: string): string {
  return `${userId}:${walletAddress}`;
}

function isOwnershipCacheHit(cacheKey: string): boolean {
  const expiresAt = ownershipCache.get(cacheKey);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    ownershipCache.delete(cacheKey);
    return false;
  }
  return true;
}

function setOwnershipCache(cacheKey: string): void {
  if (ownershipCache.size >= OWNERSHIP_CACHE_MAX_ENTRIES) {
    ownershipCache.clear();
  }
  ownershipCache.set(cacheKey, Date.now() + OWNERSHIP_CACHE_TTL_MS);
}

export async function isWalletLinkedToPrivyUser(
  userId: string,
  walletAddress: string,
): Promise<boolean> {
  const cacheKey = getOwnershipCacheKey(userId, walletAddress);
  if (isOwnershipCacheHit(cacheKey)) return true;

  const user = await getPrivyClient().getUserByWalletAddress(walletAddress);
  const matches = Boolean(user && user.id === userId);
  if (matches) {
    setOwnershipCache(cacheKey);
  }
  return matches;
}
