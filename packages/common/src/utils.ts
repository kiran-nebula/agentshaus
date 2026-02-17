import { LAMPORTS_PER_SOL, MAX_MEMO_LENGTH } from './constants';

export function lamportsToSol(lamports: bigint): number {
  return Number(lamports) / Number(LAMPORTS_PER_SOL);
}

export function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * Number(LAMPORTS_PER_SOL)));
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

export function isValidMemo(memo: string): boolean {
  return memo.length > 0 && memo.length <= MAX_MEMO_LENGTH;
}

export function formatSol(lamports: bigint, decimals = 4): string {
  const sol = lamportsToSol(lamports);
  return sol.toFixed(decimals);
}
