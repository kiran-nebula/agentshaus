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
import { useSolanaWallets } from '@privy-io/react-auth';
import { useSolanaRpc } from './use-solana-rpc';

export function useSendTransaction() {
  const { wallets } = useSolanaWallets();
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

      // Use Privy's signAndSendTransaction
      const provider = await wallet.getProvider();
      const { signature } = await (provider as any).signAndSendTransaction(
        Buffer.from(encodedTx, 'base64'),
      );

      return signature;
    },
    [wallets, rpc],
  );

  return { sendTransaction };
}
