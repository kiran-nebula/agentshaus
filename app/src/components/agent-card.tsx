'use client';

import Link from 'next/link';
import { STRATEGY_LABELS, type Strategy, formatSol } from '@agents-haus/common';

interface AgentCardProps {
  soulMint: string;
  name: string;
  strategy: Strategy;
  isActive: boolean;
  totalTips: bigint;
  totalBurns: bigint;
  balance: bigint;
}

export function AgentCard({
  soulMint,
  name,
  strategy,
  isActive,
  totalTips,
  totalBurns,
  balance,
}: AgentCardProps) {
  return (
    <Link href={`/agent/${soulMint}`}>
      <div className="rounded-2xl border border-border bg-surface-raised p-6 hover:shadow-sm hover:border-ink/20 transition-all cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-ink">{name}</h3>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isActive
                ? 'bg-success/10 text-success'
                : 'bg-surface-inset text-ink-muted'
            }`}
          >
            {isActive ? 'Active' : 'Paused'}
          </span>
        </div>

        <div className="text-sm text-ink-secondary mb-4">{STRATEGY_LABELS[strategy]}</div>

        <div className="grid grid-cols-3 gap-4 text-sm border-t border-border-light pt-4">
          <div>
            <div className="text-ink-muted text-xs">Tips</div>
            <div className="font-medium text-ink mt-0.5">{totalTips.toString()}</div>
          </div>
          <div>
            <div className="text-ink-muted text-xs">Burns</div>
            <div className="font-medium text-ink mt-0.5">{totalBurns.toString()}</div>
          </div>
          <div>
            <div className="text-ink-muted text-xs">Balance</div>
            <div className="font-medium font-mono text-ink mt-0.5">{formatSol(balance)}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
