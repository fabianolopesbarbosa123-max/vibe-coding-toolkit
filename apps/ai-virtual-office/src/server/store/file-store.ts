import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OfficeState } from "@/lib/domain";
import { createSeedState } from "@/lib/seed";
import { EVENT_LIMIT, USAGE_LIMIT, type CollectionName, type Collections, type OfficeStore } from "./types";

/**
 * Single-process JSON store for local development. Writes are serialized and
 * atomic (temp file + rename). Use Supabase for shared or deployed instances.
 */
export class FileStore implements OfficeStore {
  readonly kind = "file" as const;
  private state: OfficeState | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async load(): Promise<OfficeState> {
    if (this.state) return this.state;
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8")) as OfficeState;
      recoverInterrupted(this.state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = createSeedState();
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

  private run<T>(operation: (state: OfficeState) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => operation(await this.load()));
    this.queue = next.catch(() => undefined);
    return next;
  }

  snapshot(): Promise<OfficeState> {
    return this.run(state => structuredClone(state));
  }

  insert<C extends CollectionName>(collection: C, record: Collections[C]): Promise<void> {
    return this.run(async state => {
      const list = state[collection] as Collections[C][];
      list.push(record);
      if (collection === "events" && list.length > EVENT_LIMIT) list.splice(0, list.length - EVENT_LIMIT);
      if (collection === "usage" && list.length > USAGE_LIMIT) list.splice(0, list.length - USAGE_LIMIT);
      await this.persist();
    });
  }

  update<C extends CollectionName>(collection: C, id: string, patch: Partial<Collections[C]>) {
    return this.run(async state => {
      const list = state[collection] as Collections[C][];
      const index = list.findIndex(item => item.id === id);
      if (index === -1) return null;
      list[index] = { ...list[index], ...patch, id };
      await this.persist();
      return structuredClone(list[index]);
    });
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
