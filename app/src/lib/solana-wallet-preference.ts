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

/**
 * Prefer Privy embedded wallets when available, otherwise fall back to the first connected wallet.
 */
export function getPreferredSolanaWallet<T extends SolanaWalletLike>(
  wallets: readonly T[] | null | undefined,
): T | undefined {
  if (!wallets || wallets.length === 0) return undefined;
  return getEmbeddedSolanaWallet(wallets) ?? wallets[0];
}
