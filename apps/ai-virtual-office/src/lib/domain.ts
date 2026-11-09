import { z } from "zod";

export const ROOM_IDS = [
  "planning",
  "programming",
  "research",
  "marketing",
  "meeting",
  "support",
  "monitoring",
] as const;
export type RoomId = (typeof ROOM_IDS)[number];

export const AGENT_ROLES = [
  "ceo",
  "programmer",
  "designer",
  "marketing",
  "researcher",
  "analyst",
  "support",
  "custom",
] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const PROVIDERS = ["anthropic", "openai"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const AGENT_STATUSES = ["idle", "working", "meeting", "done", "error"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ["pending", "running", "completed", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PROJECT_STATUSES = ["planning", "ready", "running", "completed", "failed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  title: string;
  room: RoomId;
  color: string;
  provider: Provider;
  /** Null means the provider's configured default model. */
  model: string | null;
  instructions: string;
  status: AgentStatus;
  currentTaskId: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  request: string;
  status: ProjectStatus;
  summary: string | null;
  result: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  projectId: string | null;
  title: string;
  description: string;
  agentId: string;
  priority: Priority;
  status: TaskStatus;
  order: number;
  result: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export type EventLevel = "info" | "success" | "warning" | "error";

export interface ActivityEvent {
  id: string;
  at: string;
  level: EventLevel;
  message: string;
  agentId: string | null;
  taskId: string | null;
  projectId: string | null;
}

export interface UsageRecord {
  id: string;
  at: string;
  agentId: string;
  taskId: string | null;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Null when no price is known for the model. */
  costUsd: number | null;
}

export interface OfficeState {
  agents: Agent[];
  projects: Project[];
  tasks: Task[];
  events: ActivityEvent[];
  usage: UsageRecord[];
}

export type IntegrationStatus = "available" | "unavailable" | "planned";

export interface Integration {
  id: string;
  label: string;
  status: IntegrationStatus;
  detail: string;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const modelName = z
  .string()
  .trim()
  .max(80)
  .regex(/^[\w.:/-]*$/, "Invalid model name");

export const agentInputSchema = z.object({
  name: text(40),
  role: z.enum(AGENT_ROLES),
  title: text(60),
  room: z.enum(ROOM_IDS),
  color: hexColor,
  provider: z.enum(PROVIDERS),
  model: modelName.transform(value => value || null).nullable().default(null),
  instructions: text(4000),
});
export type AgentInput = z.infer<typeof agentInputSchema>;

export const agentPatchSchema = agentInputSchema.partial();

export const taskInputSchema = z.object({
  title: text(120),
  description: text(4000),
  agentId: text(64),
  priority: z.enum(PRIORITIES).default("medium"),
  projectId: z.string().max(64).nullable().default(null),
});
export type TaskInput = z.infer<typeof taskInputSchema>;

export const projectInputSchema = z.object({
  name: text(80),
  request: text(4000),
});

export const orchestrateInputSchema = z.object({
  request: text(4000),
  autoRun: z.boolean().default(true),
});
