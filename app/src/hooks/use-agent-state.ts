'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
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
  const isMountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    [],
  );

  const refetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!soulMint) {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setData(null);
        setError(null);
        setIsLoading(false);
      }
      return;
    }
    if (isMountedRef.current && requestId === requestIdRef.current) {
      setIsLoading(true);
      setError(null);
    }
    try {
      const [agentStateAddress] = await getAgentStatePda(soulMint);
      const state = await fetchAgentState(rpc, agentStateAddress);
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setData(state);
      }
    } catch (err) {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (isMountedRef.current && requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [soulMint, rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, isLoading, error, refetch };
}
