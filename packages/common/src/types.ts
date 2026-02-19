import { SOLANA_SKILL_PACKS } from './solana-skills';

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

export type FlavorCategory = 'alpha' | 'general';

export type FlavorProfileId =
  | 'alpha-hunter'
  | 'burn-maximalist'
  | 'balanced'
  | 'vibes-poster'
  | 'dca-bot'
  | 'x-posting-bot';

export type CoreAgentSkillId = 'alpha-haus' | 'dca-planner' | 'x-posting' | 'grok-writer';
export type AgentSkillId = CoreAgentSkillId | `sendaifun:${string}`;

export const AGENT_SKILL_LABELS: Record<CoreAgentSkillId, string> = {
  'alpha-haus': 'Alpha Haus',
  'dca-planner': 'DCA Planner',
  'x-posting': 'X Posting',
  'grok-writer': 'Grok Writer',
};

const SOLANA_SKILL_LABELS = new Map(
  SOLANA_SKILL_PACKS.map((skill) => [skill.id, skill.name] as const),
);

export function isCoreAgentSkill(skillId: string): skillId is CoreAgentSkillId {
  return skillId in AGENT_SKILL_LABELS;
}

export function getAgentSkillLabel(skillId: string): string {
  if (isCoreAgentSkill(skillId)) {
    return AGENT_SKILL_LABELS[skillId];
  }

  const fromCatalog = SOLANA_SKILL_LABELS.get(skillId);
  if (fromCatalog) {
    return fromCatalog;
  }

  return skillId
    .replace(/^sendaifun:/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export interface FlavorProfile {
  id: FlavorProfileId;
  label: string;
  description: string;
  category: FlavorCategory;
  baseStrategy: Strategy;
  presetSkills: CoreAgentSkillId[];
  defaultModel?: string;
}

export const FLAVOR_PROFILES: FlavorProfile[] = [
  {
    id: 'alpha-hunter',
    label: 'Alpha Hunter',
    description: 'Aggressive tipping to claim TOP ALPHA each epoch',
    category: 'alpha',
    baseStrategy: Strategy.AlphaHunter,
    presetSkills: ['alpha-haus'],
  },
  {
    id: 'burn-maximalist',
    label: 'Burn Maximalist',
    description: 'Burns tokens strategically for TOP BURNER position',
    category: 'alpha',
    baseStrategy: Strategy.BurnMaximalist,
    presetSkills: ['alpha-haus'],
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Tips and burns adaptively based on cheapest position',
    category: 'alpha',
    baseStrategy: Strategy.Balanced,
    presetSkills: ['alpha-haus'],
  },
  {
    id: 'vibes-poster',
    label: 'Vibes Poster',
    description: 'Posts memos with minimum tips, no competition',
    category: 'alpha',
    baseStrategy: Strategy.VibesPoster,
    presetSkills: ['alpha-haus'],
  },
  {
    id: 'dca-bot',
    label: 'DCA Bot',
    description: 'Builds and tracks dollar-cost averaging plans on a recurring schedule',
    category: 'general',
    baseStrategy: Strategy.Balanced,
    presetSkills: ['dca-planner'],
  },
  {
    id: 'x-posting-bot',
    label: 'X Posting Bot',
    description: 'Drafts and publishes posts to X with Grok-style writing support',
    category: 'general',
    baseStrategy: Strategy.VibesPoster,
    presetSkills: ['x-posting', 'grok-writer'],
  },
];

export function getFlavorProfile(id: FlavorProfileId): FlavorProfile {
  return FLAVOR_PROFILES.find((profile) => profile.id === id) || FLAVOR_PROFILES[0];
}

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
