'use client';

import { useCallback } from 'react';
import type { Address } from '@solana/kit';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import {
  getAgentStatePda,
  getAgentWalletPda,
  createCreateAgentInstruction,
  createFundAgentInstruction,
  createWithdrawFromAgentInstruction,
  createUpdateAgentConfigInstruction,
  createUpdateExecutorInstruction,
} from '@agents-haus/sdk';
import {
  PROGRAM_ID,
  MPL_CORE_PROGRAM_ID,
} from '@agents-haus/common';

const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;

export function useAgentTransactions() {
  const { user } = usePrivy();
  const { wallets } = useSolanaWallets();

  const getWalletAddress = useCallback((): Address => {
    const solanaWallet = wallets[0];
    if (!solanaWallet) throw new Error('No Solana wallet connected');
    return solanaWallet.address as Address;
  }, [wallets]);

  const createAgent = useCallback(
    async (args: {
      name: string;
      uri: string;
      personalityHash: string;
      strategy: number;
      executorPubkey: string;
      soulAssetKeypair: { publicKey: Address; secretKey: Uint8Array };
    }) => {
      const owner = getWalletAddress();
      const soulAsset = args.soulAssetKeypair.publicKey;
      const [agentState] = await getAgentStatePda(soulAsset);
      const [agentWallet] = await getAgentWalletPda(soulAsset);

      const ix = createCreateAgentInstruction(
        {
          owner,
          soulAsset,
          agentState,
          agentWallet,
          executor: args.executorPubkey as Address,
          systemProgram: SYSTEM_PROGRAM,
          mplCoreProgram: MPL_CORE_PROGRAM_ID,
        },
        {
          name: args.name,
          uri: args.uri,
          personalityHash: args.personalityHash,
          strategy: args.strategy,
        },
      );

      return ix;
    },
    [getWalletAddress],
  );

  const fundAgent = useCallback(
    async (soulMint: string, amountLamports: bigint) => {
      const funder = getWalletAddress();
      const [agentState] = await getAgentStatePda(soulMint as Address);
      const [agentWallet] = await getAgentWalletPda(soulMint as Address);

      return createFundAgentInstruction(
        { funder, agentState, agentWallet, systemProgram: SYSTEM_PROGRAM },
        amountLamports,
      );
    },
    [getWalletAddress],
  );

  const withdrawFromAgent = useCallback(
    async (soulMint: string, amountLamports: bigint) => {
      const owner = getWalletAddress();
      const [agentState] = await getAgentStatePda(soulMint as Address);
      const [agentWallet] = await getAgentWalletPda(soulMint as Address);

      return createWithdrawFromAgentInstruction(
        {
          owner,
          soulAsset: soulMint as Address,
          agentState,
          agentWallet,
          systemProgram: SYSTEM_PROGRAM,
        },
        amountLamports,
      );
    },
    [getWalletAddress],
  );

  const updateConfig = useCallback(
    async (
      soulMint: string,
      args: { strategy?: number; personalityHash?: string; isActive?: boolean },
    ) => {
      const owner = getWalletAddress();
      const [agentState] = await getAgentStatePda(soulMint as Address);

      return createUpdateAgentConfigInstruction(
        { owner, soulAsset: soulMint as Address, agentState },
        args,
      );
    },
    [getWalletAddress],
  );

  const updateExecutor = useCallback(
    async (soulMint: string, newExecutor: string) => {
      const owner = getWalletAddress();
      const [agentState] = await getAgentStatePda(soulMint as Address);

      return createUpdateExecutorInstruction(
        { owner, soulAsset: soulMint as Address, agentState },
        { newExecutor: newExecutor as Address },
      );
    },
    [getWalletAddress],
  );

  return {
    createAgent,
    fundAgent,
    withdrawFromAgent,
    updateConfig,
    updateExecutor,
  };
}
