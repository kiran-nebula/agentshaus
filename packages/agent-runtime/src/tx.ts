/**
 * Transaction helper for building, signing, and sending transactions
 * using @solana/kit v2 with the executor keypair.
 */

import type { IInstruction, Address } from '@solana/kit';
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  signTransaction,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
} from '@solana/kit';
import { getRpc, getExecutorKeypair, getExecutorAddress } from './env';

export async function buildAndSendTransaction(
  instructions: IInstruction[],
): Promise<string> {
  const rpc = getRpc();
  const executorKeypair = await getExecutorKeypair();
  const executorAddress = await getExecutorAddress();

  // Get recent blockhash
  const { value: latestBlockhash } = await rpc
    .getLatestBlockhash({ commitment: 'confirmed' })
    .send();

  // Build transaction message
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(executorAddress, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(instructions, msg),
  );

  // Compile and sign
  const compiled = compileTransaction(message);
  const signed = await signTransaction([executorKeypair], compiled);

  // Send
  const encodedTx = getBase64EncodedWireTransaction(signed);
  const signature = await rpc
    .sendTransaction(encodedTx, {
      encoding: 'base64',
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    })
    .send();

  return typeof signature === 'string'
    ? signature
    : getSignatureFromTransaction(signed);
}
