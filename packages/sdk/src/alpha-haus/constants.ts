import type { Address } from '@solana/kit';

export const ALPHA_HAUS_PROGRAM_ID =
  'A1PhATY12DpvpHGfGosxuruc7gqkcUUt9eFihb996rNn' as Address;

export const EPOCH_STATUS_DISCRIMINATOR = new Uint8Array([53, 208, 49, 235, 139, 1, 230, 180]);

// alpha.haus PDA seed prefixes
export const ALPHA_SEED = new TextEncoder().encode('alpha');
export const TOP_BURNER_SEED = new TextEncoder().encode('top_burner');
export const TIP_SEED = new TextEncoder().encode('tip');
export const WAS_ALPHA_TIPPER_SEED = new TextEncoder().encode('was_alpha_tipper');
export const WAS_TOP_BURNER_SEED = new TextEncoder().encode('was_top_burner');
export const GLOBAL_CONFIG_SEED = new TextEncoder().encode('global_config');
export const PROTOCOL_VAULT_SEED = new TextEncoder().encode('protocol_vault');

// Constraints
export const MAX_MEMO_LENGTH = 560;
export const TIP_FLIP_SOL = 0.001;
export const BURN_FLIP_TOKENS = 1;

// Alpha account layout offsets
export const ALPHA_DISCRIMINATOR_SIZE = 8;
export const ALPHA_EPOCH_STATUS_OFFSET = 8;
export const ALPHA_WALLET_OFFSET = 9;
export const ALPHA_ACCOUNT_SIZE = 629;

// TopBurner account layout offsets
export const TOP_BURNER_WALLET_OFFSET = 8;
export const TOP_BURNER_EPOCH_OFFSET = 40;
export const TOP_BURNER_AMOUNT_OFFSET = 48;
export const TOP_BURNER_ACCOUNT_SIZE = 629;
