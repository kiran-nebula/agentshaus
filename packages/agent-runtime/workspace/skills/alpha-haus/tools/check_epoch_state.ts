/**
 * OpenClaw tool: check_epoch_state
 *
 * Fetches the current alpha.haus epoch status including:
 * - Current epoch number
 * - Current TOP ALPHA wallet and tip amount
 * - Current TOP BURNER wallet and burn amount
 * - Whether the agent has participated this epoch
 */

import { findCurrentEpochStatus } from '@agents-haus/sdk';
import { lamportsToSol } from '@agents-haus/common';
import { getAddressEncoder, getProgramDerivedAddress, type Address } from '@solana/kit';
import {
  getRpc,
  getSoulMint,
  getAgentWalletPda,
  getExecutorAddress,
  getWasAlphaTipperPda,
  getWasTopBurnerPda,
  ALPHA_HAUS_PROGRAM_ID,
} from '../../../../src/env';

const addressEncoder = getAddressEncoder();
const MAINNET_WAS_ALPHA_TIPPER_SEED = new TextEncoder().encode('was_alpha_tipper');

async function getMainnetWasAlphaTipperPda(wallet: Address, epoch: bigint) {
  const epochBytes = new Uint8Array(8);
  new DataView(epochBytes.buffer).setBigUint64(0, epoch, true);
  return getProgramDerivedAddress({
    programAddress: ALPHA_HAUS_PROGRAM_ID,
    seeds: [MAINNET_WAS_ALPHA_TIPPER_SEED, epochBytes, addressEncoder.encode(wallet)],
  });
}

export async function checkEpochState() {
  try {
    const rpc = getRpc();
    const soulMint = getSoulMint();
    const executor = await getExecutorAddress();
    const [agentWallet] = await getAgentWalletPda(soulMint);

    // Find current epoch
    const result = await findCurrentEpochStatus(rpc);
    if (!result) {
      return {
        epoch: 0,
        topAlpha: null as string | null,
        topAlphaAmount: 0,
        topAlphaSol: '0',
        topBurner: null as string | null,
        topBurnAmount: 0,
        agentHasTipped: false,
        agentHasBurned: false,
        agentIsAlpha: false,
        agentIsBurner: false,
        error: 'No active epoch found',
      };
    }

    const { status } = result;
    const epoch = status.epoch;

    // Check if agent is current leader
    const agentIsAlpha =
      status.topAlpha !== null &&
      (status.topAlpha === agentWallet || status.topAlpha === executor);
    const agentIsBurner =
      status.topBurner !== null && status.topBurner === agentWallet;

    // Check participation by seeing if the was_alpha_tipper / was_top_burner PDAs exist
    let agentHasTipped = false;
    let agentHasBurned = false;

    try {
      const [wasAlphaTipper] = await getWasAlphaTipperPda(agentWallet, epoch);
      const tipperAccount = await rpc
        .getAccountInfo(wasAlphaTipper, { encoding: 'base64' })
        .send();
      agentHasTipped = tipperAccount.value !== null;
    } catch {
      // PDA doesn't exist — agent hasn't tipped
    }

    // Mainnet alpha.haus tipper mark uses seed order: [was_alpha_tipper, epoch, wallet]
    if (!agentHasTipped) {
      try {
        const [mainnetWasAlphaTipper] = await getMainnetWasAlphaTipperPda(
          executor,
          epoch,
        );
        const tipperAccount = await rpc
          .getAccountInfo(mainnetWasAlphaTipper, { encoding: 'base64' })
          .send();
        agentHasTipped = tipperAccount.value !== null;
      } catch {
        // keep false
      }
    }

    try {
      const [wasTopBurner] = await getWasTopBurnerPda(agentWallet, epoch);
      const burnerAccount = await rpc
        .getAccountInfo(wasTopBurner, { encoding: 'base64' })
        .send();
      agentHasBurned = burnerAccount.value !== null;
    } catch {
      // PDA doesn't exist — agent hasn't burned
    }

    return {
      epoch: Number(epoch),
      topAlpha: status.topAlpha,
      topAlphaAmount: Number(status.topAlphaAmount),
      topAlphaSol: lamportsToSol(status.topAlphaAmount).toFixed(4),
      topBurner: status.topBurner,
      topBurnAmount: Number(status.topBurnAmount),
      agentHasTipped,
      agentHasBurned,
      agentIsAlpha,
      agentIsBurner,
    };
  } catch (err) {
    return {
      epoch: 0,
      topAlpha: null as string | null,
      topAlphaAmount: 0,
      topAlphaSol: '0',
      topBurner: null as string | null,
      topBurnAmount: 0,
      agentHasTipped: false,
      agentHasBurned: false,
      agentIsAlpha: false,
      agentIsBurner: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
