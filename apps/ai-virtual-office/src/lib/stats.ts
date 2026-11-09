import type { OfficeState } from "./domain";

export interface AgentUsage {
  agentId: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpricedCalls: number;
}

export interface OfficeStats {
  totalAgents: number;
  activeAgents: number;
  tasksPending: number;
  tasksRunning: number;
  tasksCompleted: number;
  tasksFailed: number;
  activeProjects: number;
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  unpricedCalls: number;
  errors: number;
  usageByAgent: AgentUsage[];
}

export function computeStats(state: OfficeState): OfficeStats {
  const byAgent = new Map<string, AgentUsage>();
  for (const record of state.usage) {
    const entry = byAgent.get(record.agentId) ?? {
      agentId: record.agentId,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      unpricedCalls: 0,
    };
    entry.calls++;
    entry.inputTokens += record.inputTokens;
    entry.outputTokens += record.outputTokens;
    if (record.costUsd === null) entry.unpricedCalls++;
    else entry.costUsd += record.costUsd;
    byAgent.set(record.agentId, entry);
  }
  const usageByAgent = [...byAgent.values()].sort((a, b) => b.costUsd - a.costUsd);
  const sum = (key: "calls" | "inputTokens" | "outputTokens" | "costUsd" | "unpricedCalls") =>
    usageByAgent.reduce((total, entry) => total + entry[key], 0);
  const countTasks = (status: string) => state.tasks.filter(task => task.status === status).length;

  return {
    totalAgents: state.agents.length,
    activeAgents: state.agents.filter(agent => agent.status === "working" || agent.status === "meeting").length,
    tasksPending: countTasks("pending"),
    tasksRunning: countTasks("running"),
    tasksCompleted: countTasks("completed"),
    tasksFailed: countTasks("failed"),
    activeProjects: state.projects.filter(project => ["planning", "ready", "running"].includes(project.status)).length,
    apiCalls: sum("calls"),
    inputTokens: sum("inputTokens"),
    outputTokens: sum("outputTokens"),
    estimatedCostUsd: sum("costUsd"),
    unpricedCalls: sum("unpricedCalls"),
    errors: state.events.filter(event => event.level === "error").length,
    usageByAgent,
  };
}
