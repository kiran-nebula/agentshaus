import type { Rpc, SolanaRpcApi, Address } from '@solana/kit';
import { getAddressDecoder } from '@solana/kit';
import { PROGRAM_ID, MPL_CORE_PROGRAM_ID } from '@agents-haus/common';
import type { AgentState } from './types';

const AGENT_STATE_DISCRIMINATOR = new Uint8Array([254, 187, 98, 119, 228, 48, 47, 49]);
const MPL_CORE_OWNER_OFFSET = 1;
const MPL_CORE_MIN_LEN = MPL_CORE_OWNER_OFFSET + 32;
const OWNER_LOOKUP_BATCH_SIZE = 20;

type ProgramAccountEntry = { pubkey: Address; account: { data: unknown } };

function decodeBase64AccountData(data: unknown): Uint8Array {
  try {
    if (typeof data === 'string') {
      return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    }
    if (Array.isArray(data) && typeof data[0] === 'string') {
      return Uint8Array.from(atob(data[0]), (c) => c.charCodeAt(0));
    }
    if (data instanceof Uint8Array) {
      return data;
    }
  } catch {
    // fall through to empty bytes
  }
  return new Uint8Array(0);
}

function decodeAgentStateAccount(data: Uint8Array): AgentState | null {
  if (data.length < 8) return null;

  // Verify 8-byte Anchor discriminator
  for (let i = 0; i < 8; i++) {
    if (data[i] !== AGENT_STATE_DISCRIMINATOR[i]) return null;
  }

  try {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = getAddressDecoder();
    let offset = 8; // skip discriminator

    const readPubkey = (): Address => {
      const addr = decoder.decode(data.slice(offset, offset + 32));
      offset += 32;
      return addr;
    };
    const readU8 = (): number => {
      const v = view.getUint8(offset);
      offset += 1;
      return v;
    };
    const readU16 = (): number => {
      const v = view.getUint16(offset, true);
      offset += 2;
      return v;
    };
    const readU64 = (): bigint => {
      const v = view.getBigUint64(offset, true);
      offset += 8;
      return v;
    };
    const readI64 = (): bigint => {
      const v = view.getBigInt64(offset, true);
      offset += 8;
      return v;
    };
    const readBool = (): boolean => readU8() !== 0;
    const readString = (): string => {
      const len = view.getUint32(offset, true);
      offset += 4;
      const str = new TextDecoder().decode(data.slice(offset, offset + len));
      offset += len;
      return str;
    };

    return {
      soulMint: readPubkey(),
      owner: readPubkey(),
      executor: readPubkey(),
      walletBump: readU8(),
      stateBump: readU8(),
      isActive: readBool(),
      strategy: readU8(),
      personalityHash: readString(),
      agentVersion: readU16(),
      totalTips: readU64(),
      totalBurns: readU64(),
      totalSolSpent: readU64(),
      totalTokensBurned: readU64(),
      totalRewards: readU64(),
      epochsWonAlpha: readU64(),
      epochsWonBurner: readU64(),
      lastActivity: readI64(),
      createdAt: readI64(),
    };
  } catch {
    return null;
  }
}

function decodeMplCoreAssetOwner(data: Uint8Array): Address | null {
  if (data.length < MPL_CORE_MIN_LEN) return null;
  try {
    const decoder = getAddressDecoder();
    const ownerBytes = data.slice(MPL_CORE_OWNER_OFFSET, MPL_CORE_MIN_LEN);
    return decoder.decode(ownerBytes);
  } catch {
    return null;
  }
}

export async function fetchAgentState(
  rpc: Rpc<SolanaRpcApi>,
  agentStateAddress: Address,
): Promise<AgentState | null> {
  const response = await rpc
    .getAccountInfo(agentStateAddress, { encoding: 'base64' })
    .send();

  if (!response.value?.data) return null;

  const raw =
    typeof response.value.data === 'string'
      ? response.value.data
      : (response.value.data as readonly string[])[0];
  const data = decodeBase64AccountData(raw);
  return decodeAgentStateAccount(data);
}

export async function fetchAgentWalletBalance(
  rpc: Rpc<SolanaRpcApi>,
  agentWalletAddress: Address,
): Promise<bigint> {
  const response = await rpc.getBalance(agentWalletAddress).send();
  return response.value;
}

export async function fetchCurrentSoulOwner(
  rpc: Rpc<SolanaRpcApi>,
  soulMint: Address,
): Promise<Address | null> {
  const response = await rpc
    .getAccountInfo(soulMint, { encoding: 'base64' })
    .send();

  if (!response.value?.data) return null;
  if (response.value.owner !== MPL_CORE_PROGRAM_ID) return null;

  const data = decodeBase64AccountData(response.value.data);
  return decodeMplCoreAssetOwner(data);
}

/**
 * Fetch all AgentState accounts whose Soul NFT is currently held by `ownerAddress`.
 * This resolves live owner from each mpl-core asset account to stay correct after NFT transfers.
 */
export async function fetchAgentsByOwner(
  rpc: Rpc<SolanaRpcApi>,
  ownerAddress: Address,
): Promise<{ address: Address; state: AgentState }[]> {
  return fetchAgentsByOwners(rpc, [ownerAddress]);
}

/**
 * Fetch all AgentState accounts whose Soul NFT is currently held by any address in `ownerAddresses`.
 * This resolves live owner from each mpl-core asset account to stay correct after NFT transfers.
 */
export async function fetchAgentsByOwners(
  rpc: Rpc<SolanaRpcApi>,
  ownerAddresses: readonly Address[],
): Promise<{ address: Address; state: AgentState }[]> {
  if (ownerAddresses.length === 0) return [];
  const ownerSet = new Set(ownerAddresses.map((owner) => String(owner)));

  const discB64 = btoa(String.fromCharCode(...AGENT_STATE_DISCRIMINATOR));

  const accounts = (await rpc
    .getProgramAccounts(PROGRAM_ID, {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: BigInt(0),
            bytes: discB64 as any,
            encoding: 'base64',
          },
        },
      ],
    })
    .send()) as unknown as ProgramAccountEntry[];

  const parsed: { address: Address; state: AgentState }[] = [];
  for (const account of accounts) {
    const state = decodeAgentStateAccount(decodeBase64AccountData(account.account.data));
    if (state) parsed.push({ address: account.pubkey, state });
  }

  const results: { address: Address; state: AgentState }[] = [];
  for (let i = 0; i < parsed.length; i += OWNER_LOOKUP_BATCH_SIZE) {
    const batch = parsed.slice(i, i + OWNER_LOOKUP_BATCH_SIZE);
    const matches = await Promise.all(
      batch.map(async (entry) => {
        try {
          const currentOwner = await fetchCurrentSoulOwner(rpc, entry.state.soulMint);
          if (currentOwner && ownerSet.has(String(currentOwner))) return entry;
        } catch {
          // Skip this entry if owner lookup fails
        }
        return null;
      }),
    );
    for (const match of matches) {
      if (match) results.push(match);
    }
  }

  return results;
}
