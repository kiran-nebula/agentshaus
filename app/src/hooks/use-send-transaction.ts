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
  getBase64EncodedWireTransaction,
} from '@solana/kit';
import {
  useConnectedStandardWallets,
  useStandardSignAndSendTransaction,
} from '@privy-io/react-auth/solana';
import { useSolanaRpc } from './use-solana-rpc';

export function useSendTransaction() {
  const { wallets } = useConnectedStandardWallets();
  const { signAndSendTransaction } = useStandardSignAndSendTransaction();
  const { rpc } = useSolanaRpc();

  const sendTransaction = useCallback(
    async (instructions: IInstruction[]): Promise<string> => {
      const wallet = wallets[0];
      if (!wallet) throw new Error('No wallet connected');

      const feePayer = wallet.address as Address;

      const { value: latestBlockhash } = await rpc
        .getLatestBlockhash({ commitment: 'confirmed' })
        .send();

      const message = pipe(
        createTransactionMessage({ version: 0 }),
        (msg) => setTransactionMessageFeePayer(feePayer, msg),
        (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
        (msg) => appendTransactionMessageInstructions(instructions, msg),
      );

      const compiled = compileTransaction(message);
      const encodedTx = getBase64EncodedWireTransaction(compiled);
      const txBytes = Uint8Array.from(atob(encodedTx), (c) => c.charCodeAt(0));

      // Use Privy's standard sign-and-send (works with all wallets: Phantom, Backpack, etc.)
      const { signature } = await signAndSendTransaction({
        transaction: txBytes,
        wallet,
      });

      // Convert Uint8Array signature to base58 string
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

      return base58;
    },
    [wallets, signAndSendTransaction, rpc],
  );

  return { sendTransaction };
}
