use anchor_lang::prelude::*;
use mpl_core::instructions::CreateV2CpiBuilder;
use mpl_core::types::{
    Attribute, Attributes, DataState, Plugin, PluginAuthority, PluginAuthorityPair,
};
use mpl_core::ID as MPL_CORE_ID;

use crate::constants::*;
use crate::errors::AgentsHausError;
use crate::state::AgentState;

#[derive(AnchorDeserialize, AnchorSerialize)]
pub struct CreateAgentArgs {
    pub name: String,
    pub uri: String,
    pub personality_hash: String,
    pub strategy: u8,
}

#[derive(Accounts)]
#[instruction(args: CreateAgentArgs)]
pub struct CreateAgent<'info> {
    /// The owner who is creating and paying for the agent
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The Soul NFT asset account (must be a new keypair generated client-side)
    #[account(mut)]
    pub soul_asset: Signer<'info>,

    /// Agent state PDA — program-owned, stores agent configuration
    #[account(
        init,
        payer = owner,
        space = 8 + AgentState::INIT_SPACE,
        seeds = [AGENT_STATE_SEED, soul_asset.key().as_ref()],
        bump,
    )]
    pub agent_state: Account<'info, AgentState>,

    /// Agent wallet PDA — system-owned, holds SOL for tips
    /// CHECK: Validated by PDA seeds; this is a system-owned account that only holds lamports
    #[account(
        seeds = [AGENT_WALLET_SEED, soul_asset.key().as_ref()],
        bump,
    )]
    pub agent_wallet: SystemAccount<'info>,

    /// The executor keypair address (stored in agent_state, no data read here)
    /// CHECK: Just stored as a pubkey reference
    pub executor: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Metaplex Core program for NFT minting CPI
    #[account(address = MPL_CORE_ID)]
    pub mpl_core_program: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<CreateAgent>, args: CreateAgentArgs) -> Result<()> {
    require!(args.strategy <= 3, AgentsHausError::InvalidStrategy);
    require!(
        args.personality_hash.len() <= MAX_PERSONALITY_HASH_LEN,
        AgentsHausError::PersonalityHashTooLong
    );

    let agent_state = &mut ctx.accounts.agent_state;

    // Initialize agent state
    agent_state.soul_mint = ctx.accounts.soul_asset.key();
    agent_state.owner = ctx.accounts.owner.key();
    agent_state.executor = ctx.accounts.executor.key();
    agent_state.wallet_bump = ctx.bumps.agent_wallet;
    agent_state.state_bump = ctx.bumps.agent_state;
    agent_state.is_active = true;
    agent_state.strategy = args.strategy;
    agent_state.personality_hash = args.personality_hash.clone();
    agent_state.agent_version = 1;
    agent_state.total_tips = 0;
    agent_state.total_burns = 0;
    agent_state.total_sol_spent = 0;
    agent_state.total_tokens_burned = 0;
    agent_state.total_rewards = 0;
    agent_state.epochs_won_alpha = 0;
    agent_state.epochs_won_burner = 0;
    agent_state.last_activity = Clock::get()?.unix_timestamp;
    agent_state.created_at = Clock::get()?.unix_timestamp;
    agent_state._reserved = [0u8; 128];

    // Mint Soul NFT via Metaplex Core CPI
    CreateV2CpiBuilder::new(&ctx.accounts.mpl_core_program)
        .asset(&ctx.accounts.soul_asset)
        .payer(&ctx.accounts.owner)
        .owner(Some(&ctx.accounts.owner))
        .system_program(&ctx.accounts.system_program)
        .data_state(DataState::AccountState)
        .name(args.name)
        .uri(args.uri)
        .plugins(vec![PluginAuthorityPair {
            plugin: Plugin::Attributes(Attributes {
                attribute_list: vec![
                    Attribute {
                        key: "soul_id".to_string(),
                        value: ctx.accounts.soul_asset.key().to_string(),
                    },
                    Attribute {
                        key: "policy_hash".to_string(),
                        value: args.personality_hash,
                    },
                    Attribute {
                        key: "agent_version".to_string(),
                        value: "1".to_string(),
                    },
                ],
            }),
            authority: Some(PluginAuthority::UpdateAuthority),
        }])
        .invoke()?;

    msg!("Agent created: {}", ctx.accounts.soul_asset.key());

    Ok(())
}
