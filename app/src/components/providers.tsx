'use client';

import { useState, useEffect, useMemo } from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import type { ReactNode } from 'react';
import { ThemeProvider } from './theme-provider';

function toWsUrl(httpUrl: string, fallback: string): string {
  const trimmed = httpUrl.trim();
  if (!trimmed) return fallback;
  if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) return trimmed;
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice('https://'.length)}`;
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice('http://'.length)}`;
  return fallback;
}

export function Providers({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const solanaConnectors = useMemo(() => toSolanaWalletConnectors(), []);
  const solanaMainnetRpcUrl = useMemo(
    () =>
      (
        process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
        'https://api.mainnet-beta.solana.com'
      ).trim(),
    [],
  );
  const solanaMainnetWsUrl = useMemo(
    () =>
      toWsUrl(
        (
          process.env.NEXT_PUBLIC_SOLANA_RPC_WS_URL ||
          process.env.NEXT_PUBLIC_SOLANA_RPC_WSS_URL ||
          solanaMainnetRpcUrl
        ).trim(),
        'wss://api.mainnet-beta.solana.com',
      ),
    [solanaMainnetRpcUrl],
  );
  const solanaRpcs = useMemo(
    () => ({
      'solana:mainnet': {
        rpc: createSolanaRpc(solanaMainnetRpcUrl),
        rpcSubscriptions: createSolanaRpcSubscriptions(solanaMainnetWsUrl),
        blockExplorerUrl: 'https://explorer.solana.com',
      },
      'solana:devnet': {
        rpc: createSolanaRpc('https://api.devnet.solana.com'),
        rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.devnet.solana.com'),
        blockExplorerUrl: 'https://explorer.solana.com?cluster=devnet',
      },
      'solana:testnet': {
        rpc: createSolanaRpc('https://api.testnet.solana.com'),
        rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.testnet.solana.com'),
        blockExplorerUrl: 'https://explorer.solana.com?cluster=testnet',
      },
    }),
    [solanaMainnetRpcUrl, solanaMainnetWsUrl],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  // Don't render children until client-side mount so Privy hooks have context
  if (!mounted || !appId) {
    return null;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          showWalletLoginFirst: true,
          walletChainType: 'solana-only',
          walletList: ['detected_solana_wallets', 'phantom', 'solflare', 'backpack'],
          theme: 'dark',
        },
        loginMethods: ['wallet', 'email', 'google'],
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
        solana: {
          rpcs: solanaRpcs,
        },
        embeddedWallets: {
          solana: {
            createOnLogin: 'all-users',
          },
        },
      }}
    >
      <ThemeProvider>{children}</ThemeProvider>
    </PrivyProvider>
  );
}
