'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Address } from '@solana/kit';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { getAgentWalletPda, fetchAgentWalletBalance } from '@agents-haus/sdk';
import { useAgentState } from '@/hooks/use-agent-state';
import { useSolanaRpc } from '@/hooks/use-solana-rpc';
import { EpochStatus } from '@/components/epoch-status';
import { ActivityLog } from '@/components/activity-log';
import { AgentStats } from '@/components/agent-stats';
import { AgentConfig } from '@/components/agent-config';
import { FundWithdraw } from '@/components/fund-withdraw';

interface Props {
  soulMint: string;
}

export function AgentDetailClient({ soulMint }: Props) {
  const { user } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { rpc } = useSolanaRpc();
  const { data: agentState, isLoading, error, refetch } = useAgentState(soulMint as Address);

  const [walletBalance, setWalletBalance] = useState<bigint>(BigInt(0));
  const [agentWalletAddress, setAgentWalletAddress] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    try {
      const [agentWallet] = await getAgentWalletPda(soulMint as Address);
      setAgentWalletAddress(agentWallet as string);
      const balance = await fetchAgentWalletBalance(rpc, agentWallet);
      setWalletBalance(balance);
    } catch {
      // agent may not exist yet
    }
  }, [soulMint, rpc]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  const handleRefresh = () => {
    refetch();
    fetchBalance();
  };

  const isOwner =
    agentState &&
    wallets[0] &&
    (agentState.owner as string) === wallets[0].address;

  if (isLoading) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="animate-pulse space-y-6">
          <div className="h-7 w-48 bg-surface-inset rounded-lg" />
          <div className="h-4 w-96 bg-surface-inset rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-64 bg-surface-inset rounded-2xl" />
            <div className="h-64 bg-surface-inset rounded-2xl" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !agentState) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-ink mb-1">Agent</h1>
          <p className="text-sm text-ink-muted font-mono">{soulMint}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface-raised p-10 text-center">
          <p className="text-ink-secondary mb-2">
            {error ? error.message : 'Agent not found'}
          </p>
          <p className="text-sm text-ink-muted">
            This agent may not have been created yet, or the address is incorrect.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {/* Agent Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-ink">Agent</h1>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                agentState.isActive
                  ? 'bg-success/10 text-success'
                  : 'bg-surface-inset text-ink-muted'
              }`}
            >
              {agentState.isActive ? 'Active' : 'Paused'}
            </span>
          </div>
          <p className="text-sm text-ink-muted font-mono mt-1">{soulMint}</p>
        </div>
        <button
          onClick={handleRefresh}
          className="rounded-full border border-border px-4 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Config + Activity */}
        <div className="lg:col-span-2 space-y-6">
          <AgentConfig
            soulMint={soulMint}
            agentState={agentState}
            isOwner={!!isOwner}
            onSuccess={handleRefresh}
          />
          <ActivityLog agentId={soulMint} />
        </div>

        {/* Right column: Epoch + Stats + Wallet */}
        <div className="space-y-6">
          <EpochStatus agentWallet={agentWalletAddress || undefined} />
          <AgentStats agentState={agentState} />
          <FundWithdraw
            soulMint={soulMint}
            balance={walletBalance}
            isOwner={!!isOwner}
            onSuccess={handleRefresh}
          />
        </div>
      </div>
    </main>
  );
}
