import type { Address, IInstruction, IAccountMeta } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import { BorshWriter } from '../borsh';
import type { AgentBurnArgs } from '../types';

const DISCRIMINATOR = new Uint8Array([241, 213, 177, 51, 194, 237, 61, 131]);

export interface AgentBurnAccounts {
  executor: Address;
  agentState: Address;
  agentWallet: Address;
  epochStatus: Address;
  topBurner: Address;
  otherBurners: Address;
  agentTokenAccount: Address;
  tokenMint: Address;
  wasTopBurner: Address;
  alphaHausProgram: Address;
  token2022Program: Address;
  systemProgram: Address;
}

export function createAgentBurnInstruction(
  accounts: AgentBurnAccounts,
  args: AgentBurnArgs,
): IInstruction {
  const writer = new BorshWriter().bytes(DISCRIMINATOR);
  writer.u64(args.currEpoch);
  writer.u64(args.burnEpoch);
  writer.u64(args.burnAmount);
  writer.string(args.memo);
  writer.vec(args.taggedAddresses, (addr) => writer.pubkey(addr));
  const data = writer.toBuffer();

  const accountMetas: IAccountMeta[] = [
    { address: accounts.executor, role: 2 },          // signer
    { address: accounts.agentState, role: 1 },        // writable
    { address: accounts.agentWallet, role: 1 },       // writable
    { address: accounts.epochStatus, role: 1 },       // writable
    { address: accounts.topBurner, role: 1 },         // writable
    { address: accounts.otherBurners, role: 1 },      // writable
    { address: accounts.agentTokenAccount, role: 1 }, // writable
    { address: accounts.tokenMint, role: 1 },         // writable
    { address: accounts.wasTopBurner, role: 1 },      // writable
    { address: accounts.alphaHausProgram, role: 0 },  // readonly
    { address: accounts.token2022Program, role: 0 },  // readonly
    { address: accounts.systemProgram, role: 0 },     // readonly
  ];

  return { programAddress: PROGRAM_ID, accounts: accountMetas, data };
}
