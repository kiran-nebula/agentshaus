use anchor_lang::prelude::*;
use anchor_lang::solana_program;

use crate::constants::*;
use crate::errors::AgentsHausError;
use crate::state::AgentState;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct AgentBurnArgs {
    pub curr_epoch: u64,
    pub burn_epoch: u64,
    pub burn_amount: u64,
    pub memo: String,
    pub tagged_addresses: Vec<Pubkey>,
}

#[derive(Accounts)]
pub struct AgentBurn<'info> {
    /// The executor keypair
    pub executor: Signer<'info>,

    #[account(
        mut,
        seeds = [AGENT_STATE_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.state_bump,
        has_one = executor @ AgentsHausError::UnauthorizedExecutor,
    )]
    pub agent_state: Account<'info, AgentState>,

    /// CHECK: Agent wallet PDA — signed via invoke_signed for CPI
    #[account(
        mut,
        seeds = [AGENT_WALLET_SEED, agent_state.soul_mint.as_ref()],
        bump = agent_state.wallet_bump,
    )]
    pub agent_wallet: SystemAccount<'info>,

    // --- alpha.haus burn accounts (9 in exact order) ---

    /// CHECK: alpha.haus epoch_status PDA
    #[account(mut)]
    pub epoch_status: UncheckedAccount<'info>,

    /// CHECK: alpha.haus top_burner PDA
    #[account(mut)]
    pub top_burner: UncheckedAccount<'info>,

    /// CHECK: alpha.haus other_burners_info PDA
    #[account(mut)]
    pub other_burners: UncheckedAccount<'info>,

    /// CHECK: Agent's token account (Token-2022 compatible)
    #[account(mut)]
    pub agent_token_account: UncheckedAccount<'info>,

    /// CHECK: Token mint for the epoch tokens being burned (writable for Token-2022 burn)
    #[account(mut)]
    pub token_mint: UncheckedAccount<'info>,

    /// CHECK: alpha.haus was_top_burner PDA for this agent's wallet (epoch, wallet seed order)
    #[account(mut)]
    pub was_top_burner: UncheckedAccount<'info>,

    /// CHECK: alpha.haus program
    pub alpha_haus_program: UncheckedAccount<'info>,

    /// CHECK: Token-2022 program (NOT standard Token program)
    pub token_2022_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AgentBurn>, args: AgentBurnArgs) -> Result<()> {
    require!(args.memo.len() <= MAX_MEMO_LEN, AgentsHausError::MemoTooLong);
    require!(
        ctx.accounts.agent_state.is_active,
        AgentsHausError::AgentPaused
    );

    // Build alpha.haus burn instruction data (Borsh serialized)
    let mut data = Vec::new();
    data.extend_from_slice(&ALPHA_BURN_DISCRIMINATOR);
    data.extend_from_slice(&args.curr_epoch.to_le_bytes());
    data.extend_from_slice(&args.burn_epoch.to_le_bytes());
    data.extend_from_slice(&args.burn_amount.to_le_bytes());
    // Borsh string: 4-byte LE length prefix + UTF-8 bytes
    data.extend_from_slice(&(args.memo.len() as u32).to_le_bytes());
    data.extend_from_slice(args.memo.as_bytes());
    // Vec<Pubkey>: 4-byte LE count + N * 32 bytes
    data.extend_from_slice(&(args.tagged_addresses.len() as u32).to_le_bytes());
    for addr in &args.tagged_addresses {
        data.extend_from_slice(addr.as_ref());
    }

    // Build account metas for alpha.haus burn (9 accounts)
    let account_metas = vec![
        AccountMeta::new(ctx.accounts.epoch_status.key(), false),
        AccountMeta::new(ctx.accounts.top_burner.key(), false),
        AccountMeta::new(ctx.accounts.other_burners.key(), false),
        AccountMeta::new(ctx.accounts.agent_token_account.key(), false),
        AccountMeta::new(ctx.accounts.token_mint.key(), false),
        AccountMeta::new(ctx.accounts.was_top_burner.key(), false),
        AccountMeta::new(ctx.accounts.agent_wallet.key(), true), // signer
        AccountMeta::new_readonly(ctx.accounts.token_2022_program.key(), false),
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
        ctx.accounts.epoch_status.to_account_info(),
        ctx.accounts.top_burner.to_account_info(),
        ctx.accounts.other_burners.to_account_info(),
        ctx.accounts.agent_token_account.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.was_top_burner.to_account_info(),
        ctx.accounts.agent_wallet.to_account_info(),
        ctx.accounts.token_2022_program.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.alpha_haus_program.to_account_info(),
    ];

    solana_program::program::invoke_signed(&ix, account_infos, signer_seeds)?;

    // Update stats
    let agent_state = &mut ctx.accounts.agent_state;
    agent_state.total_burns = agent_state
        .total_burns
        .checked_add(1)
        .ok_or(AgentsHausError::NumericalOverflow)?;
    agent_state.total_tokens_burned = agent_state
        .total_tokens_burned
        .checked_add(args.burn_amount)
        .ok_or(AgentsHausError::NumericalOverflow)?;
    agent_state.last_activity = Clock::get()?.unix_timestamp;

    msg!(
        "Agent burned {} tokens for epoch {}",
        args.burn_amount,
        args.burn_epoch
    );

    Ok(())
}
