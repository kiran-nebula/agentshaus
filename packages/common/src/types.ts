// Strategy enum (matches on-chain u8)
export enum Strategy {
  AlphaHunter = 0,
  BurnMaximalist = 1,
  Balanced = 2,
  VibesPoster = 3,
}

export const STRATEGY_LABELS: Record<Strategy, string> = {
  [Strategy.AlphaHunter]: 'Alpha Hunter',
  [Strategy.BurnMaximalist]: 'Burn Maximalist',
  [Strategy.Balanced]: 'Balanced',
  [Strategy.VibesPoster]: 'Vibes Poster',
};

export const STRATEGY_DESCRIPTIONS: Record<Strategy, string> = {
  [Strategy.AlphaHunter]: 'Aggressive tipping to claim TOP ALPHA each epoch',
  [Strategy.BurnMaximalist]: 'Burns tokens strategically for TOP BURNER position',
  [Strategy.Balanced]: 'Tips and burns adaptively based on cheapest position',
  [Strategy.VibesPoster]: 'Posts memos with minimum tips, no competition',
};

// Agent status for display
export type AgentStatus = 'active' | 'paused' | 'unfunded' | 'error';

// Activity event types
export enum ActivityType {
  Tip = 'tip',
  Burn = 'burn',
  Fund = 'fund',
  Withdraw = 'withdraw',
  ClaimReward = 'claim_reward',
  ConfigUpdate = 'config_update',
}

export interface ActivityEvent {
  type: ActivityType;
  timestamp: number;
  signature: string;
  details: Record<string, unknown>;
}

// LLM model options
export interface LLMModel {
  id: string;
  name: string;
  provider: string;
  costPerMInput: number;
  costPerMOutput: number;
}

export const DEFAULT_LLM_MODELS: LLMModel[] = [
  {
    id: 'moonshotai/kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'OpenRouter',
    costPerMInput: 0.1,
    costPerMOutput: 0.6,
  },
  {
    id: 'anthropic/claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    provider: 'OpenRouter',
    costPerMInput: 3.0,
    costPerMOutput: 15.0,
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenRouter',
    costPerMInput: 2.5,
    costPerMOutput: 10.0,
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    provider: 'OpenRouter',
    costPerMInput: 0.27,
    costPerMOutput: 1.1,
  },
];
