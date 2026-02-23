'use client';

import { useState } from 'react';
import Link from 'next/link';
import { STRATEGY_LABELS, type Strategy, formatSol, truncateAddress } from '@agents-haus/common';

interface AgentCardProps {
  soulMint: string;
  name: string;
  strategy: Strategy;
  isActive: boolean;
  totalTips: bigint;
  totalBurns: bigint;
  balance: bigint;
  executor: string;
}

export function AgentCard({
  soulMint,
  name,
  strategy,
  isActive,
  totalTips,
  totalBurns,
  balance,
  executor,
}: AgentCardProps) {
  const [copied, setCopied] = useState(false);
  const hasActivity =
    totalTips > BigInt(0) || totalBurns > BigInt(0) || balance > BigInt(0);

  const handleCopyExecutor = async (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(executor);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard failures silently.
    }
  };

  return (
    <Link href={`/agent/${soulMint}`}>
      <div className="group rounded-2xl border border-border bg-surface-raised p-5 hover:border-brand-500/30 hover:shadow-sm transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink">{name}</h3>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
              isActive
                ? 'bg-success/10 text-success'
                : 'bg-surface-inset text-ink-muted'
            }`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${isActive ? 'bg-success' : 'bg-ink-muted'}`} />
            {isActive ? 'Active' : 'Paused'}
          </span>
        </div>

        <div className="mb-2 font-mono text-[11px] text-ink-muted">{truncateAddress(soulMint, 6)}</div>
        <div className="text-xs text-ink-secondary mb-4">{STRATEGY_LABELS[strategy]}</div>

        <div className="mb-4 rounded-lg border border-border-light bg-surface px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-ink-muted text-[11px]">Executor</span>
            <button
              type="button"
              onClick={handleCopyExecutor}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium text-ink-muted hover:text-ink hover:bg-surface-overlay transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="font-mono text-[11px] text-ink truncate">{executor}</div>
        </div>

        {hasActivity ? (
          <div className="grid grid-cols-3 gap-3 text-xs border-t border-border-light pt-3">
            <div>
              <div className="text-ink-muted text-[11px] mb-0.5">Tips</div>
              <div className="font-medium text-ink">{totalTips.toString()}</div>
            </div>
            <div>
              <div className="text-ink-muted text-[11px] mb-0.5">Burns</div>
              <div className="font-medium text-ink">{totalBurns.toString()}</div>
            </div>
            <div>
              <div className="text-ink-muted text-[11px] mb-0.5">Balance</div>
              <div className="font-medium font-mono text-ink">{formatSol(balance)}</div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border-light bg-surface px-3 py-2 text-xs text-ink-muted">
            No activity yet
          </div>
        )}
      </div>
    </Link>
  );
}
