import { DEFAULT_LLM_MODELS } from '@agents-haus/common';
import { randomUUID } from 'node:crypto';

type ModelPricing = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
};

type LedgerEntry = {
  capUsd: number;
  spentUsd: number;
  reservedUsd: number;
  reservations: Map<string, ReservationRecord>;
  updatedAt: number;
};

type ReservationRecord = {
  id: string;
  reserveUsd: number;
  createdAt: number;
};

type RateState = {
  consecutive: number;
  lastRequestAt: number;
  windowStartAt: number;
  windowCount: number;
};

export type AgentCreditPeriod = 'daily' | 'monthly';

export type AgentCreditPolicy = {
  enabled: boolean;
  capUsd: number | null;
  period: AgentCreditPeriod;
  periodKey: string;
};

export type AgentCreditReservation = {
  agentId: string;
  periodKey: string;
  reservationId: string;
};

export type CreditReserveResult =
  | {
      allowed: true;
      reservation: AgentCreditReservation;
      capUsd: number;
      spentUsd: number;
      reservedUsd: number;
      remainingUsd: number;
    }
  | {
      allowed: false;
      capUsd: number;
      spentUsd: number;
      reservedUsd: number;
      remainingUsd: number;
    };

export type CreditFinalizeResult = {
  capUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
};

export type AgentCreditSnapshot = {
  enabled: boolean;
  capUsd: number | null;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number | null;
  period: AgentCreditPeriod;
  periodKey: string;
};

export type ChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ConsecutiveRateLimitConfig = {
  thresholdConsecutive: number;
  minIntervalMsAfterThreshold: number;
  maxPerMinuteAfterThreshold: number;
  resetAfterIdleMs: number;
};

export type ConsecutiveRateDecision =
  | {
      allowed: true;
      consecutive: number;
      threshold: number;
    }
  | {
      allowed: false;
      consecutive: number;
      threshold: number;
      retryAfterMs: number;
      reason: 'min-interval' | 'per-minute';
    };

const TOKEN_APPROX_CHARS_PER_TOKEN = 4;
const MAX_LEDGER_ENTRIES = 5_000;
const MAX_RATE_ENTRIES = 20_000;
const MODEL_PRICING = new Map<string, ModelPricing>(
  DEFAULT_LLM_MODELS.map((model) => [
    model.id,
    {
      inputPerMillionUsd: model.costPerMInput,
      outputPerMillionUsd: model.costPerMOutput,
    },
  ]),
);
const ledgers = new Map<string, LedgerEntry>();
const rateStates = new Map<string, RateState>();

function toFiniteNumber(value: unknown): number | null {
  const candidate =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value.trim())
        : Number.NaN;
  if (!Number.isFinite(candidate)) return null;
  return candidate;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function getPricingForModel(modelId: string): ModelPricing {
  const known = MODEL_PRICING.get(modelId);
  if (known) return known;
  return {
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 3,
  };
}

function ledgerKey(agentId: string, periodKey: string): string {
  return `${agentId}:${periodKey}`;
}

function formatPeriodKey(period: AgentCreditPeriod, nowMs: number): string {
  const now = new Date(nowMs);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return period === 'daily' ? `${year}-${month}-${day}` : `${year}-${month}`;
}

function pruneLedgerEntries() {
  if (ledgers.size <= MAX_LEDGER_ENTRIES) return;
  const entries = Array.from(ledgers.entries()).sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt,
  );
  const removeCount = Math.max(1, entries.length - MAX_LEDGER_ENTRIES);
  for (let i = 0; i < removeCount; i += 1) {
    const [key] = entries[i];
    ledgers.delete(key);
  }
}

function pruneRateEntries() {
  if (rateStates.size <= MAX_RATE_ENTRIES) return;
  const entries = Array.from(rateStates.entries()).sort(
    (a, b) => a[1].lastRequestAt - b[1].lastRequestAt,
  );
  const removeCount = Math.max(1, entries.length - MAX_RATE_ENTRIES);
  for (let i = 0; i < removeCount; i += 1) {
    const [key] = entries[i];
    rateStates.delete(key);
  }
}

function resolvePeriod(env: Record<string, string | undefined>): AgentCreditPeriod {
  const raw = (env.AGENT_CREDIT_CAP_PERIOD || env.AGENT_CREDIT_PERIOD || '')
    .trim()
    .toLowerCase();
  if (raw === 'daily') return 'daily';
  return 'monthly';
}

