import type { Rpc, SolanaRpcApi, Address } from '@solana/kit';
import { getAddressDecoder, getProgramDerivedAddress } from '@solana/kit';
import {
  ALPHA_HAUS_PROGRAM_ID,
  EPOCH_STATUS_DISCRIMINATOR,
  ALPHA_SEED,
  TOP_BURNER_SEED,
  TOP_BURNER_WALLET_OFFSET,
  TOP_BURNER_AMOUNT_OFFSET,
} from './constants';

export interface EpochStatus {
  epoch: bigint;
  topAlpha: Address | null;
  topAlphaAmount: bigint;
  topBurner: Address | null;
  topBurnAmount: bigint;
}

type ProgramAccountEntry = { pubkey: Address; account: { data: unknown } };

/**
 * Decode an epoch_status account (20 bytes on-chain).
 *
 * Layout:
 *   [0..8)   discriminator
 *   [8..16)  epoch (u64 LE)
 *   [16]     status flags byte
 *   [17]     has_alpha flag
 *   [18]     has_burner flag
 *   [19]     reserved
 */
function decodeEpochStatusAccount(data: Uint8Array): { epoch: bigint; hasAlpha: boolean; hasBurner: boolean } | null {
  if (data.length < 20) return null;

  try {
    // Verify discriminator
    for (let i = 0; i < 8; i++) {
      if (data[i] !== EPOCH_STATUS_DISCRIMINATOR[i]) return null;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const epoch = view.getBigUint64(8, true);
    const hasAlpha = data[17] === 1;
    const hasBurner = data[18] === 1;

    return { epoch, hasAlpha, hasBurner };
  } catch {
    return null;
  }
}

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

/** Derive the epoch LE bytes buffer for PDA seeds. */
function epochLeBytes(epoch: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, epoch, true);
  return buf;
}

/**
 * Decode the alpha PDA account to extract the top alpha wallet and tip amount.
 *
 * Layout:
 *   [0..8)   discriminator
 *   [8..40)  wallet (Pubkey, 32 bytes)
 *   [40..)   Borsh string (memo), then epoch(u64), uuid(Borsh string), amount(u64), ...
 */
function decodeAlphaAccount(data: Uint8Array): { wallet: Address; amount: bigint } | null {
  // Minimum: disc(8) + wallet(32) + memo_len(4) + epoch(8) + uuid_len(4) + amount(8) = 64
  if (data.length < 64) return null;

  try {
    const decoder = getAddressDecoder();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    // Wallet starts at offset 8, immediately after the 8-byte discriminator
    const walletOffset = 8;
    const wallet = decoder.decode(data.slice(walletOffset, walletOffset + 32));
    let offset = walletOffset + 32; // 40

    // Skip Borsh memo string: u32 LE length + bytes
    const memoLen = view.getUint32(offset, true);
    offset += 4 + memoLen;

    // Skip epoch u64
    offset += 8;

    // Skip Borsh uuid string: u32 LE length + bytes
    if (offset + 4 > data.length) return { wallet, amount: 0n };
    const uuidLen = view.getUint32(offset, true);
    offset += 4 + uuidLen;

    // Amount u64
    if (offset + 8 > data.length) return { wallet, amount: 0n };
    const amount = view.getBigUint64(offset, true);

    return { wallet, amount };
  } catch {
    return null;
  }
}

/**
 * Decode the top_burner PDA account to extract the top burner wallet and burn amount.
 *
 * Layout:
 *   [0..8)   discriminator
 *   [8..40)  wallet (Pubkey, 32 bytes)
 *   [40..48) epoch (u64 LE)
 *   [48..56) amount (u64 LE)
 *   ...
 */
function decodeTopBurnerAccount(data: Uint8Array): { wallet: Address; amount: bigint } | null {
  if (data.length < TOP_BURNER_AMOUNT_OFFSET + 8) return null;

  try {
    const decoder = getAddressDecoder();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    const wallet = decoder.decode(data.slice(TOP_BURNER_WALLET_OFFSET, TOP_BURNER_WALLET_OFFSET + 32));
    const amount = view.getBigUint64(TOP_BURNER_AMOUNT_OFFSET, true);

    return { wallet, amount };
  } catch {
    return null;
  }
}

