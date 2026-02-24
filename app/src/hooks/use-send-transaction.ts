'use client';

import { useCallback } from 'react';
import type { IInstruction, Address } from '@solana/kit';
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compileTransaction,
  partiallySignTransaction,
  getBase64EncodedWireTransaction,
} from '@solana/kit';
import {
  useConnectedStandardWallets,
  useStandardSignAndSendTransaction,
  useStandardSignTransaction,
} from '@privy-io/react-auth/solana';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaRpc } from './use-solana-rpc';
import {
  getExternalSolanaWallet,
  getPreferredSolanaWallet,
} from '@/lib/solana-wallet-preference';

/** A keypair signer for additional signers (e.g. soul asset mint) */
export interface KeypairSigner {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export function useSendTransaction() {
  const { user } = usePrivy();
  const { wallets } = useConnectedStandardWallets();
  const { signAndSendTransaction } = useStandardSignAndSendTransaction();
  const { signTransaction } = useStandardSignTransaction();
  const { rpc } = useSolanaRpc();

  const toBase58 = (signature: Uint8Array): string => {
    const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = BigInt(0);
    for (const byte of signature) {
      num = num * BigInt(256) + BigInt(byte);
    }
    let base58 = '';
    while (num > BigInt(0)) {
      const remainder = num % BigInt(58);
      num = num / BigInt(58);
      base58 = alphabet[Number(remainder)] + base58;
    }
    // Add leading '1's for leading zero bytes
    for (const byte of signature) {
      if (byte === 0) base58 = '1' + base58;
      else break;
    }
    return base58 || '1';
  };

  const toBytes = (value: Uint8Array | ArrayBuffer | string): Uint8Array => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    // Assume base64 string
    return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  };

  const toBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  const sendTransaction = useCallback(
    async (
      instructions: IInstruction[],
      additionalSigners?: KeypairSigner[],
    ): Promise<string> => {
      const wallet =
        getExternalSolanaWallet(wallets) ??
        getPreferredSolanaWallet(wallets, user);
      if (!wallet) throw new Error('No wallet connected');

      const feePayer = wallet.address as Address;

      const { value: latestBlockhash } = await rpc
        .getLatestBlockhash({ commitment: 'confirmed' })
        .send();

      const message = pipe(
        // Legacy message format avoids wallet-specific quirks with v0 transactions.
        createTransactionMessage({ version: 'legacy' }),
        (msg) => setTransactionMessageFeePayer(feePayer, msg),
        (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
        (msg) => appendTransactionMessageInstructions(instructions, msg),
      );

      let compiled = compileTransaction(message);

      // Partially sign with additional keypair signers (e.g. soul asset)
      if (additionalSigners && additionalSigners.length > 0) {
        for (const signer of additionalSigners) {
          compiled = await partiallySignTransaction(
            [signer],
            compiled,
          );
        }
      }

      const encodedTx = getBase64EncodedWireTransaction(compiled);
      const txBytes = Uint8Array.from(atob(encodedTx), (c) => c.charCodeAt(0));

      try {
        // Primary path: wallet signs + sends.
        const result = await signAndSendTransaction({
          transaction: txBytes,
          wallet,
        });
        if (!result || !('signature' in result) || !result.signature) {
          throw new Error('Wallet signAndSendTransaction returned no signature');
        }
        const signature = result.signature;
        if (typeof signature === 'string') return signature;
        return toBase58(toBytes(signature as Uint8Array | ArrayBuffer | string));
      } catch (err) {
        // Fallback path for wallet adapters that fail in signAndSend (seen as `r`/`err` undefined).
        const signed = await signTransaction({
          transaction: txBytes,
          wallet,
        });
        if (!signed || !('signedTransaction' in signed) || !signed.signedTransaction) {
          throw err instanceof Error ? err : new Error(String(err));
        }

        const signedTxBytes = toBytes(
          signed.signedTransaction as Uint8Array | ArrayBuffer | string,
        );
        const signature = await rpc
          .sendTransaction(toBase64(signedTxBytes) as any, {
            preflightCommitment: 'confirmed',
            encoding: 'base64',
          })
          .send();
        if (!signature) {
          throw err instanceof Error ? err : new Error('Transaction submission failed');
        }
        return signature as string;
      }
    },
    [wallets, user, signAndSendTransaction, signTransaction, rpc],
  );

  return { sendTransaction };
}