function resolveCapUsd(env: Record<string, string | undefined>): number | null {
  const candidates = [
    env.AGENT_CREDIT_CAP_USD,
    env.AGENT_MAX_CREDITS_USD,
    env.AGENT_MONTHLY_CREDIT_CAP_USD,
    env.DEFAULT_AGENT_CREDIT_CAP_USD,
  ];

  for (const candidate of candidates) {
    const parsed = toFiniteNumber(candidate);
    if (parsed === null) continue;
    const normalized = roundUsd(Math.max(parsed, 0));
    return normalized > 0 ? normalized : null;
  }
  return null;
}

function getOrCreateLedger(
  agentId: string,
  periodKey: string,
  capUsd: number,
  nowMs: number,
): LedgerEntry {
  const key = ledgerKey(agentId, periodKey);
  const existing = ledgers.get(key);
  if (existing) {
    existing.capUsd = capUsd;
    existing.updatedAt = nowMs;
    return existing;
  }

  const created: LedgerEntry = {
    capUsd,
    spentUsd: 0,
    reservedUsd: 0,
    reservations: new Map<string, ReservationRecord>(),
    updatedAt: nowMs,
  };
  ledgers.set(key, created);
  pruneLedgerEntries();
  return created;
}

function normalizeUsageNumber(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  const normalized = Math.floor(parsed);
  return normalized >= 0 ? normalized : null;
}

export function resolveAgentCreditPolicy(
  env: Record<string, string | undefined>,
  nowMs: number = Date.now(),
): AgentCreditPolicy {
  const period = resolvePeriod(env);
  const capUsd = resolveCapUsd(env);
  return {
    enabled: Boolean(capUsd && capUsd > 0),
    capUsd,
    period,
    periodKey: formatPeriodKey(period, nowMs),
  };
}

export function getAgentCreditSnapshot(args: {
  agentId: string;
  policy: AgentCreditPolicy;
  nowMs?: number;
}): AgentCreditSnapshot {
  const nowMs = args.nowMs ?? Date.now();
  const periodKey = args.policy.periodKey || formatPeriodKey(args.policy.period, nowMs);
  if (!args.policy.enabled || !args.policy.capUsd || args.policy.capUsd <= 0) {
    return {
      enabled: false,
      capUsd: null,
      spentUsd: 0,
      reservedUsd: 0,
      remainingUsd: null,
      period: args.policy.period,
      periodKey,
    };
  }

  const key = ledgerKey(args.agentId, periodKey);
  const ledger = ledgers.get(key);
  const capUsd = roundUsd(Math.max(args.policy.capUsd, 0));
  const spentUsd = roundUsd(Math.max(ledger?.spentUsd ?? 0, 0));
  const reservedUsd = roundUsd(Math.max(ledger?.reservedUsd ?? 0, 0));

  return {
    enabled: true,
    capUsd,
    spentUsd,
    reservedUsd,
    remainingUsd: roundUsd(Math.max(capUsd - spentUsd - reservedUsd, 0)),
    period: args.policy.period,
    periodKey,
  };
}

export function estimateTokensFromText(input: unknown): number {
  const text = typeof input === 'string' ? input : '';
  if (!text.trim()) return 1;
  return Math.max(1, Math.ceil(text.length / TOKEN_APPROX_CHARS_PER_TOKEN));
}

export function estimatePromptTokensFromMessages(
  messages: Array<{ role?: unknown; content?: unknown }>,
): number {
  if (!Array.isArray(messages) || messages.length === 0) return 1;

  let total = 0;
  for (const message of messages) {
    const role = typeof message?.role === 'string' ? message.role : '';
    const content = typeof message?.content === 'string' ? message.content : '';
    total += estimateTokensFromText(`${role}\n${content}`);
    total += 3;
  }
  return Math.max(1, total);
}

