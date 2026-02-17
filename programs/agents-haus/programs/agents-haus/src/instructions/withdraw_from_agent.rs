use anchor_lang::prelude::*;

use crate::auth::assert_current_soul_owner;
use crate::constants::*;
use crate::errors::AgentsHausError;
use crate::state::AgentState;

#[derive(Accounts)]
pub struct WithdrawFromAgent<'info> {
    /// Must be the Soul NFT holder
    #[account(mut)]
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

    /// CHECK: Agent wallet PDA, validated by seeds. SOL is transferred out via invoke_signed.
    #[account(
        mut,
        seeds = [AGENT_WALLET_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.wallet_bump,
    )]
    pub agent_wallet: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<WithdrawFromAgent>, amount: u64) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    assert_current_soul_owner(
        &ctx.accounts.soul_asset.to_account_info(),
        &ctx.accounts.agent_state.soul_mint,
        &owner,
    )?;

    let agent_wallet = &ctx.accounts.agent_wallet;

    require!(
        agent_wallet.lamports() >= amount,
        AgentsHausError::InsufficientFunds
    );

    // Transfer SOL from agent_wallet PDA to owner using invoke_signed
    let soul_mint = ctx.accounts.agent_state.soul_mint;
    let seeds = &[
        AGENT_WALLET_SEED,
        soul_mint.as_ref(),
        &[ctx.accounts.agent_state.wallet_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.agent_wallet.to_account_info(),
                to: ctx.accounts.owner.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    let agent_state = &mut ctx.accounts.agent_state;
    agent_state.owner = owner;
    agent_state.last_activity = Clock::get()?.unix_timestamp;

    msg!("Withdrew {} lamports from agent wallet", amount);

    Ok(())
}
