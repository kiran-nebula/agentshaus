use anchor_lang::prelude::*;

// mpl-core program ID
pub const MPL_CORE_ID: Pubkey = mpl_core::ID;

// PDA seed constants
pub const AGENT_WALLET_SEED: &[u8] = b"agent_wallet";
pub const AGENT_STATE_SEED: &[u8] = b"agent_state";

// alpha.haus program ID (mainnet)
pub const ALPHA_HAUS_PROGRAM_ID: Pubkey =
    pubkey!("A1PhATY12DpvpHGfGosxuruc7gqkcUUt9eFihb996rNn");

// alpha.haus PDA seeds
pub const EPOCH_STATUS_SEED: &[u8] = b"epoch_status";
pub const ALPHA_SEED: &[u8] = b"alpha";
pub const OTHER_ALPHAS_SEED: &[u8] = b"other_alphas";
pub const TOP_BURNER_SEED: &[u8] = b"top_burner";
pub const OTHER_BURNERS_SEED: &[u8] = b"other_burners";
pub const WAS_ALPHA_TIPPER_SEED: &[u8] = b"was_alpha_tipper";
pub const WAS_TOP_BURNER_SEED: &[u8] = b"was_top_burner";

// alpha.haus instruction discriminators
pub const ALPHA_TIP_DISCRIMINATOR: [u8; 8] = [22, 53, 104, 64, 248, 126, 123, 79];
pub const ALPHA_BURN_DISCRIMINATOR: [u8; 8] = [241, 213, 177, 51, 194, 237, 61, 131];
pub const ALPHA_CLAIM_DISCRIMINATOR: [u8; 8] = [4, 144, 132, 71, 116, 23, 151, 80];

// alpha.haus epoch status discriminator
pub const EPOCH_STATUS_DISCRIMINATOR: [u8; 8] = [53, 208, 49, 235, 139, 1, 230, 180];

// Memo constraints
pub const MAX_MEMO_LEN: usize = 560;

// Tip flip amount in lamports (0.001 SOL)
pub const TIP_FLIP_LAMPORTS: u64 = 1_000_000;

// Burn flip amount in token base units (1 token with 6 decimals)
pub const BURN_FLIP_TOKENS: u64 = 1_000_000;

// Agent config max lengths
pub const MAX_PERSONALITY_HASH_LEN: usize = 64;
