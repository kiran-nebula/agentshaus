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

type WalletOwnerCacheEntry = {
  expiresAt: number;
  userId: string | null;
};
const walletOwnerCache = new Map<string, WalletOwnerCacheEntry>();

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

export async function verifyPrivyIdentityToken(idToken: string): Promise<{
  userId: string;
  walletAddresses: Set<string>;
}> {
  const user = await getPrivyClient().getUser({ idToken });
  const userId = extractUserId(user);
  if (!userId) {
    throw new Error('Identity token user is missing an id');
  }
  return {
    userId,
    walletAddresses: extractWalletAddresses(user),
  };
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

function getCachedWalletOwner(walletAddress: string): string | null | undefined {
  const cached = walletOwnerCache.get(walletAddress);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    walletOwnerCache.delete(walletAddress);
    return undefined;
  }
  return cached.userId;
}

function setCachedWalletOwner(walletAddress: string, userId: string | null): void {
  if (walletOwnerCache.size >= OWNERSHIP_CACHE_MAX_ENTRIES) {
    walletOwnerCache.clear();
  }
  walletOwnerCache.set(walletAddress, {
    expiresAt: Date.now() + OWNERSHIP_CACHE_TTL_MS,
    userId,
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

function extractUserId(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const candidate = user as { id?: unknown };
  if (typeof candidate.id !== 'string') return null;
  const trimmed = candidate.id.trim();
  return trimmed || null;
}

export async function isWalletLinkedToPrivyUser(
  userId: string,
  walletAddress: string,
  options?: {
    idToken?: string | null;
  },
): Promise<boolean> {
  const requestedWallet = walletAddress.trim();
  if (!requestedWallet) return false;

  const cacheKey = getOwnershipCacheKey(userId, requestedWallet);
  if (isOwnershipCacheHit(cacheKey)) return true;

  const idToken = options?.idToken?.trim() || '';
  let tokenLinkedWallets: Set<string> | null = null;

  if (idToken) {
    try {
      // Prefer claims from the session token to avoid rate-limited user lookups.
      const tokenUser = await getPrivyClient().getUser({ idToken });
      const tokenUserId = extractUserId(tokenUser);
      const tokenUserMatches = !tokenUserId || tokenUserId === userId;

      tokenLinkedWallets = extractWalletAddresses(tokenUser);
      if (tokenLinkedWallets.size > 0) {
        if (tokenUserMatches) {
          setCachedUserWallets(userId, tokenLinkedWallets);
        }
      }

      if (tokenLinkedWallets.has(requestedWallet)) {
        if (tokenUserMatches) {
          setOwnershipCache(cacheKey);
          setCachedWalletOwner(requestedWallet, userId);
        }
        return true;
      }
    } catch {
      // Fall back to API lookups below.
    }
  }

  const cachedWalletOwner = getCachedWalletOwner(requestedWallet);
  if (cachedWalletOwner !== undefined) {
    const matches = cachedWalletOwner === userId;
    if (matches) setOwnershipCache(cacheKey);
    return matches;
  }

  try {
    const userByWallet = await getPrivyClient().getUserByWalletAddress(requestedWallet);
    const ownerId = extractUserId(userByWallet);
    if (ownerId) {
      setCachedWalletOwner(requestedWallet, ownerId);
      const matches = ownerId === userId;
      if (matches) setOwnershipCache(cacheKey);
      return matches;
    }
  } catch (err) {
    const status = getErrorStatus(err);
    if (status !== 404) {
      // Fallback below for transient lookup failures.
    }
  }

  const cachedWallets = getCachedUserWallets(userId);
  if (cachedWallets) {
    const matches = cachedWallets.has(requestedWallet);
    if (matches) {
      setOwnershipCache(cacheKey);
      setCachedWalletOwner(requestedWallet, userId);
    }
    return matches;
  }

  if (tokenLinkedWallets && tokenLinkedWallets.size > 0) {
    return false;
  }

  let user: unknown;
  try {
    user = await getPrivyClient().getUser(userId);
  } catch (err) {
    const status = getErrorStatus(err);
    if (status === 404 || status === 429) return false;
    return false;
  }

  const linkedWallets = extractWalletAddresses(user);
  setCachedUserWallets(userId, linkedWallets);
  const matches = linkedWallets.has(requestedWallet);
  if (matches) {
    setOwnershipCache(cacheKey);
    setCachedWalletOwner(requestedWallet, userId);
  } else {
    setCachedWalletOwner(requestedWallet, null);
  }
  return matches;
}
