'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { Address } from '@solana/kit';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import {
  getAgentStatePda,
  getAgentWalletPda,
  fetchAgentState,
  fetchAgentWalletBalance,
  fetchAgentsByOwner,
} from '@agents-haus/sdk';
import type { AgentState } from '@agents-haus/sdk';
import { useSolanaRpc } from '@/hooks/use-solana-rpc';
import { AgentCard } from '@/components/agent-card';

interface AgentEntry {
  soulMint: string;
  state: AgentState;
  balance: bigint;
}

export default function DashboardPage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { rpc } = useSolanaRpc();
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [searchMint, setSearchMint] = useState('');
  const [autoLoaded, setAutoLoaded] = useState(false);

  // Auto-load agents for the connected wallet
  useEffect(() => {
    if (!authenticated || !wallets.length || autoLoaded) return;

    const walletAddress = wallets[0].address as Address;
    let cancelled = false;

    async function loadWalletAgents() {
      setLoading(true);
      try {
        const results = await fetchAgentsByOwner(rpc, walletAddress);
        if (cancelled) return;

        // Fetch balances for each agent
        const entries: AgentEntry[] = await Promise.all(
          results.map(async ({ state }) => {
            const [agentWallet] = await getAgentWalletPda(state.soulMint);
            const balance = await fetchAgentWalletBalance(rpc, agentWallet);
            return {
              soulMint: state.soulMint as string,
              state,
              balance,
            };
          }),
        );

        if (!cancelled) {
          setAgents(entries);
          setAutoLoaded(true);
        }
      } catch (err) {
        console.error('Failed to load wallet agents:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadWalletAgents();
    return () => {
      cancelled = true;
    };
  }, [authenticated, wallets, rpc, autoLoaded]);

  const handleSearch = useCallback(async () => {
    if (!searchMint.trim()) return;
    setLoading(true);
    try {
      const mint = searchMint.trim() as Address;
      const [agentStateAddr] = await getAgentStatePda(mint);
      const state = await fetchAgentState(rpc, agentStateAddr);
      if (state) {
        const [agentWallet] = await getAgentWalletPda(mint);
        const balance = await fetchAgentWalletBalance(rpc, agentWallet);
        setAgents((prev) => {
          if (prev.some((a) => a.soulMint === searchMint.trim())) return prev;
          return [...prev, { soulMint: searchMint.trim(), state, balance }];
        });
      }
      setSearched(true);
    } catch (err) {
      console.error('Failed to find agent:', err);
    } finally {
      setLoading(false);
    }
  }, [searchMint, rpc]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-ink">Your Agents</h1>
          <p className="text-sm text-ink-muted mt-1">Manage and monitor your autonomous agents</p>
        </div>
        <Link
          href="/create"
          className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-surface hover:bg-ink/90 transition-colors"
        >
          + New Agent
        </Link>
      </div>

      {/* Search by mint */}
      <div className="mb-8">
        <div className="flex gap-2">
          <input
            value={searchMint}
            onChange={(e) => setSearchMint(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Enter Soul Mint address to load agent..."
            className="flex-1 rounded-xl border border-border bg-surface-raised px-4 py-2.5 text-sm text-ink font-mono placeholder:text-ink-muted focus:border-ink focus:outline-none transition-colors"
          />
          <button
            onClick={handleSearch}
            className="rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-sm font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
          >
            Load
          </button>
        </div>
      </div>

      {/* Agent grid */}
      {agents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {agents.map((agent) => (
            <AgentCard
              key={agent.soulMint}
              soulMint={agent.soulMint}
              name={`Agent ${agent.soulMint.slice(0, 6)}`}
              strategy={agent.state.strategy as any}
              isActive={agent.state.isActive}
              totalTips={agent.state.totalTips}
              totalBurns={agent.state.totalBurns}
              balance={agent.balance}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {agents.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20">
          {!authenticated ? (
            <>
              <p className="text-ink-muted mb-4">Connect your wallet to see your agents</p>
              <button
                onClick={login}
                className="text-brand-500 hover:text-brand-700 text-sm font-medium transition-colors"
              >
                Connect Wallet
              </button>
            </>
          ) : (
            <>
              <p className="text-ink-secondary mb-2">No agents found</p>
              <p className="text-ink-muted text-sm mb-5">
                No agents are associated with your wallet yet. Create one or search by mint address.
              </p>
              <Link
                href="/create"
                className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-surface hover:bg-ink/90 transition-colors"
              >
                Create your first agent
              </Link>
            </>
          )}
        </div>
      )}

      {loading && (
        <div className="text-center py-12 text-ink-muted text-sm">Loading agents...</div>
      )}
    </main>
  );
}
