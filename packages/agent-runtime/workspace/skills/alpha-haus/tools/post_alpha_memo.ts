/**
 * OpenClaw tool: post_alpha_memo
 *
 * Executes a tip transaction directly against alpha.haus (mainnet interface)
 * with an attached memo.
 *
 * @param memo - The memo text to post (max 560 characters)
 * @param amount - Optional tip amount in SOL (defaults to flip amount: current + 0.001)
 */

import type { Address, IInstruction } from '@solana/kit';
import { findCurrentEpochStatus } from '@agents-haus/sdk';
import { getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { solToLamports, lamportsToSol } from '@agents-haus/common';
import {
  getRpc,
  getExecutorAddress,
  ALPHA_HAUS_PROGRAM_ID,
  TIP_FLIP_LAMPORTS,
} from '../../../../src/env';
import { buildAndSendTransaction } from '../../../../src/tx';

const SYSTEM_PROGRAM = '11111111111111111111111111111111' as Address;
const TIP_DISCRIMINATOR = new Uint8Array([77, 164, 35, 21, 36, 121, 213, 51]); // global:tip
const MAINNET_EPOCH_STATUS_INFO_SEED = new TextEncoder().encode('epoch_status_info');
const MAINNET_OTHER_ALPHAS_INFO_SEED = new TextEncoder().encode('other_alphas_info');
const MAINNET_WAS_ALPHA_TIPPER_SEED = new TextEncoder().encode('was_alpha_tipper');
const MIN_EXECUTOR_FEE_BUFFER_LAMPORTS = 100_000n; // 0.0001 SOL

const addressEncoder = getAddressEncoder();

function u32LE(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64LE(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function borshString(value: string): Uint8Array {
  const encoded = new TextEncoder().encode(value);
  return concatBytes(u32LE(encoded.length), encoded);
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function formatSol(lamports: bigint): string {
  return (Number(lamports) / 1_000_000_000).toFixed(6);
}

function toEpochBytes(epoch: bigint): Uint8Array {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return epochBytes;
}

function createMainnetTipInstruction(params: {
  tipper: Address;
  epochStatusInfo: Address;
  alpha: Address;
  otherAlphasInfo: Address;
  wasAlphaTipper: Address;
  epoch: bigint;
  uuid: string;
  amount: bigint;
  memo: string;
}): IInstruction {
  const data = concatBytes(
    TIP_DISCRIMINATOR,
    u64LE(params.epoch),
    borshString(params.uuid),
    u64LE(params.amount),
    borshString(params.memo),
    u32LE(0), // tagged_addresses vec length
  );

  return {
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    accounts: [
      { address: params.tipper, role: 3 }, // writable signer
      { address: params.epochStatusInfo, role: 1 },
      { address: params.alpha, role: 1 },
      { address: params.otherAlphasInfo, role: 1 },
      { address: params.wasAlphaTipper, role: 1 },
      { address: SYSTEM_PROGRAM, role: 0 },
    ],
    data,
  };
}

export async function postAlphaMemo(params: { memo: string; amount?: number }) {
  const { memo, amount } = params;

  if (memo.length > 560) {
    return { success: false, error: 'Memo exceeds 560 character limit' };
  }

  try {
    const rpc = getRpc();
    const executor = await getExecutorAddress();

    // Fetch current epoch to determine tip amount
    const epochResult = await findCurrentEpochStatus(rpc);
    if (!epochResult) {
      return { success: false, error: 'No active epoch found' };
    }

    const epoch = epochResult.status.epoch;
    const currentTopAmount = epochResult.status.topAlphaAmount;

    // Calculate tip amount: user-specified or flip amount
    let tipLamports: bigint;
    if (amount !== undefined) {
      tipLamports = solToLamports(amount);
    } else {
      // Flip = current top + 0.001 SOL
      tipLamports = currentTopAmount + TIP_FLIP_LAMPORTS;
    }

    // Check executor balance (direct mainnet interface uses signer wallet as tipper)
    const executorBalanceResponse = await rpc.getBalance(executor).send();
    const executorBalance = BigInt(executorBalanceResponse.value);
    const requiredWithFeeBuffer = tipLamports + MIN_EXECUTOR_FEE_BUFFER_LAMPORTS;
    if (executorBalance < requiredWithFeeBuffer) {
      return {
        success: false,
        error:
          `Insufficient executor balance for tip + fees: have ${formatSol(executorBalance)} SOL, ` +
          `need at least ${formatSol(requiredWithFeeBuffer)} SOL`,
      };
    }

    // Derive alpha.haus mainnet PDAs for this epoch.
    const epochBytes = toEpochBytes(epoch);
    const [epochStatusInfo] = await getProgramDerivedAddress({
      programAddress: ALPHA_HAUS_PROGRAM_ID,
      seeds: [MAINNET_EPOCH_STATUS_INFO_SEED, epochBytes],
    });
    const [alpha] = await getProgramDerivedAddress({
      programAddress: ALPHA_HAUS_PROGRAM_ID,
      seeds: [new TextEncoder().encode('alpha'), epochBytes],
    });
    const [otherAlphasInfo] = await getProgramDerivedAddress({
      programAddress: ALPHA_HAUS_PROGRAM_ID,
      seeds: [MAINNET_OTHER_ALPHAS_INFO_SEED, epochBytes],
    });
    const [wasAlphaTipper] = await getProgramDerivedAddress({
      programAddress: ALPHA_HAUS_PROGRAM_ID,
      seeds: [
        MAINNET_WAS_ALPHA_TIPPER_SEED,
        epochBytes,
        addressEncoder.encode(executor),
      ],
    });

    // Generate a UUID for the tip
    const uuid = crypto.randomUUID().replaceAll('-', '');
    const ix = createMainnetTipInstruction({
      tipper: executor,
      epochStatusInfo,
      alpha,
      otherAlphasInfo,
      wasAlphaTipper,
      epoch,
      uuid,
      amount: tipLamports,
      memo,
    });

    const signature = await buildAndSendTransaction([ix]);

    return {
      success: true,
      signature,
      epoch: Number(epoch),
      tipAmount: lamportsToSol(tipLamports).toFixed(4),
      tipper: executor as string,
      memo,
    };
  } catch (err) {
    return {
      success: false,
      signature: null as string | null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
