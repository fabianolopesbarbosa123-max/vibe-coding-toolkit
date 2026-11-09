import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "./pricing";
import { createSeedState } from "./seed";
import { computeStats } from "./stats";

describe("estimateCostUsd", () => {
  it("prices known Claude models per million tokens", () => {
    expect(estimateCostUsd("anthropic", "claude-opus-5-5", 1_000_000, 100_000)).toBeCloseTo(6);
  });
  it("returns null instead of guessing unknown prices", () => {
    expect(estimateCostUsd("anthropic", "unknown-model", 10, 10)).toBeNull();
    expect(estimateCostUsd("openai", "any", 10, 10)).toBeNull();
    expect(estimateCostUsd("openai", "any", 1_000_000, 0, { input: 2, output: 8 })).toBe(2);
  });
});

describe("computeStats", () => {
  it("aggregates agents, tasks, usage, and errors", () => {
    const state = createSeedState("2026-01-01T00:00:00.000Z");
    state.agents[1].status = "working";
    state.agents[2].status = "meeting";
    const base = { projectId: null, description: "d", agentId: state.agents[1].id, priority: "medium" as const, order: 0, result: null, error: null, createdAt: "", startedAt: null, completedAt: null };
    state.tasks.push({ ...base, id: "t1", title: "a", status: "running" }, { ...base, id: "t2", title: "b", status: "completed" });
    state.projects.push({ id: "p1", name: "p", request: "r", status: "running", summary: null, result: null, createdAt: "" });
    state.usage.push(
      { id: "u1", at: "", agentId: "agent-programmer", taskId: "t2", projectId: null, provider: "anthropic", model: "claude-opus-5-5", inputTokens: 100, outputTokens: 50, costUsd: 0.5 },
      { id: "u2", at: "", agentId: "agent-programmer", taskId: null, projectId: null, provider: "openai", model: "x", inputTokens: 10, outputTokens: 5, costUsd: null },
    );
    state.events.push({ id: "e1", at: "", level: "error", message: "x", agentId: null, taskId: null, projectId: null });

    const stats = computeStats(state);
    expect(stats).toMatchObject({
      totalAgents: 6,
      activeAgents: 2,
      tasksRunning: 1,
      tasksCompleted: 1,
      activeProjects: 1,
      apiCalls: 2,
      inputTokens: 110,
      estimatedCostUsd: 0.5,
      unpricedCalls: 1,
      errors: 1,
    });
  });
});
