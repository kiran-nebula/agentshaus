import type { Address } from '@solana/kit';

// Mirrors the on-chain AgentState account (matches IDL field order)
export interface AgentState {
  soulMint: Address;
  owner: Address;
  executor: Address;
  walletBump: number;
  stateBump: number;
  isActive: boolean;
  strategy: number;
  personalityHash: string;
  agentVersion: number;
  totalTips: bigint;
  totalBurns: bigint;
  totalSolSpent: bigint;
  totalTokensBurned: bigint;
  totalRewards: bigint;
  epochsWonAlpha: bigint;
  epochsWonBurner: bigint;
  lastActivity: bigint;
  createdAt: bigint;
}

export interface CreateAgentArgs {
  name: string;
  uri: string;
  personalityHash: string;
  strategy: number;
}

export interface UpdateAgentConfigArgs {
  strategy?: number;
  personalityHash?: string;
  isActive?: boolean;
}

export interface UpdateExecutorArgs {
  newExecutor: Address;
}

export interface AgentTipArgs {
  epoch: bigint;
  uuid: string;
  amount: bigint;
  memo: string;
  taggedAddresses: Address[];
}

export interface AgentBurnArgs {
  currEpoch: bigint;
  burnEpoch: bigint;
  burnAmount: bigint;
  memo: string;
  taggedAddresses: Address[];
}
