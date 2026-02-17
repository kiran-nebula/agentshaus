'use client';

import { usePrivy } from '@privy-io/react-auth';
import { truncateAddress } from '@agents-haus/common';

export function WalletButton() {
  const { ready, authenticated, login, logout, user } = usePrivy();

  if (!ready) {
    return (
      <button
        disabled
        className="rounded-full bg-surface-inset px-4 py-2 text-sm font-medium text-ink-muted"
      >
        Loading...
      </button>
    );
  }

  if (authenticated && user) {
    const walletAddress = user.wallet?.address;
    return (
      <button
        onClick={logout}
        className="rounded-full border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-overlay transition-colors font-mono"
      >
        {walletAddress ? truncateAddress(walletAddress) : 'Connected'}
      </button>
    );
  }

  return (
    <button
      onClick={login}
      className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-surface hover:bg-ink/90 transition-colors"
    >
      Connect Wallet
    </button>
  );
}
