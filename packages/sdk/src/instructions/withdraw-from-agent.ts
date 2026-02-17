import type { Address, IInstruction, IAccountMeta } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import { BorshWriter } from '../borsh';

const DISCRIMINATOR = new Uint8Array([94, 101, 208, 182, 65, 136, 59, 171]);

export interface WithdrawFromAgentAccounts {
  owner: Address;
  soulAsset: Address;
  agentState: Address;
  agentWallet: Address;
  systemProgram: Address;
}

export function createWithdrawFromAgentInstruction(
  accounts: WithdrawFromAgentAccounts,
  amount: bigint,
): IInstruction {
  const data = new BorshWriter()
    .bytes(DISCRIMINATOR)
    .u64(amount)
    .toBuffer();

  const accountMetas: IAccountMeta[] = [
    { address: accounts.owner, role: 3 },        // writable + signer
    { address: accounts.soulAsset, role: 0 },    // readonly
    { address: accounts.agentState, role: 1 },   // writable
    { address: accounts.agentWallet, role: 1 },  // writable
    { address: accounts.systemProgram, role: 0 }, // readonly
  ];

  return { programAddress: PROGRAM_ID, accounts: accountMetas, data };
}
