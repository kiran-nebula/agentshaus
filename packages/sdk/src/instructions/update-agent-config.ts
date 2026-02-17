import type { Address, IInstruction, IAccountMeta } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import { BorshWriter } from '../borsh';
import type { UpdateAgentConfigArgs } from '../types';

const DISCRIMINATOR = new Uint8Array([232, 239, 83, 133, 24, 49, 84, 76]);

export interface UpdateAgentConfigAccounts {
  owner: Address;
  soulAsset: Address;
  agentState: Address;
}

export function createUpdateAgentConfigInstruction(
  accounts: UpdateAgentConfigAccounts,
  args: UpdateAgentConfigArgs,
): IInstruction {
  const writer = new BorshWriter().bytes(DISCRIMINATOR);
  writer.option(args.strategy, (v) => writer.u8(v));
  writer.option(args.personalityHash, (v) => writer.string(v));
  writer.option(args.isActive, (v) => writer.bool(v));
  const data = writer.toBuffer();

  const accountMetas: IAccountMeta[] = [
    { address: accounts.owner, role: 2 },       // signer
    { address: accounts.soulAsset, role: 0 },   // readonly
    { address: accounts.agentState, role: 1 },   // writable
  ];

  return { programAddress: PROGRAM_ID, accounts: accountMetas, data };
}
