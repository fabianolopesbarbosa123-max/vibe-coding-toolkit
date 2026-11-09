import type { AgentStatus, IntegrationStatus, ProjectStatus, TaskStatus } from "./domain";
import type { Tone } from "@/components/ui";

export const AGENT_STATUS_TONE: Record<AgentStatus, Tone> = { idle: "slate", working: "blue", meeting: "violet", done: "green", error: "red" };
export const TASK_STATUS_TONE: Record<TaskStatus, Tone> = { pending: "amber", running: "blue", completed: "green", failed: "red" };
export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = { planning: "violet", ready: "amber", running: "blue", completed: "green", failed: "red" };
export const INTEGRATION_TONE: Record<IntegrationStatus, Tone> = { available: "green", unavailable: "red", planned: "slate" };
