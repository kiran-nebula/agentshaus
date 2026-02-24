interface SolanaWalletLike {
  address: string;
  walletClientType?: string | null;
  connectorType?: string | null;
  isPrivyWallet?: boolean | null;
  standardWallet?: {
    name?: string | null;
    isPrivyWallet?: boolean | null;
    features?: Record<string, unknown> | null;
  } | null;
}

interface PrivyLinkedAccountLike {
  type?: string | null;
  latestVerifiedAt?: string | Date | null;
}

interface PrivyUserLike {
  linkedAccounts?: readonly PrivyLinkedAccountLike[] | null;
}

const PRIVY_WALLET_CLIENT_TYPES = new Set(['privy', 'privy-v2']);

function isPrivyStandardWallet(wallet: SolanaWalletLike): boolean {
  if (wallet.isPrivyWallet === true) return true;

  const standardWallet = wallet.standardWallet;
  if (!standardWallet) return false;

  if (standardWallet.isPrivyWallet === true) return true;

  const standardWalletName =
    typeof standardWallet.name === 'string'
      ? standardWallet.name.toLowerCase()
      : null;
  if (standardWalletName === 'privy') return true;

  return Boolean(
    standardWallet.features &&
      typeof standardWallet.features === 'object' &&
      'privy:' in standardWallet.features,
  );
}

function isPrivyEmbeddedWallet(wallet: SolanaWalletLike): boolean {
  const walletClientType = wallet.walletClientType?.toLowerCase();
  if (walletClientType && PRIVY_WALLET_CLIENT_TYPES.has(walletClientType)) {
    return true;
  }

  const connectorType = wallet.connectorType?.toLowerCase();
  if (connectorType === 'embedded' || connectorType === 'embedded_imported') {
    return true;
  }

  return isPrivyStandardWallet(wallet);
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
