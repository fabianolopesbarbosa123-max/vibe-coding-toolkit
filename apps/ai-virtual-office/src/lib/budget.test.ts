import { describe, expect, it } from "vitest";
import { checkAdmission, checkCall, crossedThreshold, budgetLevel, periodStarts, type UsageLimits, type UsageTotals } from "./budget";
import { estimateCostUsd, worstCaseCostUsd, ANTHROPIC_PRICES } from "./pricing";

const limits: UsageLimits = { monthlyBudgetUsd: 10, monthlyTokenLimit: 1_000_000, dailyRequestLimit: 5, maxConcurrentRuns: 2, alertPercent: 80, source: "default" };
const usage = (patch: Partial<UsageTotals> = {}): UsageTotals => ({ monthCostUsd: 0, monthTokens: 0, monthRequests: 0, dayRequests: 0, unpricedRequests: 0, activeRuns: 0, ...patch });

describe("checkAdmission", () => {
  it("allows work under every limit", () => expect(checkAdmission(limits, usage()).ok).toBe(true));
  it("blocks on concurrency, daily requests, tokens, and budget", () => {
    expect(checkAdmission(limits, usage({ activeRuns: 2 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/simultânea/) });
    expect(checkAdmission(limits, usage({ dayRequests: 5 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/diário/) });
    expect(checkAdmission(limits, usage({ monthTokens: 1_000_000 }))).toMatchObject({ ok: false });
    expect(checkAdmission(limits, usage({ monthCostUsd: 10 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Orçamento/) });
  });
  it("treats null as unlimited", () => {
    const open = { ...limits, monthlyBudgetUsd: null, monthlyTokenLimit: null, dailyRequestLimit: null, maxConcurrentRuns: null };
    expect(checkAdmission(open, usage({ monthCostUsd: 1e6, dayRequests: 1e6, activeRuns: 99 })).ok).toBe(true);
  });
});

describe("checkCall", () => {
  it("refuses a call whose worst case would exceed the remaining budget", () => {
    expect(checkCall(limits, usage({ monthCostUsd: 9.9 }), { worstCostUsd: 0.2, worstTokens: 100 })).toMatchObject({ ok: false });
    expect(checkCall(limits, usage({ monthCostUsd: 9.7 }), { worstCostUsd: 0.2, worstTokens: 100 }).ok).toBe(true);
  });
  it("refuses unpriced models under a budget unless a token limit applies", () => {
    expect(checkCall({ ...limits, monthlyTokenLimit: null }, usage(), { worstCostUsd: null, worstTokens: 10 }).ok).toBe(false);
    expect(checkCall(limits, usage(), { worstCostUsd: null, worstTokens: 10 }).ok).toBe(true);
  });
  it("counts the call itself against the daily limit", () => {
    expect(checkCall(limits, usage({ dayRequests: 4 }), { worstCostUsd: 0, worstTokens: 1 }).ok).toBe(true);
    expect(checkCall(limits, usage({ dayRequests: 5 }), { worstCostUsd: 0, worstTokens: 1 }).ok).toBe(false);
  });
});

describe("alerts", () => {
  it("fires once when crossing the alert and the hard limit", () => {
    expect(crossedThreshold(limits, usage({ monthCostUsd: 7.9 }), usage({ monthCostUsd: 8.1 }))).toBe("warning");
    expect(crossedThreshold(limits, usage({ monthCostUsd: 8.1 }), usage({ monthCostUsd: 8.5 }))).toBeNull();
    expect(crossedThreshold(limits, usage({ monthCostUsd: 9.9 }), usage({ monthCostUsd: 10.1 }))).toBe("exceeded");
    expect(budgetLevel(limits, usage({ monthCostUsd: 8.5 }))).toBe("warning");
  });
});

describe("pricing", () => {
  it("applies the Claude Haiku 5.5 long-prompt tier", () => {
    expect(estimateCostUsd("anthropic", "claude-haiku-5-5", 100_000, 0)).toBeCloseTo(0.01);
    expect(estimateCostUsd("anthropic", "claude-haiku-5-5", 200_000, 0)).toBeCloseTo(0.1);
  });
  it("bounds a call by bytes plus the full output allowance", () => {
    expect(worstCaseCostUsd(ANTHROPIC_PRICES["claude-opus-5-5"], 1_000_000, 16_000)).toBeCloseTo(4 + 0.32);
  });
});

it("uses UTC month and day boundaries", () => {
  expect(periodStarts(new Date("2026-11-09T23:30:00-03:00"))).toEqual({ month: "2026-11-01T00:00:00.000Z", day: "2026-11-10T00:00:00.000Z" });
});
