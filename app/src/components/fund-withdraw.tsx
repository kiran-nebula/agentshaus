'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { solToLamports, lamportsToSol } from '@agents-haus/common';
import { useAgentTransactions } from '@/hooks/use-agent-transactions';
import { useSendTransaction } from '@/hooks/use-send-transaction';

interface Props {
  soulMint: string;
  balance: bigint;
  isOwner: boolean;
  onSuccess?: () => void;
}

export function FundWithdraw({ soulMint, balance, isOwner, onSuccess }: Props) {
  const { authenticated, login } = usePrivy();
  const { fundAgent, withdrawFromAgent } = useAgentTransactions();
  const { sendTransaction } = useSendTransaction();

  const [mode, setMode] = useState<'fund' | 'withdraw' | null>(null);
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAction = async () => {
    if (!authenticated) {
      login();
      return;
    }

    const solAmount = parseFloat(amount);
    if (isNaN(solAmount) || solAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }

    if (mode === 'withdraw' && solToLamports(solAmount) > balance) {
      setError('Insufficient balance');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const lamports = solToLamports(solAmount);
      const ix =
        mode === 'fund'
          ? await fundAgent(soulMint, lamports)
          : await withdrawFromAgent(soulMint, lamports);

      await sendTransaction([ix]);
      setAmount('');
      setMode(null);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-6">
      <h3 className="text-base font-semibold text-ink mb-2">Wallet</h3>
      <div className="text-2xl font-mono font-bold text-ink mb-5">
        {lamportsToSol(balance).toFixed(4)} <span className="text-sm text-ink-muted font-sans font-normal">SOL</span>
      </div>

      {mode === null ? (
        <div className="flex gap-2">
          <button
            onClick={() => setMode('fund')}
            className="flex-1 rounded-full bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-ink/90 transition-colors"
          >
            Fund
          </button>
          {isOwner && (
            <button
              onClick={() => setMode('withdraw')}
              className="flex-1 rounded-full border border-border px-4 py-2 text-sm font-medium text-ink-secondary hover:bg-surface-overlay transition-colors"
            >
              Withdraw
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.001"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-ink font-mono focus:border-ink focus:outline-none transition-colors"
            />
            <span className="text-sm text-ink-muted">SOL</span>
          </div>

          {error && (
            <div className="text-sm text-danger">{error}</div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleAction}
              disabled={loading}
              className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                mode === 'fund'
                  ? 'bg-ink text-surface hover:bg-ink/90'
                  : 'bg-brand-500 text-black hover:bg-brand-600'
              }`}
            >
              {loading
                ? 'Processing...'
                : mode === 'fund'
                  ? 'Deposit SOL'
                  : 'Withdraw SOL'}
            </button>
            <button
              onClick={() => {
                setMode(null);
                setAmount('');
                setError(null);
              }}
              disabled={loading}
              className="rounded-full border border-border px-4 py-2 text-sm text-ink-secondary hover:bg-surface-overlay transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
