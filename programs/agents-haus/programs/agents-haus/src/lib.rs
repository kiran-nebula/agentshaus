use anchor_lang::prelude::*;

declare_id!("BWFsJXqoXKg53yu3VxYV9YgmvTc9BZxto4CGJqYn8aWM");

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod auth;

use instructions::*;

#[program]
pub mod agents_haus {
    use super::*;

    /// Create a new agent: mints a Soul NFT via Metaplex Core CPI,
    /// initializes the agent_state PDA, and derives the agent_wallet PDA.
    pub fn create_agent(ctx: Context<CreateAgent>, args: CreateAgentArgs) -> Result<()> {
        instructions::create_agent::handler(ctx, args)
    }

    /// Update the agent's configuration (strategy, personality hash, active status).
    /// Only the Soul NFT holder (owner) can call this.
    pub fn update_agent_config(
        ctx: Context<UpdateAgentConfig>,
        args: UpdateAgentConfigArgs,
    ) -> Result<()> {
        instructions::update_agent_config::handler(ctx, args)
    }

    /// Change which executor keypair is authorized to trigger agent operations.
    /// Only the Soul NFT holder (owner) can call this.
    pub fn update_executor(ctx: Context<UpdateExecutor>, new_executor: Pubkey) -> Result<()> {
        instructions::update_executor::handler(ctx, new_executor)
    }

    /// Transfer SOL from any wallet to the agent's wallet PDA.
    /// Anyone can fund an agent.
    pub fn fund_agent(ctx: Context<FundAgent>, amount: u64) -> Result<()> {
        instructions::fund_agent::handler(ctx, amount)
    }

    /// Withdraw SOL from the agent's wallet PDA back to the owner.
    /// Only the Soul NFT holder (owner) can call this.
    pub fn withdraw_from_agent(ctx: Context<WithdrawFromAgent>, amount: u64) -> Result<()> {
        instructions::withdraw_from_agent::handler(ctx, amount)
    }

    /// Execute a tip on alpha.haus via CPI. The agent_wallet PDA is the tipper
    /// (signed via invoke_signed). Only the registered executor can trigger this.
    pub fn agent_tip(ctx: Context<AgentTip>, args: AgentTipArgs) -> Result<()> {
        instructions::agent_tip::handler(ctx, args)
    }

    /// Execute a token burn on alpha.haus via CPI. Uses Token-2022 program.
    /// Only the registered executor can trigger this.
    pub fn agent_burn(ctx: Context<AgentBurn>, args: AgentBurnArgs) -> Result<()> {
        instructions::agent_burn::handler(ctx, args)
    }

    /// Claim epoch rewards to the agent's wallet PDA.
    /// Can be called by the owner or executor.
    pub fn claim_rewards(ctx: Context<ClaimRewards>, epoch: u64) -> Result<()> {
        instructions::claim_rewards::handler(ctx, epoch)
    }
}
