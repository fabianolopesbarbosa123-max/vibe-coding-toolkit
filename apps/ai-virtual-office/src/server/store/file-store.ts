import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentConversation, AgentMessage, OfficeState } from "@/lib/domain";
import { createSeedState } from "@/lib/seed";
import {
  CONVERSATION_LIMIT,
  EVENT_LIMIT,
  USAGE_LIMIT,
  type CollectionName,
  type Collections,
  type OfficeStore,
} from "./types";

type StoredState = OfficeState & { conversations: AgentConversation[]; messages: AgentMessage[] };

const LIMITS: Partial<Record<CollectionName, number>> = {
  events: EVENT_LIMIT,
  usage: USAGE_LIMIT,
  conversations: CONVERSATION_LIMIT,
  messages: CONVERSATION_LIMIT * 3,
};

/**
 * Single-user JSON store for local development (OFFICE_LOCAL_MODE). Writes are
 * serialized and atomic (temp file + rename). Use Supabase for multi-user use.
 */
export class FileStore implements OfficeStore {
  readonly kind = "file" as const;
  private state: StoredState | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async load(): Promise<StoredState> {
    if (this.state) return this.state;
    try {
      const saved = JSON.parse(await readFile(this.file, "utf8")) as Partial<StoredState>;
      this.state = { ...createSeedState(), conversations: [], messages: [], ...saved } as StoredState;
      recoverInterrupted(this.state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { ...createSeedState(), conversations: [], messages: [] };
    }
    await this.persist();
    return this.state;
  }

  private async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(this.state, null, 2));
    await rename(temp, this.file);
  }

  private run<T>(operation: (state: StoredState) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => operation(await this.load()));
    this.queue = next.catch(() => undefined);
    return next;
  }

  snapshot(): Promise<OfficeState> {
    return this.run(({ agents, projects, tasks, events, usage }) =>
      structuredClone({ agents, projects, tasks, events, usage }),
    );
  }

  insert<C extends CollectionName>(collection: C, record: Collections[C]): Promise<void> {
    return this.run(async state => {
      const list = state[collection] as Collections[C][];
      list.push(record);
      const limit = LIMITS[collection];
      if (limit && list.length > limit) list.splice(0, list.length - limit);
      await this.persist();
    });
  }

  update<C extends CollectionName>(collection: C, id: string, patch: Partial<Collections[C]>) {
    return this.run(async state => this.apply(state, collection, id, patch));
  }

  claim<C extends CollectionName, K extends keyof Collections[C] & string>(
    collection: C,
    id: string,
    field: K,
    allowed: Collections[C][K][],
    patch: Partial<Collections[C]>,
  ) {
    return this.run(async state => {
      const current = (state[collection] as Collections[C][]).find(item => item.id === id);
      if (!current || !allowed.includes(current[field])) return null;
      return this.apply(state, collection, id, patch);
    });
  }

  deleteProject(projectId: string) {
    return this.run(async state => {
      const project = state.projects.find(item => item.id === projectId);
      if (!project || project.status === "planning" || project.status === "running") return false;
      const conversations = new Set(state.conversations.filter(item => item.projectId === projectId).map(item => item.id));
      state.projects = state.projects.filter(item => item.id !== projectId);
      state.tasks = state.tasks.filter(item => item.projectId !== projectId);
      state.conversations = state.conversations.filter(item => !conversations.has(item.id));
      state.messages = state.messages.filter(item => !conversations.has(item.conversationId));
      await this.persist();
      return true;
    });
  }

  private async apply<C extends CollectionName>(state: StoredState, collection: C, id: string, patch: Partial<Collections[C]>) {
    const list = state[collection] as Collections[C][];
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return null;
    list[index] = { ...list[index], ...patch, id };
    await this.persist();
    return structuredClone(list[index]);
  }
}

/** Work that was running when the process stopped cannot resume; mark it explicitly. */
export function recoverInterrupted(state: OfficeState, now = new Date().toISOString()) {
  for (const task of state.tasks) {
    if (task.status === "running") {
      Object.assign(task, { status: "failed", error: "Interrompida: o servidor reiniciou durante a execução.", completedAt: now });
    }
  }
  for (const project of state.projects) {
    if (project.status === "running" || project.status === "planning") project.status = "failed";
  }
  for (const agent of state.agents) {
    if (agent.status === "working" || agent.status === "meeting") {
      Object.assign(agent, { status: "idle", currentTaskId: null });
    }
  }
}