async function fetchEpochStatusAccounts(rpc: Rpc<SolanaRpcApi>): Promise<ProgramAccountEntry[]> {
  const discB64 = btoa(String.fromCharCode(...EPOCH_STATUS_DISCRIMINATOR));

  // Primary path: filtered query.
  // Fallback path below avoids memcmp for RPC/provider stacks that reject this shape.
  try {
    const filtered = await (rpc.getProgramAccounts as Function)(ALPHA_HAUS_PROGRAM_ID, {
      encoding: 'base64',
      dataSlice: { offset: 0, length: 20 },
      filters: [
        {
          memcmp: {
            offset: BigInt(0),
            bytes: discB64,
            encoding: 'base64',
          },
        },
      ],
    }).send() as ProgramAccountEntry[];

    if (Array.isArray(filtered) && filtered.length > 0) {
      return filtered;
    }
  } catch {
    // fall through to unfiltered scan
  }

  const unfiltered = await (rpc.getProgramAccounts as Function)(ALPHA_HAUS_PROGRAM_ID, {
    encoding: 'base64',
    dataSlice: { offset: 0, length: 20 },
  }).send() as ProgramAccountEntry[];

  return Array.isArray(unfiltered) ? unfiltered : [];
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
  const parsed = decodeEpochStatusAccount(data);
  if (!parsed) return null;

  return resolveEpochLeaders(rpc, parsed);
}

/**
 * Given a parsed epoch_status, fetch the alpha and top_burner PDAs
 * to resolve the full EpochStatus with wallet addresses and amounts.
 */
async function resolveEpochLeaders(
  rpc: Rpc<SolanaRpcApi>,
  parsed: { epoch: bigint; hasAlpha: boolean; hasBurner: boolean },
): Promise<EpochStatus> {
  const eb = epochLeBytes(parsed.epoch);

  let topAlpha: Address | null = null;
  let topAlphaAmount = 0n;
  let topBurner: Address | null = null;
  let topBurnAmount = 0n;

  // Fetch alpha and top_burner PDAs in parallel
  const fetches: Promise<void>[] = [];

  if (parsed.hasAlpha) {
    fetches.push(
      (async () => {
        try {
          const [alphaPda] = await getProgramDerivedAddress({
            programAddress: ALPHA_HAUS_PROGRAM_ID,
            seeds: [ALPHA_SEED, eb],
          });
          const resp = await rpc
            .getAccountInfo(alphaPda, { encoding: 'base64' })
            .send();
          if (resp.value?.data) {
            const alphaData = decodeBase64AccountData(resp.value.data);
            const result = decodeAlphaAccount(alphaData);
            if (result) {
              topAlpha = result.wallet;
              topAlphaAmount = result.amount;
            }
          }
        } catch {
          // alpha PDA doesn't exist or failed to decode
        }
      })(),
    );
  }

  if (parsed.hasBurner) {
    fetches.push(
      (async () => {
        try {
          const [burnerPda] = await getProgramDerivedAddress({
            programAddress: ALPHA_HAUS_PROGRAM_ID,
            seeds: [TOP_BURNER_SEED, eb],
          });
          const resp = await rpc
            .getAccountInfo(burnerPda, { encoding: 'base64' })
            .send();
          if (resp.value?.data) {
            const burnerData = decodeBase64AccountData(resp.value.data);
            const result = decodeTopBurnerAccount(burnerData);
            if (result) {
              topBurner = result.wallet;
              topBurnAmount = result.amount;
            }
          }
        } catch {
          // top_burner PDA doesn't exist or failed to decode
        }
      })(),
    );
  }

  await Promise.all(fetches);

  return {
    epoch: parsed.epoch,
    topAlpha,
    topAlphaAmount,
    topBurner,
    topBurnAmount,
  };
}

export async function findCurrentEpochStatus(
  rpc: Rpc<SolanaRpcApi>,
): Promise<{ address: Address; status: EpochStatus } | null> {
  const accounts = await fetchEpochStatusAccounts(rpc);

  if (!accounts || !accounts.length) return null;

  let latest: { address: Address; epoch: bigint; hasAlpha: boolean; hasBurner: boolean } | null = null;

  for (const entry of accounts) {
    try {
      const data = decodeBase64AccountData(entry.account.data);
      const parsed = decodeEpochStatusAccount(data);
      if (parsed && (!latest || parsed.epoch > latest.epoch)) {
        latest = { address: entry.pubkey, ...parsed };
      }
    } catch {
      // Ignore malformed accounts and continue scanning.
    }
  }

  if (!latest) return null;

  const status = await resolveEpochLeaders(rpc, latest);
  return { address: latest.address, status };
}
