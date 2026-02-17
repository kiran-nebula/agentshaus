use anchor_lang::prelude::*;
use anchor_lang::solana_program;

use crate::auth::assert_current_soul_owner;
use crate::constants::*;
use crate::errors::AgentsHausError;
use crate::state::AgentState;

#[derive(Accounts)]
pub struct ClaimRewards<'info> {
    /// Can be owner or executor
    #[account(mut)]
    pub caller: Signer<'info>,

    /// CHECK: Verified against agent_state.soul_mint and mpl-core ownership when caller is not executor.
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

    /// CHECK: Agent wallet PDA — signed via invoke_signed for CPI
    #[account(
        mut,
        seeds = [AGENT_WALLET_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.wallet_bump,
    )]
    pub agent_wallet: SystemAccount<'info>,

    /// CHECK: alpha.haus epoch_status PDA for the epoch being claimed
    #[account(mut)]
    pub epoch_status: UncheckedAccount<'info>,

    /// CHECK: alpha.haus was_alpha_tipper PDA (proves agent participated as tipper)
    #[account(mut)]
    pub was_alpha_tipper: UncheckedAccount<'info>,

    /// CHECK: alpha.haus was_top_burner PDA (proves agent participated as burner)
    #[account(mut)]
    pub was_top_burner: UncheckedAccount<'info>,

    /// CHECK: alpha.haus program for claim CPI
    pub alpha_haus_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimRewards>, epoch: u64) -> Result<()> {
    let caller = ctx.accounts.caller.key();
    let caller_is_executor = caller == ctx.accounts.agent_state.executor;
    if !caller_is_executor {
        assert_current_soul_owner(
            &ctx.accounts.soul_asset.to_account_info(),
            &ctx.accounts.agent_state.soul_mint,
            &caller,
        )?;
    }

    // Record wallet balance before claim to calculate rewards received
    let balance_before = ctx.accounts.agent_wallet.lamports();

    // Build alpha.haus claim instruction data (Borsh serialized)
    let mut data = Vec::new();
    data.extend_from_slice(&ALPHA_CLAIM_DISCRIMINATOR);
    data.extend_from_slice(&epoch.to_le_bytes());

    // Build account metas for alpha.haus claim
    let account_metas = vec![
        AccountMeta::new(ctx.accounts.agent_wallet.key(), true), // claimant (signer)
        AccountMeta::new(ctx.accounts.epoch_status.key(), false),
        AccountMeta::new(ctx.accounts.was_alpha_tipper.key(), false),
        AccountMeta::new(ctx.accounts.was_top_burner.key(), false),
        AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
    ];

    let ix = solana_program::instruction::Instruction {
        program_id: ALPHA_HAUS_PROGRAM_ID,
        accounts: account_metas,
        data,
    };

    // CPI with agent_wallet PDA as signer
    let soul_mint = ctx.accounts.agent_state.soul_mint;
    let wallet_bump = ctx.accounts.agent_state.wallet_bump;
    let seeds: &[&[u8]] = &[AGENT_WALLET_SEED, soul_mint.as_ref(), &[wallet_bump]];
    let signer_seeds = &[seeds];

    let account_infos = &[
        ctx.accounts.agent_wallet.to_account_info(),
        ctx.accounts.epoch_status.to_account_info(),
        ctx.accounts.was_alpha_tipper.to_account_info(),
        ctx.accounts.was_top_burner.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.alpha_haus_program.to_account_info(),
    ];

    solana_program::program::invoke_signed(&ix, account_infos, signer_seeds)?;

    // Calculate rewards received by comparing balance change
    let balance_after = ctx.accounts.agent_wallet.to_account_info().lamports();
    let rewards_received = balance_after
        .checked_sub(balance_before)
        .unwrap_or(0);

    // Update stats
    let agent_state = &mut ctx.accounts.agent_state;
    if !caller_is_executor {
        agent_state.owner = caller;
    }
    agent_state.total_rewards = agent_state
        .total_rewards
        .checked_add(rewards_received)
        .ok_or(AgentsHausError::NumericalOverflow)?;
    agent_state.last_activity = Clock::get()?.unix_timestamp;

    msg!(
        "Claimed {} lamports in rewards for epoch {}",
        rewards_received,
        epoch
    );

    Ok(())
}
