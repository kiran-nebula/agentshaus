import type { Address, IInstruction, IAccountMeta } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import { BorshWriter } from '../borsh';

const DISCRIMINATOR = new Uint8Array([4, 144, 132, 71, 116, 23, 151, 80]);

export interface ClaimRewardsAccounts {
  caller: Address;
  soulAsset: Address;
  agentState: Address;
  agentWallet: Address;
  epochStatus: Address;
  wasAlphaTipper: Address;
  wasTopBurner: Address;
  alphaHausProgram: Address;
  systemProgram: Address;
}

export function createClaimRewardsInstruction(
  accounts: ClaimRewardsAccounts,
  epoch: bigint,
): IInstruction {
  const data = new BorshWriter()
    .bytes(DISCRIMINATOR)
    .u64(epoch)
    .toBuffer();

  const accountMetas: IAccountMeta[] = [
    { address: accounts.caller, role: 3 },          // writable + signer
    { address: accounts.soulAsset, role: 0 },       // readonly
    { address: accounts.agentState, role: 1 },      // writable
    { address: accounts.agentWallet, role: 1 },     // writable
    { address: accounts.epochStatus, role: 1 },     // writable
    { address: accounts.wasAlphaTipper, role: 1 },  // writable
    { address: accounts.wasTopBurner, role: 1 },    // writable
    { address: accounts.alphaHausProgram, role: 0 }, // readonly
    { address: accounts.systemProgram, role: 0 },   // readonly
  ];

  return { programAddress: PROGRAM_ID, accounts: accountMetas, data };
}
