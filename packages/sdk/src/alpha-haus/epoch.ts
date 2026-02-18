import type { Rpc, SolanaRpcApi, Address } from '@solana/kit';
import { getAddressDecoder } from '@solana/kit';
import { ALPHA_HAUS_PROGRAM_ID, EPOCH_STATUS_DISCRIMINATOR } from './constants';

export interface EpochStatus {
  epoch: bigint;
  topAlpha: Address | null;
  topAlphaAmount: bigint;
  topBurner: Address | null;
  topBurnAmount: bigint;
}

function decodeEpochStatus(data: Uint8Array): EpochStatus | null {
  // Verify discriminator
  for (let i = 0; i < 8; i++) {
    if (data[i] !== EPOCH_STATUS_DISCRIMINATOR[i]) return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const decoder = getAddressDecoder();
  let offset = 8;

  const epoch = view.getBigUint64(offset, true);
  offset += 8;

  // Top alpha wallet (Option<Pubkey>: 1 byte tag + 32 bytes)
  const hasAlpha = view.getUint8(offset) === 1;
  offset += 1;
  let topAlpha: Address | null = null;
  if (hasAlpha) {
    topAlpha = decoder.decode(data.slice(offset, offset + 32));
  }
  offset += 32;

  const topAlphaAmount = view.getBigUint64(offset, true);
  offset += 8;

  // Top burner wallet (Option<Pubkey>)
  const hasBurner = view.getUint8(offset) === 1;
  offset += 1;
  let topBurner: Address | null = null;
  if (hasBurner) {
    topBurner = decoder.decode(data.slice(offset, offset + 32));
  }
  offset += 32;

  const topBurnAmount = view.getBigUint64(offset, true);

  return { epoch, topAlpha, topAlphaAmount, topBurner, topBurnAmount };
}

function decodeBase64AccountData(data: unknown): Uint8Array {
  if (typeof data === 'string') {
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  }
  if (Array.isArray(data)) {
    return Uint8Array.from(atob(data[0] as string), (c) => c.charCodeAt(0));
  }
  // @solana/kit may return Uint8Array directly
  return data as Uint8Array;
}

export async function fetchEpochStatus(
  rpc: Rpc<SolanaRpcApi>,
  epochStatusAddress: Address,
): Promise<EpochStatus | null> {
  const response = await rpc
    .getAccountInfo(epochStatusAddress, { encoding: 'base64' })
    .send();

  if (!response.value?.data) return null;

  const data = decodeBase64AccountData(response.value.data);
  return decodeEpochStatus(data);
}

export async function findCurrentEpochStatus(
  rpc: Rpc<SolanaRpcApi>,
): Promise<{ address: Address; status: EpochStatus } | null> {
  // Use getProgramAccounts with memcmp filter on discriminator
  // to find all epoch_status accounts, then pick the latest
  const discB64 = btoa(String.fromCharCode(...EPOCH_STATUS_DISCRIMINATOR));

  const accounts = await (rpc.getProgramAccounts as Function)(
    ALPHA_HAUS_PROGRAM_ID,
    {
      encoding: 'base64',
      filters: [
        {
          memcmp: {
            offset: BigInt(0),
            bytes: discB64,
            encoding: 'base64',
          },
        },
      ],
    },
  ).send() as Array<{ pubkey: Address; account: { data: unknown } }>;

  if (!accounts || !accounts.length) return null;

  let latest: { address: Address; status: EpochStatus } | null = null;

  for (const entry of accounts) {
    const data = decodeBase64AccountData(entry.account.data);
    const status = decodeEpochStatus(data);
    if (status && (!latest || status.epoch > latest.status.epoch)) {
      latest = { address: entry.pubkey, status };
    }
  }

  return latest;
}
