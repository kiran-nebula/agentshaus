/**
 * Transaction helper for building, signing, and sending transactions
 * using @solana/kit v2 with the executor keypair.
 */

import type { IInstruction, Address, Signature } from '@solana/kit';
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  signTransaction,
  getBase64EncodedWireTransaction,
} from '@solana/kit';
import { getRpc, getExecutorKeypair, getExecutorAddress } from './env';

const MAX_SUBMISSION_ATTEMPTS = 3;
const RPC_SEND_MAX_RETRIES = 20n;
const SIGNATURE_POLL_INTERVAL_MS = 1200;
const MIN_EXECUTOR_FEE_BUFFER_LAMPORTS = 100_000n; // 0.0001 SOL

function stringifyForLogs(value: unknown): string {
  return JSON.stringify(value, (_, nestedValue) =>
    typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue,
  );
}

function shouldRetryWithoutPreflight(err: unknown): boolean {
  const maybeCode =
    typeof err === 'object' && err !== null && 'code' in err
      ? Number((err as { code?: unknown }).code)
      : NaN;
  if (maybeCode === -32602) return true;

  const textParts: string[] = [];
  if (err instanceof Error) {
    textParts.push(err.message, err.name);
  } else {
    textParts.push(String(err));
  }

  try {
    textParts.push(stringifyForLogs(err));
  } catch {
    // ignore non-serializable errors
  }

  const text = textParts.join(' ').toLowerCase();
  return (
    text.includes('-32602') ||
    (text.includes('preflight') && text.includes('not supported')) ||
    text.includes('running%20preflight%20check%20is%20not%20supported')
  );
}

function extractRpcSignature(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'object' &&
    value !== null &&
    'signature' in value &&
    typeof (value as { signature?: unknown }).signature === 'string'
  ) {
    return (value as { signature: string }).signature;
  }
  return null;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  throw new Error(`Expected bigint-compatible value, got: ${String(value)}`);
}

function extractStatusErr(status: unknown): unknown | null {
  if (
    typeof status === 'object' &&
    status !== null &&
    'err' in status
  ) {
    return (status as { err?: unknown }).err ?? null;
  }
  return null;
}

function formatSolFromLamports(lamports: bigint): string {
  return (Number(lamports) / 1_000_000_000).toFixed(6);
}

async function waitForSignatureUntilBlockhashExpires(
  signature: string,
  lastValidBlockHeight: bigint,
): Promise<{
  status: unknown | null;
  expired: boolean;
}> {
  const rpc = getRpc();
  while (true) {
    const [statusResp, blockHeightResp] = await Promise.all([
      rpc
        .getSignatureStatuses([signature as Signature], {
          searchTransactionHistory: true,
        })
        .send(),
      rpc.getBlockHeight().send(),
    ]);

    const status = statusResp.value[0];
    if (status !== null) {
      return { status, expired: false };
    }

    const currentBlockHeight = toBigInt(blockHeightResp);
    if (currentBlockHeight > lastValidBlockHeight) {
      return { status: null, expired: true };
    }

    await Bun.sleep(SIGNATURE_POLL_INTERVAL_MS);
  }
}

export async function buildAndSendTransaction(
  instructions: IInstruction[],
): Promise<string> {
  const rpc = getRpc();
  const executorKeypair = await getExecutorKeypair();
  const executorAddress = await getExecutorAddress();
  const executorBalanceResp = await rpc.getBalance(executorAddress).send();
  const executorBalance = toBigInt(executorBalanceResp.value);

  if (executorBalance < MIN_EXECUTOR_FEE_BUFFER_LAMPORTS) {
    throw new Error(
      `Executor wallet ${executorAddress} has insufficient SOL for transaction fees ` +
        `(balance: ${formatSolFromLamports(executorBalance)} SOL). ` +
        `Fund it with at least ${formatSolFromLamports(MIN_EXECUTOR_FEE_BUFFER_LAMPORTS)} SOL.`,
    );
  }

  let forceSkipPreflight = false;
  let lastSubmittedSignature: string | null = null;

  for (let attempt = 1; attempt <= MAX_SUBMISSION_ATTEMPTS; attempt += 1) {
    const { value: latestBlockhash } = await rpc
      .getLatestBlockhash({ commitment: 'confirmed' })
      .send();

    // Build transaction message with a fresh blockhash per attempt.
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(executorAddress, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions(instructions, msg),
    );

    const compiled = compileTransaction(message);
    const signed = await signTransaction([executorKeypair], compiled);
    const encodedTx = getBase64EncodedWireTransaction(signed);

    const sendTransaction = (skipPreflight: boolean) =>
      rpc
        .sendTransaction(encodedTx, {
          encoding: 'base64',
          skipPreflight,
          preflightCommitment: skipPreflight ? undefined : 'confirmed',
          maxRetries: RPC_SEND_MAX_RETRIES,
        })
        .send();

    let sendResult: unknown;
    try {
      sendResult = await sendTransaction(forceSkipPreflight);
    } catch (err) {
      if (forceSkipPreflight || !shouldRetryWithoutPreflight(err)) {
        throw err;
      }

      forceSkipPreflight = true;
      sendResult = await sendTransaction(true);
    }

    const signature = extractRpcSignature(sendResult);
    if (!signature) {
      throw new Error(
        `sendTransaction returned an unexpected response: ${stringifyForLogs(sendResult)}`,
      );
    }
    lastSubmittedSignature = signature;

    const { status, expired } = await waitForSignatureUntilBlockhashExpires(
      signature,
      toBigInt(latestBlockhash.lastValidBlockHeight),
    );

    if (status !== null) {
      const statusErr = extractStatusErr(status);
      if (statusErr !== null) {
        throw new Error(
          `Transaction failed on-chain: ${stringifyForLogs(statusErr)} (signature: ${signature})`,
        );
      }
      return signature;
    }

    if (!expired) {
      // Defensive fallback: loop continues if status is still absent for any other reason.
      continue;
    }
  }

  throw new Error(
    `Transaction not observed on RPC before blockhash expiry after ${MAX_SUBMISSION_ATTEMPTS} attempts` +
      (lastSubmittedSignature ? ` (last signature: ${lastSubmittedSignature})` : ''),
  );
}
