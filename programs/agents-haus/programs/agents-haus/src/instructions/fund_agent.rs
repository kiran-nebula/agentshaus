use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::state::AgentState;

#[derive(Accounts)]
pub struct FundAgent<'info> {
    /// Anyone can fund an agent's wallet
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        seeds = [AGENT_STATE_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.state_bump,
    )]
    pub agent_state: Account<'info, AgentState>,

    /// CHECK: Agent wallet PDA, validated by seeds
    #[account(
        mut,
        seeds = [AGENT_WALLET_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.wallet_bump,
    )]
    pub agent_wallet: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<FundAgent>, amount: u64) -> Result<()> {
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.funder.to_account_info(),
                to: ctx.accounts.agent_wallet.to_account_info(),
            },
        ),
        amount,
    )?;

    msg!(
        "Funded agent wallet {} with {} lamports",
        ctx.accounts.agent_wallet.key(),
        amount
    );

    Ok(())
}
