use anchor_lang::prelude::*;

use crate::auth::assert_current_soul_owner;
use crate::constants::*;
use crate::errors::AgentsHausError;
use crate::state::AgentState;

#[derive(Accounts)]
pub struct UpdateExecutor<'info> {
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

pub fn handler(ctx: Context<UpdateExecutor>, new_executor: Pubkey) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    assert_current_soul_owner(
        &ctx.accounts.soul_asset.to_account_info(),
        &ctx.accounts.agent_state.soul_mint,
        &owner,
    )?;

    let agent_state = &mut ctx.accounts.agent_state;
    agent_state.owner = owner;
    agent_state.executor = new_executor;
    agent_state.last_activity = Clock::get()?.unix_timestamp;

    msg!("Executor updated to: {}", new_executor);

    Ok(())
}
