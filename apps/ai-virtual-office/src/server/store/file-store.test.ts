import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStore } from "./file-store";

const dirs: string[] = [];
async function tempFile() {
  const dir = await mkdtemp(path.join(tmpdir(), "office-"));
  dirs.push(dir);
  return path.join(dir, "nested", "office.json");
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("FileStore", () => {
  it("seeds the six default agents and persists updates", async () => {
    const file = await tempFile();
    const store = new FileStore(file);
    const state = await store.snapshot();
    expect(state.agents.map(agent => agent.role)).toEqual(["ceo", "programmer", "designer", "marketing", "researcher", "analyst"]);
    await store.update("agents", "agent-ceo", { status: "working" });
    const saved = JSON.parse(await readFile(file, "utf8"));
    expect(saved.agents[0].status).toBe("working");
  });

  it("serializes concurrent writes without losing records", async () => {
    const store = new FileStore(await tempFile());
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.insert("events", { id: `e${index}`, at: "", level: "info", message: String(index), agentId: null, taskId: null, projectId: null }),
      ),
    );
    expect((await store.snapshot()).events).toHaveLength(20);
  });

  it("marks interrupted work as failed after a restart", async () => {
    const file = await tempFile();
    const first = new FileStore(file);
    await first.snapshot();
    await first.insert("tasks", { id: "t1", projectId: null, title: "t", description: "d", agentId: "agent-ceo", priority: "low", status: "running", order: 0, result: null, error: null, createdAt: "", startedAt: "", completedAt: null });
    await first.update("agents", "agent-ceo", { status: "working", currentTaskId: "t1" });
    const restarted = await new FileStore(file).snapshot();
    expect(restarted.tasks[0].status).toBe("failed");
    expect(restarted.agents[0]).toMatchObject({ status: "idle", currentTaskId: null });
  });

  it("returns null when updating a missing record", async () => {
    expect(await new FileStore(await tempFile()).update("tasks", "missing", { title: "x" })).toBeNull();
  });
});
