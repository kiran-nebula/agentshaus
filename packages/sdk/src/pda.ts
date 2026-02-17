import type { Address } from '@solana/kit';
import { getProgramDerivedAddress, getAddressEncoder } from '@solana/kit';
import { PROGRAM_ID, AGENT_WALLET_SEED, AGENT_STATE_SEED } from '@agents-haus/common';

const addressEncoder = getAddressEncoder();

export async function getAgentWalletPda(soulMint: Address): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [AGENT_WALLET_SEED, addressEncoder.encode(soulMint)],
  });
}

export async function getAgentStatePda(soulMint: Address): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [AGENT_STATE_SEED, addressEncoder.encode(soulMint)],
  });
}
