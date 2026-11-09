import type { Agent, AgentRole, OfficeState, RoomId } from "./domain";

interface SeedAgent {
  name: string;
  role: AgentRole;
  title: string;
  room: RoomId;
  color: string;
  instructions: string;
}

const SEED_AGENTS: SeedAgent[] = [
  {
    name: "Helena",
    role: "ceo",
    title: "CEO",
    room: "planning",
    color: "#f59e0b",
    instructions:
      "You coordinate the office. Turn the owner's requests into a short, ordered plan, assign each task to the best specialist, and present a clear final summary of the team's results.",
  },
  {
    name: "Rafael",
    role: "programmer",
    title: "Programador",
    room: "programming",
    color: "#3b82f6",
    instructions:
      "You are a senior software engineer. Produce working, typed, tested code with file paths, explain decisions briefly, and list commands to run. Never claim you executed code.",
  },
  {
    name: "Lia",
    role: "designer",
    title: "Designer",
    room: "programming",
    color: "#ec4899",
    instructions:
      "You are a product designer. Define layouts, user flows, visual identity, and accessibility criteria. Describe screens and components precisely enough for an engineer to build them.",
  },
  {
    name: "Bruno",
    role: "marketing",
    title: "Marketing",
    room: "marketing",
    color: "#22c55e",
    instructions:
      "You are a marketing strategist. Create positioning, campaigns, content ideas, scripts, and ad copy tied to a specific audience and channel.",
  },
  {
    name: "Sofia",
    role: "researcher",
    title: "Pesquisadora",
    room: "research",
    color: "#a855f7",
    instructions:
      "You are a market researcher. Analyze markets, competitors, and opportunities. Separate known facts from assumptions and state that you have no live web access unless sources are provided.",
  },
  {
    name: "Diego",
    role: "analyst",
    title: "Analista",
    room: "monitoring",
    color: "#14b8a6",
    instructions:
      "You are a data and quality analyst. Review deliverables, define indicators, identify problems and risks, and write test plans with clear pass/fail criteria.",
  },
];

/**
 * Default team for a new office. `idFor` lets multi-user stores derive per-user ids;
 * the local store keeps the stable "agent-<role>" ids.
 */
export function createSeedState(
  now = new Date().toISOString(),
  idFor: (role: AgentRole) => string = role => `agent-${role}`,
): OfficeState {
  const agents: Agent[] = SEED_AGENTS.map(agent => ({
    ...agent,
    id: idFor(agent.role),
    provider: "anthropic",
    model: null,
    status: "idle",
    currentTaskId: null,
    createdAt: now,
  }));
  return { agents, projects: [], tasks: [], events: [], usage: [] };
}
