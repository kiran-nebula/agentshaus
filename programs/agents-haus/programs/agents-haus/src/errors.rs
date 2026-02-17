use anchor_lang::prelude::*;

#[error_code]
pub enum AgentsHausError {
    #[msg("Unauthorized: caller does not hold the Soul NFT")]
    Unauthorized,

    #[msg("Unauthorized: caller is not the registered executor")]
    UnauthorizedExecutor,

    #[msg("Insufficient SOL in agent wallet")]
    InsufficientFunds,

    #[msg("Memo exceeds maximum length of 560 characters")]
    MemoTooLong,

    #[msg("Personality hash exceeds maximum length of 64 characters")]
    PersonalityHashTooLong,

    #[msg("Invalid strategy value")]
    InvalidStrategy,

    #[msg("Agent is currently paused")]
    AgentPaused,

    #[msg("Invalid epoch status account")]
    InvalidEpochStatus,

    #[msg("Soul NFT mint mismatch")]
    SoulMintMismatch,

    #[msg("Invalid Soul NFT asset account")]
    InvalidSoulAsset,

    #[msg("Numerical overflow")]
    NumericalOverflow,

    #[msg("Agent wallet PDA mismatch")]
    WalletMismatch,

    #[msg("Insufficient token balance for burn")]
    InsufficientTokens,
}
