interface SolanaWalletLike {
  address: string;
  walletClientType?: string | null;
  connectorType?: string | null;
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

/**
 * Prefer external wallets for signing whenever available.
 * Falls back to embedded wallet only when no external wallet is connected.
 */
export function getPreferredSolanaWallet<T extends SolanaWalletLike>(
  wallets: readonly T[] | null | undefined,
  _user?: unknown,
): T | undefined {
  if (!wallets || wallets.length === 0) return undefined;

  const externalWallet = getExternalSolanaWallet(wallets);
  const embeddedWallet = getEmbeddedSolanaWallet(wallets);
  return externalWallet ?? embeddedWallet ?? wallets[0];
}
