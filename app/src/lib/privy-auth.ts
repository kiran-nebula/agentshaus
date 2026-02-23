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

type UserWalletCacheEntry = {
  expiresAt: number;
  addresses: Set<string>;
};
const userWalletCache = new Map<string, UserWalletCacheEntry>();

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

function getCachedUserWallets(userId: string): Set<string> | null {
  const cached = userWalletCache.get(userId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    userWalletCache.delete(userId);
    return null;
  }
  return cached.addresses;
}

function setCachedUserWallets(userId: string, addresses: Set<string>): void {
  if (userWalletCache.size >= OWNERSHIP_CACHE_MAX_ENTRIES) {
    userWalletCache.clear();
  }
  userWalletCache.set(userId, {
    expiresAt: Date.now() + OWNERSHIP_CACHE_TTL_MS,
    addresses,
  });
}

function getErrorStatus(err: unknown): number | null {
  if (
    err &&
    typeof err === 'object' &&
    'status' in err &&
    typeof (err as { status?: unknown }).status === 'number'
  ) {
    return (err as { status: number }).status;
  }
  return null;
}

function extractWalletAddresses(user: unknown): Set<string> {
  const addresses = new Set<string>();
  if (!user || typeof user !== 'object') return addresses;

  const candidate = user as {
    wallet?: { address?: unknown } | null;
    linkedAccounts?: unknown;
  };
  if (candidate.wallet && typeof candidate.wallet.address === 'string') {
    const walletAddress = candidate.wallet.address.trim();
    if (walletAddress) addresses.add(walletAddress);
  }

  if (!Array.isArray(candidate.linkedAccounts)) return addresses;
  for (const linked of candidate.linkedAccounts) {
    if (!linked || typeof linked !== 'object') continue;
    const entry = linked as { type?: unknown; address?: unknown };
    if (
      (entry.type === 'wallet' || entry.type === 'smart_wallet') &&
      typeof entry.address === 'string'
    ) {
      const linkedAddress = entry.address.trim();
      if (linkedAddress) addresses.add(linkedAddress);
    }
  }

  return addresses;
}

export async function isWalletLinkedToPrivyUser(
  userId: string,
  walletAddress: string,
): Promise<boolean> {
  const cacheKey = getOwnershipCacheKey(userId, walletAddress);
  if (isOwnershipCacheHit(cacheKey)) return true;
  const requestedWallet = walletAddress.trim();
  if (!requestedWallet) return false;

  const cachedWallets = getCachedUserWallets(userId);
  if (cachedWallets) {
    const matches = cachedWallets.has(requestedWallet);
    if (matches) setOwnershipCache(cacheKey);
    return matches;
  }

  let user: unknown;
  try {
    user = await getPrivyClient().getUser(userId);
  } catch (err) {
    const status = getErrorStatus(err);
    if (status === 404) return false;
    throw err;
  }

  const linkedWallets = extractWalletAddresses(user);
  setCachedUserWallets(userId, linkedWallets);
  const matches = linkedWallets.has(requestedWallet);
  if (matches) setOwnershipCache(cacheKey);
  return matches;
}
