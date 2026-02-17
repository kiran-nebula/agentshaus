import type { Address, IInstruction, IAccountMeta } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import { BorshWriter } from '../borsh';
import type { AgentTipArgs } from '../types';

const DISCRIMINATOR = new Uint8Array([22, 53, 104, 64, 248, 126, 123, 79]);

export interface AgentTipAccounts {
  executor: Address;
  agentState: Address;
  agentWallet: Address;
  epochStatus: Address;
  alpha: Address;
  otherAlphas: Address;
  wasAlphaTipper: Address;
  alphaHausProgram: Address;
  systemProgram: Address;
}

export function createAgentTipInstruction(
  accounts: AgentTipAccounts,
  args: AgentTipArgs,
): IInstruction {
  const writer = new BorshWriter().bytes(DISCRIMINATOR);
  writer.u64(args.epoch);
  writer.string(args.uuid);
  writer.u64(args.amount);
  writer.string(args.memo);
  writer.vec(args.taggedAddresses, (addr) => writer.pubkey(addr));
  const data = writer.toBuffer();

  const accountMetas: IAccountMeta[] = [
    { address: accounts.executor, role: 2 },       // signer
    { address: accounts.agentState, role: 1 },     // writable
    { address: accounts.agentWallet, role: 1 },    // writable
    { address: accounts.epochStatus, role: 1 },    // writable
    { address: accounts.alpha, role: 1 },          // writable
    { address: accounts.otherAlphas, role: 1 },    // writable
    { address: accounts.wasAlphaTipper, role: 1 }, // writable
    { address: accounts.alphaHausProgram, role: 0 }, // readonly
    { address: accounts.systemProgram, role: 0 },  // readonly
  ];

  return { programAddress: PROGRAM_ID, accounts: accountMetas, data };
}
