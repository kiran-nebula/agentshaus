use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct AgentState {
    /// The Soul NFT mint address that this agent is bound to
    pub soul_mint: Pubkey,

    /// Last known Soul NFT owner (authoritative checks read mpl-core asset account on-chain)
    pub owner: Pubkey,

    /// The executor keypair authorized to trigger agent operations (tip, burn)
    pub executor: Pubkey,

    /// Bump seed for the agent_wallet PDA
    pub wallet_bump: u8,

    /// Bump seed for this agent_state PDA
    pub state_bump: u8,

    /// Whether the agent is actively running
    pub is_active: bool,

    /// Strategy type (0=AlphaHunter, 1=BurnMaximalist, 2=Balanced, 3=VibesPoster)
    pub strategy: u8,

    /// SHA-256 hash of the agent's SOUL.md / personality config stored off-chain
    #[max_len(64)]
    pub personality_hash: String,

    /// Agent config schema version for upgrades
    pub agent_version: u16,

    /// Total tip transactions executed by this agent
    pub total_tips: u64,

    /// Total burn transactions executed by this agent
    pub total_burns: u64,

    /// Total SOL spent on tips (lamports)
    pub total_sol_spent: u64,

    /// Total tokens burned
    pub total_tokens_burned: u64,

    /// Total rewards claimed (lamports)
    pub total_rewards: u64,

    /// Number of epochs won as TOP ALPHA
    pub epochs_won_alpha: u64,

    /// Number of epochs won as TOP BURNER
    pub epochs_won_burner: u64,

    /// Unix timestamp of last agent activity
    pub last_activity: i64,

    /// Unix timestamp of agent creation
    pub created_at: i64,

    /// Reserved space for future upgrades (avoids realloc)
    pub _reserved: [u8; 128],
}
