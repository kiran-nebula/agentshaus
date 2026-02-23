interface SolanaWalletLike {
  address: string;
  walletClientType?: string | null;
  connectorType?: string | null;
}

interface PrivyLinkedAccountLike {
  type?: string | null;
  latestVerifiedAt?: string | Date | null;
}

interface PrivyUserLike {
  linkedAccounts?: readonly PrivyLinkedAccountLike[] | null;
}

const PRIVY_WALLET_CLIENT_TYPES = new Set(['privy', 'privy-v2']);

function isPrivyEmbeddedWallet(wallet: SolanaWalletLike): boolean {
  const walletClientType = wallet.walletClientType?.toLowerCase();
  if (walletClientType && PRIVY_WALLET_CLIENT_TYPES.has(walletClientType)) {
    return true;
  }

  const connectorType = wallet.connectorType?.toLowerCase();
  return connectorType === 'embedded' || connectorType === 'embedded_imported';
}

export function getEmbeddedSolanaWallet<T extends SolanaWalletLike>(
  wallets: readonly T[] | null | undefined,
): T | undefined {
  if (!wallets || wallets.length === 0) return undefined;
  return wallets.find(isPrivyEmbeddedWallet);
}

export function getExternalSolanaWallet<T extends SolanaWalletLike>(
  wallets: readonly T[] | null | undefined,
): T | undefined {
  if (!wallets || wallets.length === 0) return undefined;
  return wallets.find((wallet) => !isPrivyEmbeddedWallet(wallet));
}

function toEpochMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}

function isPrivyEmailLoginUser(user: PrivyUserLike | null | undefined): boolean {
  const linkedAccounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : [];
  if (linkedAccounts.length === 0) return false;

  let latestAccountType: string | null = null;
  let latestEpoch = Number.NEGATIVE_INFINITY;
  for (const linkedAccount of linkedAccounts) {
    const accountType =
      typeof linkedAccount?.type === 'string'
        ? linkedAccount.type.toLowerCase()
        : null;
    const verifiedAtEpoch = toEpochMs(linkedAccount?.latestVerifiedAt);
    if (!accountType || verifiedAtEpoch === null) continue;

    if (verifiedAtEpoch >= latestEpoch) {
      latestEpoch = verifiedAtEpoch;
      latestAccountType = accountType;
    }
  }

  if (latestAccountType) return latestAccountType === 'email';

  return linkedAccounts.some(
    (linkedAccount) => linkedAccount?.type?.toLowerCase() === 'email',
  );
}

/**
 * Privy email logins should use embedded wallets. All other users should use external wallets.
 */
export function getPreferredSolanaWallet<T extends SolanaWalletLike>(
  wallets: readonly T[] | null | undefined,
  user?: PrivyUserLike | null,
): T | undefined {
  if (!wallets || wallets.length === 0) return undefined;

  const embeddedWallet = getEmbeddedSolanaWallet(wallets);
  const externalWallet = getExternalSolanaWallet(wallets);
  const shouldUseEmbeddedWallet = isPrivyEmailLoginUser(user);

  if (shouldUseEmbeddedWallet) {
    return embeddedWallet ?? externalWallet ?? wallets[0];
  }
  return externalWallet ?? embeddedWallet ?? wallets[0];
}
