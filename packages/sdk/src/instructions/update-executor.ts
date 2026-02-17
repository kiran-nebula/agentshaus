import type { Address, IInstruction, IAccountMeta } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import { BorshWriter } from '../borsh';
import type { UpdateExecutorArgs } from '../types';

const DISCRIMINATOR = new Uint8Array([39, 5, 52, 162, 148, 164, 248, 171]);

export interface UpdateExecutorAccounts {
  owner: Address;
  soulAsset: Address;
  agentState: Address;
}

export function createUpdateExecutorInstruction(
  accounts: UpdateExecutorAccounts,
  args: UpdateExecutorArgs,
): IInstruction {
  const data = new BorshWriter()
    .bytes(DISCRIMINATOR)
    .pubkey(args.newExecutor)
    .toBuffer();

  const accountMetas: IAccountMeta[] = [
    { address: accounts.owner, role: 2 },       // signer
    { address: accounts.soulAsset, role: 0 },   // readonly
    { address: accounts.agentState, role: 1 },   // writable
  ];

  return { programAddress: PROGRAM_ID, accounts: accountMetas, data };
}
