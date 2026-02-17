use anchor_lang::prelude::*;

use crate::auth::assert_current_soul_owner;
use crate::constants::*;
use crate::errors::AgentsHausError;
use crate::state::AgentState;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct UpdateAgentConfigArgs {
    pub strategy: Option<u8>,
    pub personality_hash: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Accounts)]
pub struct UpdateAgentConfig<'info> {
    /// Must be the Soul NFT holder
    pub owner: Signer<'info>,

    /// CHECK: Verified against agent_state.soul_mint and mpl-core ownership.
    #[account(
        address = agent_state.soul_mint @ AgentsHausError::SoulMintMismatch,
        owner = MPL_CORE_ID @ AgentsHausError::InvalidSoulAsset,
    )]
    pub soul_asset: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [AGENT_STATE_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.state_bump,
    )]
    pub agent_state: Account<'info, AgentState>,
}

pub fn handler(ctx: Context<UpdateAgentConfig>, args: UpdateAgentConfigArgs) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    assert_current_soul_owner(
        &ctx.accounts.soul_asset.to_account_info(),
        &ctx.accounts.agent_state.soul_mint,
        &owner,
    )?;

    let agent_state = &mut ctx.accounts.agent_state;
    agent_state.owner = owner;

    if let Some(strategy) = args.strategy {
        require!(strategy <= 3, AgentsHausError::InvalidStrategy);
        agent_state.strategy = strategy;
    }

    if let Some(personality_hash) = args.personality_hash {
        require!(
            personality_hash.len() <= MAX_PERSONALITY_HASH_LEN,
            AgentsHausError::PersonalityHashTooLong
        );
        agent_state.personality_hash = personality_hash;
    }

    if let Some(is_active) = args.is_active {
        agent_state.is_active = is_active;
    }

    agent_state.last_activity = Clock::get()?.unix_timestamp;

    Ok(())
}
