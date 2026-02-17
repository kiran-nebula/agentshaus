import type { Address, IInstruction, IAccountMeta } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import { BorshWriter } from '../borsh';

const DISCRIMINATOR = new Uint8Array([108, 252, 24, 134, 89, 166, 124, 67]);

export interface FundAgentAccounts {
  funder: Address;
  agentState: Address;
  agentWallet: Address;
  systemProgram: Address;
}

export function createFundAgentInstruction(
  accounts: FundAgentAccounts,
  amount: bigint,
): IInstruction {
  const data = new BorshWriter()
    .bytes(DISCRIMINATOR)
    .u64(amount)
    .toBuffer();

  const accountMetas: IAccountMeta[] = [
    { address: accounts.funder, role: 3 },       // writable + signer
    { address: accounts.agentState, role: 0 },   // readonly
    { address: accounts.agentWallet, role: 1 },  // writable
    { address: accounts.systemProgram, role: 0 }, // readonly
  ];

  return { programAddress: PROGRAM_ID, accounts: accountMetas, data };
}
