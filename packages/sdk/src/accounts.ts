import type { Rpc, SolanaRpcApi, Address } from '@solana/kit';
import { getAddressDecoder } from '@solana/kit';
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
  const data = new Uint8Array(Buffer.from(raw, 'base64'));

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
