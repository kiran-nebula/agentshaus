import type { Address } from '@solana/kit';

// Program IDs
export const PROGRAM_ID = 'BWFsJXqoXKg53yu3VxYV9YgmvTc9BZxto4CGJqYn8aWM' as Address;
export const ALPHA_HAUS_PROGRAM_ID =
  'A1PhATY12DpvpHGfGosxuruc7gqkcUUt9eFihb996rNn' as Address;
export const MPL_CORE_PROGRAM_ID =
  'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d' as Address;
export const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' as Address;
export const TOKEN_2022_PROGRAM_ID =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' as Address;

// alpha.haus token mints
export const ALPHA_SOL_MINT = 'A1PHaeFxsDX6Un1g1UpWYR2MDV5vvsv2g4Mi6sNGC5cb' as Address;
export const WSOL_MINT = 'So11111111111111111111111111111111111111112' as Address;

// PDA Seeds
export const AGENT_WALLET_SEED = new TextEncoder().encode('agent_wallet');
export const AGENT_STATE_SEED = new TextEncoder().encode('agent_state');

// alpha.haus specifics
export const EPOCH_STATUS_DISCRIMINATOR = new Uint8Array([53, 208, 49, 235, 139, 1, 230, 180]);
export const MAX_MEMO_LENGTH = 560;
export const TIP_FLIP_LAMPORTS = 1_000_000n; // 0.001 SOL
export const BURN_FLIP_TOKENS = 1_000_000n; // 1 token (6 decimals)
export const TOKEN_DECIMALS = 6;

// Solana constants
export const LAMPORTS_PER_SOL = 1_000_000_000n;
