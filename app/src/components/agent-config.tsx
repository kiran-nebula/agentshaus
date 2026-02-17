'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import type { AgentState } from '@agents-haus/sdk';
import { Strategy, STRATEGY_LABELS, truncateAddress } from '@agents-haus/common';
import { useAgentTransactions } from '@/hooks/use-agent-transactions';
import { useSendTransaction } from '@/hooks/use-send-transaction';

interface Props {
  soulMint: string;
  agentState: AgentState;
  isOwner: boolean;
  onSuccess?: () => void;
}

export function AgentConfig({ soulMint, agentState, isOwner, onSuccess }: Props) {
  const { authenticated, login } = usePrivy();
  const { updateConfig, updateExecutor } = useAgentTransactions();
  const { sendTransaction } = useSendTransaction();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newExecutor, setNewExecutor] = useState('');
  const [showExecutorInput, setShowExecutorInput] = useState(false);

  const handleToggleActive = async () => {
    if (!authenticated) { login(); return; }
    setLoading(true);
    setError(null);
    try {
      const ix = await updateConfig(soulMint, { isActive: !agentState.isActive });
      await sendTransaction([ix]);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStrategy = async (strategy: number) => {
    if (!authenticated) { login(); return; }
    if (strategy === agentState.strategy) return;
    setLoading(true);
    setError(null);
    try {
      const ix = await updateConfig(soulMint, { strategy });
      await sendTransaction([ix]);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateExecutor = async () => {
    if (!authenticated) { login(); return; }
    if (!newExecutor.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const ix = await updateExecutor(soulMint, newExecutor.trim());
      await sendTransaction([ix]);
      setNewExecutor('');
      setShowExecutorInput(false);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-6">
      <h2 className="text-base font-semibold text-ink mb-5">Configuration</h2>

      {error && (
        <div className="rounded-xl border border-danger/20 bg-danger/5 px-4 py-2.5 text-sm text-danger mb-4">
          {error}
        </div>
      )}

      {/* Active toggle */}
      <div className="flex items-center justify-between py-3 border-b border-border-light">
        <div>
          <div className="text-sm font-medium text-ink">Agent Status</div>
          <div className="text-xs text-ink-muted mt-0.5">
            {agentState.isActive ? 'Agent is running' : 'Agent is paused'}
          </div>
        </div>
        {isOwner && (
          <button
            onClick={handleToggleActive}
            disabled={loading}
            className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              agentState.isActive
                ? 'bg-danger/10 text-danger hover:bg-danger/15'
                : 'bg-success/10 text-success hover:bg-success/15'
            }`}
          >
            {agentState.isActive ? 'Pause' : 'Resume'}
          </button>
        )}
      </div>

      {/* Strategy */}
      <div className="py-4 border-b border-border-light">
        <div className="text-sm font-medium text-ink mb-3">Strategy</div>
        {isOwner ? (
          <div className="grid grid-cols-2 gap-2">
            {(Object.values(Strategy).filter((v) => typeof v === 'number') as Strategy[]).map(
              (s) => (
                <button
                  key={s}
                  onClick={() => handleUpdateStrategy(s)}
                  disabled={loading}
                  className={`rounded-xl px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                    agentState.strategy === s
                      ? 'bg-ink text-surface'
                      : 'bg-surface-inset text-ink-secondary hover:bg-surface-overlay'
                  }`}
                >
                  {STRATEGY_LABELS[s]}
                </button>
              ),
            )}
          </div>
        ) : (
          <div className="text-sm text-ink-secondary">
            {STRATEGY_LABELS[agentState.strategy as Strategy]}
          </div>
        )}
      </div>

      {/* Executor */}
      <div className="py-4">
        <div className="text-sm font-medium text-ink mb-1">Executor</div>
        <div className="text-xs text-ink-muted font-mono mb-2">
          {truncateAddress(agentState.executor as string, 8)}
        </div>
        {isOwner && !showExecutorInput && (
          <button
            onClick={() => setShowExecutorInput(true)}
            className="text-xs text-brand-500 hover:text-brand-700 font-medium transition-colors"
          >
            Change executor
          </button>
        )}
        {isOwner && showExecutorInput && (
          <div className="flex gap-2 mt-2">
            <input
              value={newExecutor}
              onChange={(e) => setNewExecutor(e.target.value)}
              placeholder="New executor pubkey"
              className="flex-1 rounded-xl border border-border bg-surface px-3 py-1.5 text-xs font-mono text-ink focus:border-ink focus:outline-none transition-colors"
            />
            <button
              onClick={handleUpdateExecutor}
              disabled={loading}
              className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-surface disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => { setShowExecutorInput(false); setNewExecutor(''); }}
              className="text-xs text-ink-muted hover:text-ink-secondary transition-colors"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Owner address */}
      <div className="pt-4 border-t border-border-light text-xs text-ink-muted">
        Owner: <span className="font-mono">{truncateAddress(agentState.owner as string, 8)}</span>
        {' · '}
        Soul: <span className="font-mono">{truncateAddress(agentState.soulMint as string, 8)}</span>
      </div>
    </div>
  );
}
