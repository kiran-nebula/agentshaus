'use client';

import { useMemo } from 'react';
import { createSolanaRpc } from '@solana/kit';

export function useSolanaRpc() {
  const rpc = useMemo(
    () => createSolanaRpc(process.env.NEXT_PUBLIC_SOLANA_RPC_URL!),
    [],
  );

  return { rpc };
}
