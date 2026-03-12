export type ChatUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

function normalizeUsageNumber(value: unknown): number | null {
  const candidate =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value.trim())
        : Number.NaN;
  if (!Number.isFinite(candidate)) return null;
  const normalized = Math.floor(candidate);
  return normalized >= 0 ? normalized : null;
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
