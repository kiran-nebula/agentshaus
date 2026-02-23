'use client';

import { useState, useEffect } from 'react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { truncateAddress } from '@agents-haus/common';
import { getPreferredSolanaWallet } from '@/lib/solana-wallet-preference';

interface WalletButtonProps {
  compactOnMobile?: boolean;
}

function WalletButtonInner({ compactOnMobile = false }: WalletButtonProps) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const compactClasses = compactOnMobile ? 'max-w-[11.5rem] sm:max-w-none' : '';

  if (!ready) {
    return (
      <button
        disabled
        className={`rounded-full bg-surface-inset px-4 py-1.5 text-sm font-medium text-ink-muted ${compactClasses}`}
      >
        Loading...
      </button>
    );
  }

  const preferredWallet = getPreferredSolanaWallet(wallets);
  const walletAddress = preferredWallet?.address || user?.wallet?.address;

  if (authenticated && user && walletAddress) {
    return (
      <button
        onClick={logout}
        title="Connected wallet (click to disconnect)"
        className={`inline-flex items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-overlay transition-colors ${compactClasses}`}
      >
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/15 text-brand-700">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
          </svg>
        </span>
        <span className={`text-[11px] font-medium uppercase tracking-wide text-ink-muted ${compactOnMobile ? 'hidden sm:inline' : ''}`}>Connected</span>
        <span className="font-mono text-sm text-ink">
          {walletAddress ? truncateAddress(walletAddress, compactOnMobile ? 4 : 6) : 'Wallet'}
        </span>
      </button>
    );
  }

  return (
    <button
      onClick={login}
      className={`rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-surface hover:bg-ink/90 transition-colors sm:px-5 ${compactClasses}`}
    >
      {compactOnMobile ? (
        <>
          <span className="sm:hidden">Connect</span>
          <span className="hidden sm:inline">Connect Wallet</span>
        </>
      ) : (
        'Connect Wallet'
      )}
    </button>
  );
}

export function WalletButton({ compactOnMobile = false }: WalletButtonProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <button
        disabled
        className={`rounded-full bg-surface-inset px-4 py-1.5 text-sm font-medium text-ink-muted ${
          compactOnMobile ? 'max-w-[11.5rem] sm:max-w-none' : ''
        }`}
      >
        Loading...
      </button>
    );
  }

  return <WalletButtonInner compactOnMobile={compactOnMobile} />;
}
