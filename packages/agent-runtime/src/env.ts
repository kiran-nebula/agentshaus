/**
 * Environment configuration for the agent runtime.
 * All tools share this for RPC connections, keypairs, and PDA derivation.
 */

import type { Address, Rpc, SolanaRpcApi } from '@solana/kit';
import {
  createSolanaRpc,
  createKeyPairFromBytes,
  getAddressFromPublicKey,
  getProgramDerivedAddress,
  getAddressEncoder,
} from '@solana/kit';
import {
  PROGRAM_ID,
  ALPHA_HAUS_PROGRAM_ID,
  AGENT_WALLET_SEED,
  AGENT_STATE_SEED,
  TOKEN_2022_PROGRAM_ID,
  ALPHA_SOL_MINT,
  TIP_FLIP_LAMPORTS,
  BURN_FLIP_TOKENS,
  LAMPORTS_PER_SOL,
} from '@agents-haus/common';
import {
  ALPHA_SEED,
  TOP_BURNER_SEED,
  WAS_ALPHA_TIPPER_SEED,
  WAS_TOP_BURNER_SEED,
  EPOCH_STATUS_DISCRIMINATOR,
} from '@agents-haus/sdk';

export {
  PROGRAM_ID,
  ALPHA_HAUS_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ALPHA_SOL_MINT,
  TIP_FLIP_LAMPORTS,
  BURN_FLIP_TOKENS,
  LAMPORTS_PER_SOL,
};

const addressEncoder = getAddressEncoder();
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

function decodeBase58(value: string): Uint8Array {
  let num = 0n;
  for (const char of value) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error('EXECUTOR_KEYPAIR contains invalid base58 characters');
    }
    num = num * 58n + BigInt(idx);
  }

  const bytes: number[] = [];
  while (num > 0n) {
    bytes.push(Number(num % 256n));
    num /= 256n;
  }
  bytes.reverse();

  let leadingZeros = 0;
  for (const char of value) {
    if (char === '1') {
      leadingZeros += 1;
    } else {
      break;
    }
  }

  return new Uint8Array([
    ...new Array(leadingZeros).fill(0),
    ...bytes,
  ]);
}

let _rpc: Rpc<SolanaRpcApi> | null = null;
export function getRpc(): Rpc<SolanaRpcApi> {
  if (!_rpc) {
    _rpc = createSolanaRpc(requireEnv('SOLANA_RPC_URL'));
  }
  return _rpc;
}

export function getSoulMint(): Address {
  return requireEnv('SOUL_MINT_ADDRESS') as Address;
}

export async function getExecutorKeypair() {
  const raw = requireEnv('EXECUTOR_KEYPAIR').trim();

  // Supports either:
  // 1) JSON secret key array from solana-keygen, or
  // 2) base58-encoded secret key string.
  const bytes = raw.startsWith('[')
    ? new Uint8Array(JSON.parse(raw))
    : decodeBase58(raw);

  return createKeyPairFromBytes(bytes);
}

export async function getExecutorAddress(): Promise<Address> {
  const kp = await getExecutorKeypair();
  return getAddressFromPublicKey(kp.publicKey);
}

// PDA derivation helpers

export async function getAgentWalletPda(
  soulMint: Address,
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [AGENT_WALLET_SEED, addressEncoder.encode(soulMint)],
  });
}

export async function getAgentStatePda(
  soulMint: Address,
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [AGENT_STATE_SEED, addressEncoder.encode(soulMint)],
  });
}

/** Derive alpha.haus epoch_status PDA: seeds = ["epoch_status", epoch_le_bytes] */
export async function getEpochStatusPda(
  epoch: bigint,
): Promise<readonly [Address, number]> {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [new TextEncoder().encode('epoch_status'), epochBytes],
  });
}

/** Derive alpha.haus alpha PDA: seeds = ["alpha", epoch_le_bytes] */
export async function getAlphaPda(
  epoch: bigint,
): Promise<readonly [Address, number]> {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [ALPHA_SEED, epochBytes],
  });
}

/** Derive alpha.haus other_alphas PDA: seeds = ["other_alphas", epoch_le_bytes] */
export async function getOtherAlphasPda(
  epoch: bigint,
): Promise<readonly [Address, number]> {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [new TextEncoder().encode('other_alphas'), epochBytes],
  });
}

/** Derive alpha.haus was_alpha_tipper PDA: seeds = ["was_alpha_tipper", wallet_pubkey, epoch_le_bytes] */
export async function getWasAlphaTipperPda(
  wallet: Address,
  epoch: bigint,
): Promise<readonly [Address, number]> {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [WAS_ALPHA_TIPPER_SEED, addressEncoder.encode(wallet), epochBytes],
  });
}

/** Derive alpha.haus top_burner PDA: seeds = ["top_burner", epoch_le_bytes] */
export async function getTopBurnerPda(
  epoch: bigint,
): Promise<readonly [Address, number]> {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [TOP_BURNER_SEED, epochBytes],
  });
}

/** Derive alpha.haus other_burners PDA: seeds = ["other_burners", epoch_le_bytes] */
export async function getOtherBurnersPda(
  epoch: bigint,
): Promise<readonly [Address, number]> {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [new TextEncoder().encode('other_burners'), epochBytes],
  });
}

/** Derive alpha.haus was_top_burner PDA: seeds = ["was_top_burner", wallet_pubkey, epoch_le_bytes] */
export async function getWasTopBurnerPda(
  wallet: Address,
  epoch: bigint,
): Promise<readonly [Address, number]> {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [WAS_TOP_BURNER_SEED, addressEncoder.encode(wallet), epochBytes],
  });
}
