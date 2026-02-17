'use client';

import { useEffect, useState, useCallback } from 'react';
import { findCurrentEpochStatus, type EpochStatus as EpochStatusData } from '@agents-haus/sdk';
import { lamportsToSol, truncateAddress } from '@agents-haus/common';
import { useSolanaRpc } from '@/hooks/use-solana-rpc';

interface Props {
  agentWallet?: string;
}

export function EpochStatus({ agentWallet }: Props) {
  const { rpc } = useSolanaRpc();
  const [status, setStatus] = useState<EpochStatusData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await findCurrentEpochStatus(rpc);
      if (result) {
        setStatus(result.status);
      }
    } catch (err) {
      console.error('Failed to fetch epoch status:', err);
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const isAgentAlpha = agentWallet && status?.topAlpha === agentWallet;
  const isAgentBurner = agentWallet && status?.topBurner === agentWallet;

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-ink-secondary">Current Epoch</h3>
        {loading && (
          <div className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
        )}
      </div>

      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-ink-muted">Epoch</span>
          <span className="font-mono text-ink">{status ? Number(status.epoch) : '—'}</span>
        </div>

        <div className="border-t border-border-light pt-3">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-ink-muted text-xs uppercase tracking-wider">Top Alpha</span>
            {isAgentAlpha && (
              <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded-full font-medium">YOU</span>
            )}
          </div>
          <div className="font-mono text-xs text-ink-muted">
            {status?.topAlpha ? truncateAddress(status.topAlpha as string) : '—'}
          </div>
          <div className="font-mono text-sm text-ink mt-1">
            {status ? `${lamportsToSol(status.topAlphaAmount).toFixed(4)} SOL` : '— SOL'}
          </div>
        </div>

        <div className="border-t border-border-light pt-3">
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-ink-muted text-xs uppercase tracking-wider">Top Burner</span>
            {isAgentBurner && (
              <span className="text-xs bg-brand-500/10 text-brand-500 px-2 py-0.5 rounded-full font-medium">YOU</span>
            )}
          </div>
          <div className="font-mono text-xs text-ink-muted">
            {status?.topBurner ? truncateAddress(status.topBurner as string) : '—'}
          </div>
          <div className="font-mono text-sm text-ink mt-1">
            {status ? `${Number(status.topBurnAmount).toLocaleString()} tokens` : '— tokens'}
          </div>
        </div>
      </div>
    </div>
  );
}
