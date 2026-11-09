/** Per-user AI usage limits. Null means "no limit" for that dimension. */
export interface UsageLimits {
  monthlyBudgetUsd: number | null;
  monthlyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  maxConcurrentRuns: number | null;
  alertPercent: number;
  /** Where the effective budget came from, for display. */
  source: "default" | "operator" | "personal";
}

export interface UsageTotals {
  monthCostUsd: number;
  monthTokens: number;
  monthRequests: number;
  dayRequests: number;
  unpricedRequests: number;
  activeRuns: number;
}

export interface CallEstimate {
  /** Upper bound in USD, or null when the model has no known price. */
  worstCostUsd: number | null;
  worstTokens: number;
}

export type BudgetLevel = "ok" | "warning" | "exceeded";

export interface BudgetStatus {
  limits: UsageLimits;
  usage: UsageTotals;
  /** Highest share of any monthly limit used, 0–100+ (null without monthly limits). */
  percentUsed: number | null;
  level: BudgetLevel;
  periodStart: string;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

const usd = (value: number) => `US$ ${value.toFixed(2)}`;

/** Checks that may run before any prompt exists (starting a task or a project). */
export function checkAdmission(limits: UsageLimits, usage: UsageTotals): Verdict {
  if (limits.maxConcurrentRuns !== null && usage.activeRuns >= limits.maxConcurrentRuns) {
    return { ok: false, reason: `Limite de ${limits.maxConcurrentRuns} execução(ões) simultânea(s) atingido. Aguarde uma terminar.` };
  }
  if (limits.dailyRequestLimit !== null && usage.dayRequests >= limits.dailyRequestLimit) {
    return { ok: false, reason: `Limite diário de ${limits.dailyRequestLimit} chamadas de IA atingido. Tente novamente amanhã.` };
  }
  if (limits.monthlyTokenLimit !== null && usage.monthTokens >= limits.monthlyTokenLimit) {
    return { ok: false, reason: "Limite mensal de tokens atingido." };
  }
  if (limits.monthlyBudgetUsd !== null && usage.monthCostUsd >= limits.monthlyBudgetUsd) {
    return { ok: false, reason: `Orçamento mensal de ${usd(limits.monthlyBudgetUsd)} atingido.` };
  }
  return { ok: true };
}

/**
 * Checks one AI call against the remaining allowance using its worst case, so a call
 * that could push usage past a limit is refused before it is sent.
 */
export function checkCall(limits: UsageLimits, usage: UsageTotals, call: CallEstimate): Verdict {
  if (limits.dailyRequestLimit !== null && usage.dayRequests + 1 > limits.dailyRequestLimit) {
    return { ok: false, reason: `Limite diário de ${limits.dailyRequestLimit} chamadas de IA atingido.` };
  }
  if (limits.monthlyTokenLimit !== null && usage.monthTokens + call.worstTokens > limits.monthlyTokenLimit) {
    return { ok: false, reason: "Esta chamada pode ultrapassar o limite mensal de tokens." };
  }
  if (limits.monthlyBudgetUsd !== null) {
    if (call.worstCostUsd === null) {
      if (limits.monthlyTokenLimit === null) {
        return { ok: false, reason: "O modelo não tem preço configurado; defina um limite de tokens ou o preço para usá-lo com orçamento." };
      }
    } else if (usage.monthCostUsd + call.worstCostUsd > limits.monthlyBudgetUsd) {
      const left = Math.max(0, limits.monthlyBudgetUsd - usage.monthCostUsd);
      return { ok: false, reason: `Orçamento insuficiente: restam ${usd(left)} e esta chamada pode custar até ${usd(call.worstCostUsd)}.` };
    }
  }
  return { ok: true };
}

export function percentUsed(limits: UsageLimits, usage: UsageTotals): number | null {
  const shares: number[] = [];
  if (limits.monthlyBudgetUsd) shares.push((usage.monthCostUsd / limits.monthlyBudgetUsd) * 100);
  else if (limits.monthlyBudgetUsd === 0) shares.push(100);
  if (limits.monthlyTokenLimit) shares.push((usage.monthTokens / limits.monthlyTokenLimit) * 100);
  return shares.length ? Math.max(...shares) : null;
}

export function budgetLevel(limits: UsageLimits, usage: UsageTotals): BudgetLevel {
  const percent = percentUsed(limits, usage);
  if (percent === null) return "ok";
  if (percent >= 100) return "exceeded";
  return percent >= limits.alertPercent ? "warning" : "ok";
}

/** Alert to raise when a recorded call moves usage across the alert or the hard threshold. */
export function crossedThreshold(limits: UsageLimits, before: UsageTotals, after: UsageTotals): BudgetLevel | null {
  const from = percentUsed(limits, before) ?? 0;
  const to = percentUsed(limits, after) ?? 0;
  if (from < 100 && to >= 100) return "exceeded";
  if (from < limits.alertPercent && to >= limits.alertPercent) return "warning";
  return null;
}

/** Calendar month and day boundaries in UTC. */
export function periodStarts(now = new Date()) {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { month: month.toISOString(), day: day.toISOString() };
}
