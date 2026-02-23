'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Address } from '@solana/kit';
import { getAgentWalletPda } from '@agents-haus/sdk';
import { useSolanaRpc } from '@/hooks/use-solana-rpc';

interface ActivityItem {
  signature: string;
  timestamp: number;
  type: 'tip' | 'burn' | 'fund' | 'withdraw' | 'reward' | 'unknown';
  memo?: string;
}

export function ActivityLog({ agentId }: { agentId: string }) {
  const { rpc } = useSolanaRpc();
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const fetchActivity = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (isMountedRef.current && requestId === requestIdRef.current) {
      setLoading(true);
    }
    try {
      const [agentWallet] = await getAgentWalletPda(agentId as Address);

      const signatures = await rpc
        .getSignaturesForAddress(agentWallet, { limit: 20 })
        .send();

      const items: ActivityItem[] = (signatures as any[]).map((sig: any) => ({
        signature: sig.signature,
        timestamp: sig.blockTime ? sig.blockTime * 1000 : Date.now(),
        type: 'unknown' as const,
        memo: sig.memo || undefined,
      }));

      if (isMountedRef.current && requestId === requestIdRef.current) {
        setActivities(items);
      }
    } catch (err) {
      console.error('Failed to fetch activity:', err);
    } finally {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [agentId, rpc]);

  useEffect(() => {
    fetchActivity();
  }, [fetchActivity]);

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-6">
      <h3 className="text-base font-semibold text-ink mb-4">Activity</h3>

      {loading && (
        <div className="text-center py-10 text-ink-muted text-sm">Loading...</div>
      )}

      {!loading && activities.length === 0 && (
        <div className="text-center py-10 text-ink-muted text-sm">No activity yet</div>
      )}

      {activities.length > 0 && (
        <div className="space-y-0">
          {activities.map((activity) => (
            <div
              key={activity.signature}
              className="flex items-start gap-3 border-b border-border-light py-3 last:border-0 last:pb-0 first:pt-0"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-ink-muted">
                    {new Date(activity.timestamp).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {activity.memo && (
                  <p className="text-sm text-ink-secondary mt-1 truncate">{activity.memo}</p>
                )}
              </div>
              <a
                href={`https://solscan.io/tx/${activity.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-brand-500 hover:text-brand-700 shrink-0 transition-colors"
              >
                View
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
