/**
 * Skill tool: build_dca_plan
 *
 * Builds a simple recurring DCA plan from budget and cadence inputs.
 */

const CADENCE_PER_WEEK: Record<'daily' | 'weekly' | 'biweekly' | 'monthly', number> = {
  daily: 7,
  weekly: 1,
  biweekly: 0.5,
  monthly: 0.25,
};

interface BuildDcaPlanArgs {
  asset: string;
  totalBudgetUsd: number;
  cadence: 'daily' | 'weekly' | 'biweekly' | 'monthly';
  horizonWeeks: number;
  riskProfile?: 'low' | 'medium' | 'high';
}

interface BuildDcaPlanResult {
  ok: boolean;
  asset?: string;
  cadence?: string;
  horizonWeeks?: number;
  totalBudgetUsd?: number;
  estimatedOrders?: number;
  amountPerOrderUsd?: number;
  riskProfile?: string;
  checklist?: string[];
  error?: string;
}

function normalizeAsset(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function normalizeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
}

export async function buildDcaPlan(args: BuildDcaPlanArgs): Promise<BuildDcaPlanResult> {
  const asset = normalizeAsset(args.asset);
  const totalBudgetUsd = normalizeNumber(args.totalBudgetUsd);
  const horizonWeeks = normalizeNumber(args.horizonWeeks);
  const cadence = args.cadence;

  if (!asset) {
    return { ok: false, error: 'asset is required (e.g. SOL, BTC, ETH)' };
  }
  if (!cadence || !(cadence in CADENCE_PER_WEEK)) {
    return { ok: false, error: 'cadence must be one of: daily, weekly, biweekly, monthly' };
  }
  if (!Number.isFinite(totalBudgetUsd) || totalBudgetUsd <= 0) {
    return { ok: false, error: 'totalBudgetUsd must be a positive number' };
  }
  if (!Number.isFinite(horizonWeeks) || horizonWeeks <= 0) {
    return { ok: false, error: 'horizonWeeks must be a positive number' };
  }

  const cadencePerWeek = CADENCE_PER_WEEK[cadence];
  const estimatedOrders = Math.max(1, Math.round(horizonWeeks * cadencePerWeek));
  const amountPerOrderUsd = Number((totalBudgetUsd / estimatedOrders).toFixed(2));
  const riskProfile = args.riskProfile || 'medium';

  const checklist = [
    'Confirm venue, fees, and slippage limits before automation.',
    'Use limit/triggered orders where available to avoid poor fills.',
    'Keep an emergency stop condition (news shock, volatility spike, or depeg).',
    'Review allocation drift weekly and rebalance only when thresholds are exceeded.',
  ];

  return {
    ok: true,
    asset,
    cadence,
    horizonWeeks,
    totalBudgetUsd: Number(totalBudgetUsd.toFixed(2)),
    estimatedOrders,
    amountPerOrderUsd,
    riskProfile,
    checklist,
  };
}
