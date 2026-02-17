'use client';

import { useMemo } from 'react';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

export function useSolanaRpc() {
  const rpc = useMemo(
    () => createSolanaRpc(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!),
    [],
  );

  const rpcSubscriptions = useMemo(
    () => createSolanaRpcSubscriptions(process.env.NEXT_PUBLIC_SOLANA_WS_URL!),
    [],
  );

  return { rpc, rpcSubscriptions };
}