export function estimateChatCostUsd(args: {
  modelId: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const pricing = getPricingForModel(args.modelId);
  const inputUsd = (Math.max(args.promptTokens, 0) / 1_000_000) * pricing.inputPerMillionUsd;
  const outputUsd =
    (Math.max(args.completionTokens, 0) / 1_000_000) * pricing.outputPerMillionUsd;
  return roundUsd(inputUsd + outputUsd);
}

export function reserveAgentCredits(args: {
  agentId: string;
  policy: AgentCreditPolicy;
  reserveUsd: number;
  nowMs?: number;
}): CreditReserveResult {
  const nowMs = args.nowMs ?? Date.now();
  if (!args.policy.enabled || !args.policy.capUsd || args.policy.capUsd <= 0) {
    return {
      allowed: true,
      reservation: {
        agentId: args.agentId,
        periodKey: args.policy.periodKey,
        reservationId: '__disabled__',
      },
      capUsd: 0,
      spentUsd: 0,
      reservedUsd: 0,
      remainingUsd: Number.POSITIVE_INFINITY,
    };
  }

  const reserveUsd = roundUsd(Math.max(args.reserveUsd, 0));
  const capUsd = args.policy.capUsd;
  const ledger = getOrCreateLedger(args.agentId, args.policy.periodKey, capUsd, nowMs);
  const projected = roundUsd(ledger.spentUsd + ledger.reservedUsd + reserveUsd);
  if (projected > capUsd) {
    return {
      allowed: false,
      capUsd,
      spentUsd: ledger.spentUsd,
      reservedUsd: ledger.reservedUsd,
      remainingUsd: roundUsd(Math.max(capUsd - ledger.spentUsd - ledger.reservedUsd, 0)),
    };
  }

  const reservationId = randomUUID();
  ledger.reservedUsd = roundUsd(ledger.reservedUsd + reserveUsd);
  ledger.updatedAt = nowMs;
  ledger.reservations.set(reservationId, {
    id: reservationId,
    reserveUsd,
    createdAt: nowMs,
  });

  return {
    allowed: true,
    reservation: {
      agentId: args.agentId,
      periodKey: args.policy.periodKey,
      reservationId,
    },
    capUsd,
    spentUsd: ledger.spentUsd,
    reservedUsd: ledger.reservedUsd,
    remainingUsd: roundUsd(Math.max(capUsd - ledger.spentUsd - ledger.reservedUsd, 0)),
  };
}

export function finalizeAgentCreditReservation(args: {
  reservation: AgentCreditReservation;
  actualUsd: number;
  capUsd: number;
  nowMs?: number;
}): CreditFinalizeResult | null {
  const nowMs = args.nowMs ?? Date.now();
  if (args.reservation.reservationId === '__disabled__') return null;

  const key = ledgerKey(args.reservation.agentId, args.reservation.periodKey);
  const ledger = ledgers.get(key);
  if (!ledger) return null;

  const record = ledger.reservations.get(args.reservation.reservationId);
  if (!record) return null;

  ledger.reservations.delete(args.reservation.reservationId);
  ledger.reservedUsd = roundUsd(Math.max(ledger.reservedUsd - record.reserveUsd, 0));
  ledger.spentUsd = roundUsd(ledger.spentUsd + Math.max(args.actualUsd, 0));
  ledger.capUsd = args.capUsd;
  ledger.updatedAt = nowMs;

  return {
    capUsd: ledger.capUsd,
    spentUsd: ledger.spentUsd,
    reservedUsd: ledger.reservedUsd,
    remainingUsd: roundUsd(Math.max(ledger.capUsd - ledger.spentUsd - ledger.reservedUsd, 0)),
  };
}

export function releaseAgentCreditReservation(args: {
  reservation: AgentCreditReservation;
  nowMs?: number;
}): CreditFinalizeResult | null {
  const nowMs = args.nowMs ?? Date.now();
  if (args.reservation.reservationId === '__disabled__') return null;

  const key = ledgerKey(args.reservation.agentId, args.reservation.periodKey);
  const ledger = ledgers.get(key);
  if (!ledger) return null;

  const record = ledger.reservations.get(args.reservation.reservationId);
  if (!record) return null;

  ledger.reservations.delete(args.reservation.reservationId);
  ledger.reservedUsd = roundUsd(Math.max(ledger.reservedUsd - record.reserveUsd, 0));
  ledger.updatedAt = nowMs;

  return {
    capUsd: ledger.capUsd,
    spentUsd: ledger.spentUsd,
    reservedUsd: ledger.reservedUsd,
    remainingUsd: roundUsd(Math.max(ledger.capUsd - ledger.spentUsd - ledger.reservedUsd, 0)),
  };
}

export function extractChatUsage(payload: unknown): ChatUsage | null {
  if (!payload || typeof payload !== 'object') return null;
  const root = payload as Record<string, unknown>;
  const usage = (root.usage || root.token_usage || null) as
    | Record<string, unknown>
    | null;
  if (!usage) return null;

  const promptTokens =
    normalizeUsageNumber(usage.prompt_tokens) ??
    normalizeUsageNumber(usage.promptTokens) ??
    normalizeUsageNumber(usage.input_tokens) ??
    normalizeUsageNumber(usage.inputTokens);
  const completionTokens =
    normalizeUsageNumber(usage.completion_tokens) ??
    normalizeUsageNumber(usage.completionTokens) ??
    normalizeUsageNumber(usage.output_tokens) ??
    normalizeUsageNumber(usage.outputTokens);
  const totalTokens =
    normalizeUsageNumber(usage.total_tokens) ??
    normalizeUsageNumber(usage.totalTokens) ??
    (promptTokens !== null && completionTokens !== null
      ? promptTokens + completionTokens
      : null);

  if (promptTokens === null || completionTokens === null || totalTokens === null) {
    return null;
  }

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export function resolveConsecutiveRateLimitConfig(
  env: Record<string, string | undefined>,
): ConsecutiveRateLimitConfig {
  const thresholdRaw = toFiniteNumber(
    env.AGENT_CHAT_RATE_LIMIT_AFTER_CONSECUTIVE ||
      env.CHAT_RATE_LIMIT_AFTER_CONSECUTIVE,
  );
  const minIntervalRaw = toFiniteNumber(
    env.AGENT_CHAT_RATE_LIMIT_MIN_INTERVAL_MS_AFTER_THRESHOLD ||
      env.CHAT_RATE_LIMIT_MIN_INTERVAL_MS_AFTER_THRESHOLD,
  );
  const maxPerMinuteRaw = toFiniteNumber(
    env.AGENT_CHAT_RATE_LIMIT_MAX_PER_MINUTE_AFTER_THRESHOLD ||
      env.CHAT_RATE_LIMIT_MAX_PER_MINUTE_AFTER_THRESHOLD,
  );
  const resetAfterRaw = toFiniteNumber(
    env.AGENT_CHAT_RATE_LIMIT_RESET_AFTER_IDLE_MS ||
      env.CHAT_RATE_LIMIT_RESET_AFTER_IDLE_MS,
  );

  // Keep this deliberately relaxed: only enforce after 10-20 consecutive messages.
  const thresholdConsecutive = clamp(Math.floor(thresholdRaw ?? 15), 10, 20);
  return {
    thresholdConsecutive,
    minIntervalMsAfterThreshold: clamp(Math.floor(minIntervalRaw ?? 1200), 200, 15_000),
    maxPerMinuteAfterThreshold: clamp(Math.floor(maxPerMinuteRaw ?? 40), 5, 200),
    resetAfterIdleMs: clamp(Math.floor(resetAfterRaw ?? 12 * 60_000), 30_000, 6 * 60 * 60_000),
  };
}

export function checkConsecutiveRateLimit(args: {
  agentId: string;
  userId: string;
  config: ConsecutiveRateLimitConfig;
  nowMs?: number;
}): ConsecutiveRateDecision {
  const nowMs = args.nowMs ?? Date.now();
  const key = `${args.agentId}:${args.userId}`;
  const current = rateStates.get(key);

  let state: RateState;
  if (!current || nowMs - current.lastRequestAt > args.config.resetAfterIdleMs) {
    state = {
      consecutive: 0,
      lastRequestAt: 0,
      windowStartAt: nowMs,
      windowCount: 0,
    };
  } else {
    state = { ...current };
  }

  const nextConsecutive = state.consecutive + 1;
  const threshold = args.config.thresholdConsecutive;
  if (nextConsecutive > threshold) {
    const sinceLast = nowMs - state.lastRequestAt;
    if (sinceLast < args.config.minIntervalMsAfterThreshold) {
      const retryAfterMs = args.config.minIntervalMsAfterThreshold - sinceLast;
      return {
        allowed: false,
        consecutive: nextConsecutive,
        threshold,
        retryAfterMs,
        reason: 'min-interval',
      };
    }

    if (nowMs - state.windowStartAt >= 60_000) {
      state.windowStartAt = nowMs;
      state.windowCount = 0;
    }

    if (state.windowCount + 1 > args.config.maxPerMinuteAfterThreshold) {
      const retryAfterMs = Math.max(60_000 - (nowMs - state.windowStartAt), 250);
      return {
        allowed: false,
        consecutive: nextConsecutive,
        threshold,
        retryAfterMs,
        reason: 'per-minute',
      };
    }

    state.windowCount += 1;
  } else if (nowMs - state.windowStartAt >= 60_000) {
    state.windowStartAt = nowMs;
    state.windowCount = 0;
  }

  state.consecutive = nextConsecutive;
  state.lastRequestAt = nowMs;
  rateStates.set(key, state);
  pruneRateEntries();

  return {
    allowed: true,
    consecutive: nextConsecutive,
    threshold,
  };
}
