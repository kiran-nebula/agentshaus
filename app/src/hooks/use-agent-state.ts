'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Address } from '@solana/kit';
import type { AgentState } from '@agents-haus/sdk';
import { getAgentStatePda, fetchAgentState } from '@agents-haus/sdk';
import { useSolanaRpc } from './use-solana-rpc';

interface UseAgentStateResult {
  data: AgentState | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
}

export function useAgentState(soulMint: Address | undefined): UseAgentStateResult {
  const [data, setData] = useState<AgentState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { rpc } = useSolanaRpc();

  const refetch = useCallback(async () => {
    if (!soulMint) return;
    setIsLoading(true);
    setError(null);
    try {
      const [agentStateAddress] = await getAgentStatePda(soulMint);
      const state = await fetchAgentState(rpc, agentStateAddress);
      setData(state);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
    }
  }, [soulMint, rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}
