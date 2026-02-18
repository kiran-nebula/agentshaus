import type { Rpc, SolanaRpcApi, Address } from '@solana/kit';
import { getAddressDecoder } from '@solana/kit';
import { PROGRAM_ID } from '@agents-haus/common';
import type { AgentState } from './types';

const AGENT_STATE_DISCRIMINATOR = new Uint8Array([254, 187, 98, 119, 228, 48, 47, 49]);

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
  // Use atob for browser compatibility (no Buffer polyfill needed)
  const data = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  // Verify 8-byte Anchor discriminator
  for (let i = 0; i < 8; i++) {
    if (data[i] !== AGENT_STATE_DISCRIMINATOR[i]) return null;
  }

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
}

export async function fetchAgentWalletBalance(
  rpc: Rpc<SolanaRpcApi>,
  agentWalletAddress: Address,
): Promise<bigint> {
  const response = await rpc.getBalance(agentWalletAddress).send();
  return response.value;
}

/**
 * Fetch all AgentState accounts owned by a specific wallet address.
 * Uses getProgramAccounts with a memcmp filter on the owner field (offset 40).
 * Layout: 8-byte discriminator + 32-byte soulMint + 32-byte owner = offset 40
 */
export async function fetchAgentsByOwner(
  rpc: Rpc<SolanaRpcApi>,
  ownerAddress: Address,
): Promise<{ address: Address; state: AgentState }[]> {
  const discB64 = btoa(String.fromCharCode(...AGENT_STATE_DISCRIMINATOR));

  // Cast through unknown to satisfy branded type constraints
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
        {
          memcmp: {
            offset: BigInt(40),
            bytes: ownerAddress as any,
            encoding: 'base58',
          },
        },
      ],
    })
    .send()) as unknown as Array<{ pubkey: Address; account: { data: [string, string] } }>;

  const results: { address: Address; state: AgentState }[] = [];

  for (const account of accounts) {
    const raw = account.account.data[0];
    const data = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

    // Verify discriminator
    let valid = true;
    for (let i = 0; i < 8; i++) {
      if (data[i] !== AGENT_STATE_DISCRIMINATOR[i]) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const decoder = getAddressDecoder();
    let offset = 8;

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

    results.push({
      address: account.pubkey,
      state: {
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
      },
    });
  }

  return results;
}
