use anchor_lang::prelude::*;
use anchor_lang::solana_program;

use crate::constants::*;
use crate::errors::AgentsHausError;
use crate::state::AgentState;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct AgentTipArgs {
    pub epoch: u64,
    pub uuid: String,
    pub amount: u64,
    pub memo: String,
    pub tagged_addresses: Vec<Pubkey>,
}

#[derive(Accounts)]
pub struct AgentTip<'info> {
    /// The executor keypair authorized to trigger agent operations
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [AGENT_STATE_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.state_bump,
        has_one = executor @ AgentsHausError::UnauthorizedExecutor,
    )]
    pub agent_state: Account<'info, AgentState>,

    /// CHECK: Agent wallet PDA acts as the tipper on alpha.haus.
    /// Signed via invoke_signed during CPI.
    #[account(
        mut,
        seeds = [AGENT_WALLET_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.wallet_bump,
    )]
    pub agent_wallet: SystemAccount<'info>,

    // --- alpha.haus tip accounts (6 in exact order) ---

    /// CHECK: alpha.haus epoch_status PDA
    #[account(mut)]
    pub epoch_status: UncheckedAccount<'info>,

    /// CHECK: alpha.haus alpha PDA for this epoch
    #[account(mut)]
    pub alpha: UncheckedAccount<'info>,

    /// CHECK: alpha.haus other_alphas_info PDA
    #[account(mut)]
    pub other_alphas: UncheckedAccount<'info>,

    /// CHECK: alpha.haus was_alpha_tipper PDA for this agent's wallet (epoch, wallet seed order)
    #[account(mut)]
    pub was_alpha_tipper: UncheckedAccount<'info>,

    /// CHECK: alpha.haus program
    pub alpha_haus_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AgentTip>, args: AgentTipArgs) -> Result<()> {
    require!(args.memo.len() <= MAX_MEMO_LEN, AgentsHausError::MemoTooLong);
    require!(
        ctx.accounts.agent_state.is_active,
        AgentsHausError::AgentPaused
    );

    let agent_wallet = &ctx.accounts.agent_wallet;
    require!(
        agent_wallet.lamports() >= args.amount,
        AgentsHausError::InsufficientFunds
    );

    // Build alpha.haus tip instruction data (Borsh serialized)
    let mut data = Vec::new();
    data.extend_from_slice(&ALPHA_TIP_DISCRIMINATOR);
    data.extend_from_slice(&args.epoch.to_le_bytes());
    // Borsh string: 4-byte LE length prefix + UTF-8 bytes
    data.extend_from_slice(&(args.uuid.len() as u32).to_le_bytes());
    data.extend_from_slice(args.uuid.as_bytes());
    data.extend_from_slice(&args.amount.to_le_bytes());
    data.extend_from_slice(&(args.memo.len() as u32).to_le_bytes());
    data.extend_from_slice(args.memo.as_bytes());
    // Vec<Pubkey>: 4-byte LE count + N * 32 bytes
    data.extend_from_slice(&(args.tagged_addresses.len() as u32).to_le_bytes());
    for addr in &args.tagged_addresses {
        data.extend_from_slice(addr.as_ref());
    }

    // Build account metas for alpha.haus tip (6 accounts)
    let account_metas = vec![
        AccountMeta::new(ctx.accounts.agent_wallet.key(), true),
        AccountMeta::new(ctx.accounts.epoch_status.key(), false),
        AccountMeta::new(ctx.accounts.alpha.key(), false),
        AccountMeta::new(ctx.accounts.other_alphas.key(), false),
        AccountMeta::new(ctx.accounts.was_alpha_tipper.key(), false),
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
        ctx.accounts.alpha.to_account_info(),
        ctx.accounts.other_alphas.to_account_info(),
        ctx.accounts.was_alpha_tipper.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.alpha_haus_program.to_account_info(),
    ];

    solana_program::program::invoke_signed(&ix, account_infos, signer_seeds)?;

    // Update stats
    let agent_state = &mut ctx.accounts.agent_state;
    agent_state.total_tips = agent_state
        .total_tips
        .checked_add(1)
        .ok_or(AgentsHausError::NumericalOverflow)?;
    agent_state.total_sol_spent = agent_state
        .total_sol_spent
        .checked_add(args.amount)
        .ok_or(AgentsHausError::NumericalOverflow)?;
    agent_state.last_activity = Clock::get()?.unix_timestamp;

    msg!("Agent tipped {} lamports on epoch {}", args.amount, args.epoch);

    Ok(())
}
