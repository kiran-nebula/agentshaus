import type { Address, IInstruction, IAccountMeta } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import { BorshWriter } from '../borsh';
import type { CreateAgentArgs } from '../types';

const DISCRIMINATOR = new Uint8Array([143, 66, 198, 95, 110, 85, 83, 249]);

export interface CreateAgentAccounts {
  owner: Address;
  soulAsset: Address;
  agentState: Address;
  agentWallet: Address;
  executor: Address;
  systemProgram: Address;
  mplCoreProgram: Address;
}

export function createCreateAgentInstruction(
  accounts: CreateAgentAccounts,
  args: CreateAgentArgs,
): IInstruction {
  const data = new BorshWriter()
    .bytes(DISCRIMINATOR)
    .string(args.name)
    .string(args.uri)
    .string(args.personalityHash)
    .u8(args.strategy)
    .toBuffer();

  const accountMetas: IAccountMeta[] = [
    { address: accounts.owner, role: 3 },       // writable + signer
    { address: accounts.soulAsset, role: 3 },    // writable + signer
    { address: accounts.agentState, role: 1 },   // writable
    { address: accounts.agentWallet, role: 0 },  // readonly
    { address: accounts.executor, role: 0 },     // readonly
    { address: accounts.systemProgram, role: 0 }, // readonly
    { address: accounts.mplCoreProgram, role: 0 }, // readonly
  ];

  return { programAddress: PROGRAM_ID, accounts: accountMetas, data };
}
