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
import { AnimatedSkillLines } from '@/components/animated-skill-lines';

interface AgentEntry {
  soulMint: string;
  state: AgentState;
  balance: bigint;
  executor: string;
}

function parseAssetName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default function DashboardPage() {
  const { authenticated, login } = usePrivy();
  const { wallets } = useSolanaWallets();
  const { rpc } = useSolanaRpc();
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState(false);
  const [searchMint, setSearchMint] = useState('');
  const walletAddress = wallets[0]?.address as Address | undefined;

  const hydrateCachedNames = useCallback((mints: string[]) => {
    if (typeof window === 'undefined') return;
    const fromCache: Record<string, string> = {};
    for (const mint of mints) {
      const cached = parseAssetName(localStorage.getItem(`agent-name:${mint}`));
      if (cached) fromCache[mint] = cached;
    }
    if (Object.keys(fromCache).length === 0) return;
    setAgentNames((prev) => ({ ...fromCache, ...prev }));
  }, []);

  // Auto-load agents for the connected wallet
  useEffect(() => {
    if (!authenticated || !walletAddress) {
      setAgents((prev) => (prev.length > 0 ? [] : prev));
      setLoading(false);
      return;
    }
    const ownerAddress = walletAddress as Address;

    let cancelled = false;

    async function loadWalletAgents() {
      setLoading(true);
      try {
        const results = await fetchAgentsByOwner(rpc, ownerAddress);
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
              executor: state.executor as string,
            };
          }),
        );

        if (!cancelled) {
          setAgents(entries);
          hydrateCachedNames(entries.map((entry) => entry.soulMint));
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
  }, [authenticated, walletAddress, rpc, hydrateCachedNames]);

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
        const mintKey = searchMint.trim();
        setAgents((prev) => {
          if (prev.some((a) => a.soulMint === mintKey)) return prev;
          return [
            ...prev,
            {
              soulMint: mintKey,
              state,
              balance,
              executor: state.executor as string,
            },
          ];
        });
        hydrateCachedNames([mintKey]);
      }
      setSearched(true);
    } catch (err) {
      console.error('Failed to find agent:', err);
    } finally {
      setLoading(false);
    }
  }, [searchMint, rpc, hydrateCachedNames]);

  useEffect(() => {
    if (agents.length === 0) return;
    const unresolved = agents
      .map((agent) => agent.soulMint)
      .filter((mint) => !agentNames[mint]);
    if (unresolved.length === 0) return;

    let cancelled = false;

    async function fetchNamesFromDas() {
      const rpcUrl = (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com').trim();

      for (const mint of unresolved) {
        if (cancelled) return;
        try {
          const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: `get-asset-${mint}`,
              method: 'getAsset',
              params: [mint],
            }),
          });
          if (!res.ok) continue;

          const payload = await res.json();
          const resolvedName = parseAssetName(payload?.result?.content?.metadata?.name);
          if (!resolvedName || cancelled) continue;

          setAgentNames((prev) =>
            prev[mint] === resolvedName ? prev : { ...prev, [mint]: resolvedName },
          );
          if (typeof window !== 'undefined') {
            localStorage.setItem(`agent-name:${mint}`, resolvedName);
          }
        } catch {
          // Ignore unsupported RPC methods and fall back to mint label.
        }
      }
    }

    fetchNamesFromDas();
    return () => {
      cancelled = true;
    };
  }, [agents, agentNames]);

  return (
    <main className="min-h-[calc(100dvh-56px)]">
      <section className="agents-dashboard-hero relative overflow-hidden border-b border-border-light px-10 py-8">
        <AnimatedSkillLines variant="light" className="absolute inset-0 h-full w-full" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/90" />

        <div className="relative">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/50 px-3 py-1 text-xs text-ink-secondary backdrop-blur-sm">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" />
            Agents Workspace
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <h1 className="max-w-2xl text-3xl font-semibold leading-tight text-ink sm:text-5xl">Manage your agents</h1>
            <Link
              href="/create"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-black hover:bg-brand-600 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M7 2v10M2 7h10" />
              </svg>
              New Agent
            </Link>
          </div>
          <p className="max-w-3xl text-sm text-ink-secondary sm:text-base">
            Search by Soul Mint, monitor balances, and jump directly into each agent for runtime and strategy controls.
          </p>

          <div className="mt-6 flex max-w-3xl gap-2">
            <input
              value={searchMint}
              onChange={(e) => setSearchMint(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Enter Soul Mint address to load agent..."
              className="flex-1 rounded-xl border border-black/10 bg-white/90 px-4 py-2.5 text-sm text-ink font-mono placeholder:text-ink-muted focus:border-ink focus:outline-none transition-colors"
            />
            <button
              onClick={handleSearch}
              className="rounded-xl border border-black/10 bg-white/90 px-5 py-2.5 text-sm font-medium text-ink-secondary hover:bg-white transition-colors"
            >
              Load
            </button>
          </div>
        </div>
      </section>

      <section className="agents-dashboard-content px-10 py-8">
        {/* Agent grid */}
        {agents.length > 0 && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.soulMint}
                soulMint={agent.soulMint}
                name={agentNames[agent.soulMint] || `Agent ${agent.soulMint.slice(0, 6)}`}
                strategy={agent.state.strategy as any}
                isActive={agent.state.isActive}
                totalTips={agent.state.totalTips}
                totalBurns={agent.state.totalBurns}
                balance={agent.balance}
                executor={agent.executor}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {agents.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface-raised py-20 px-6">
            {!authenticated ? (
              <>
                <div className="mb-4 rounded-xl border border-border-light bg-surface p-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                    <rect x="2" y="6" width="20" height="12" rx="2" />
                    <path d="M12 12h.01" />
                  </svg>
                </div>
                <p className="mb-1 text-sm font-medium text-ink">No wallet connected</p>
                <p className="mb-5 text-sm text-ink-muted">Connect your wallet to see your agents</p>
                <button
                  onClick={login}
                  className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-black hover:bg-brand-600 transition-colors"
                >
                  Connect Wallet
                </button>
              </>
            ) : (
              <>
                <div className="mb-4 rounded-xl border border-border-light bg-surface p-3">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                </div>
                <p className="mb-1 text-sm font-medium text-ink">No agents found</p>
                <p className="mb-5 text-sm text-ink-muted">
                  Create your first agent or search by mint address.
                </p>
                <Link
                  href="/create"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-black hover:bg-brand-600 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M7 2v10M2 7h10" />
                  </svg>
                  Create Agent
                </Link>
              </>
            )}
          </div>
        )}

        {loading && <div className="py-12 text-center text-sm text-ink-muted">Loading agents...</div>}
      </section>
    </main>
  );
}
