'use client';

import type { AgentState } from '@agents-haus/sdk';
import { STRATEGY_LABELS, type Strategy, formatSol } from '@agents-haus/common';

interface Props {
  agentState: AgentState;
}

export function AgentStats({ agentState }: Props) {
  const strategyLabel =
    STRATEGY_LABELS[agentState.strategy as Strategy] || `Unknown(${agentState.strategy})`;

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-6">
      <h3 className="text-base font-semibold text-ink mb-4">Stats</h3>

      <div className="space-y-3 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-muted">Status</span>
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

        <div className="flex justify-between">
          <span className="text-ink-muted">Strategy</span>
          <span className="font-medium text-ink">{strategyLabel}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">Version</span>
          <span className="font-mono text-ink">{agentState.agentVersion}</span>
        </div>

        <div className="border-t border-border-light pt-3 mt-3">
          <div className="text-xs text-ink-muted mb-2 uppercase tracking-wider font-medium">Lifetime</div>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">Total Tips</span>
          <span className="font-mono text-ink">{agentState.totalTips.toString()}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">Total Burns</span>
          <span className="font-mono text-ink">{agentState.totalBurns.toString()}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">SOL Spent</span>
          <span className="font-mono text-ink">{formatSol(agentState.totalSolSpent)} SOL</span>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">Tokens Burned</span>
          <span className="font-mono text-ink">
            {(Number(agentState.totalTokensBurned) / 1_000_000).toLocaleString()}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">Rewards Earned</span>
          <span className="font-mono text-success">{formatSol(agentState.totalRewards)} SOL</span>
        </div>

        <div className="border-t border-border-light pt-3 mt-3">
          <div className="text-xs text-ink-muted mb-2 uppercase tracking-wider font-medium">Epochs Won</div>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">Alpha Wins</span>
          <span className="font-mono text-ink">{agentState.epochsWonAlpha.toString()}</span>
        </div>

        <div className="flex justify-between">
          <span className="text-ink-muted">Burner Wins</span>
          <span className="font-mono text-ink">{agentState.epochsWonBurner.toString()}</span>
        </div>

        <div className="border-t border-border-light pt-3 mt-3 text-xs text-ink-muted">
          Created{' '}
          {new Date(Number(agentState.createdAt) * 1000).toLocaleDateString()}
          {agentState.lastActivity > BigInt(0) && (
            <>
              {' '} · Last active{' '}
              {new Date(Number(agentState.lastActivity) * 1000).toLocaleDateString()}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
