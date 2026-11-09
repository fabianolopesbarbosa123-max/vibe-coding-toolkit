/**
 * Runs against a real Supabase stack (local: `npx supabase start`). The secret key is
 * used only here, to create confirmed test users; the app never uses it.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseStore } from "@/server/store/supabase-store";

const url = process.env.SUPABASE_TEST_URL!;
const publishableKey = process.env.SUPABASE_TEST_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_TEST_SECRET_KEY!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

const admin = createClient(url, secretKey, options);
const anon = createClient(url, publishableKey, options);
const run = Date.now();
const password = "Test-Passw0rd!";

interface TestUser {
  id: string;
  client: SupabaseClient;
  token: string;
}

async function makeUser(label: string): Promise<TestUser> {
  const email = `${label}-${run}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `User ${label}` } });
  if (created.error) throw created.error;
  const client = createClient(url, publishableKey, options);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { id: data.user.id, client, token: data.session.access_token };
}

let a: TestUser;
let b: TestUser;
let storeA: SupabaseStore;
let storeB: SupabaseStore;

beforeAll(async () => {
  [a, b] = await Promise.all([makeUser("a"), makeUser("b")]);
  storeA = new SupabaseStore(a.client, a.id);
  storeB = new SupabaseStore(b.client, b.id);
});

afterAll(async () => {
  for (const user of [a, b]) if (user) await admin.auth.admin.deleteUser(user.id);
});

const project = (name: string) => ({ id: crypto.randomUUID(), name, request: "r", status: "ready" as const, summary: null, result: null, createdAt: new Date().toISOString() });

describe("profiles and settings", () => {
  it("are created by the sign-up trigger and readable only by their owner", async () => {
    const own = await a.client.from("profiles").select("full_name").eq("id", a.id).single();
    expect(own.data?.full_name).toBe("User a");
    const other = await b.client.from("profiles").select("*").eq("id", a.id);
    expect(other.data).toEqual([]);
    const settings = await a.client.from("user_settings").select("auto_run").eq("user_id", a.id).single();
    expect(settings.data?.auto_run).toBe(true);
  });

  it("cannot be inserted or reassigned by users", async () => {
    const insert = await a.client.from("profiles").insert({ id: b.id, full_name: "x" });
    expect(insert.error).not.toBeNull();
    const update = await b.client.from("profiles").update({ full_name: "hacked" }).eq("id", a.id).select();
    expect(update.data).toEqual([]);
  });
});

describe("data isolation", () => {
  it("seeds six agents per user with distinct ids", async () => {
    const [sa, sb] = await Promise.all([storeA.snapshot(), storeB.snapshot()]);
    expect(sa.agents).toHaveLength(6);
    expect(sb.agents).toHaveLength(6);
    expect(sa.agents.map(agent => agent.id)).not.toContain(sb.agents[0].id);
  });

  it("hides, protects, and refuses cross-user rows", async () => {
    const p = project("Projeto da A");
    await storeA.insert("projects", p);
    expect((await storeA.snapshot()).projects.map(item => item.id)).toContain(p.id);
    expect((await storeB.snapshot()).projects).toEqual([]);

    const read = await b.client.from("projects").select("*").eq("id", p.id);
    expect(read.data).toEqual([]);
    const update = await b.client.from("projects").update({ name: "invadido" }).eq("id", p.id).select();
    expect(update.data).toEqual([]);
    const remove = await b.client.from("projects").delete().eq("id", p.id).select();
    expect(remove.data).toEqual([]);
    expect((await a.client.from("projects").select("name").eq("id", p.id).single()).data?.name).toBe("Projeto da A");
  });

  it("rejects rows claiming another owner", async () => {
    const forged = await b.client.from("projects").insert({ ...toRow(project("forjado")), owner_id: a.id });
    expect(forged.error?.code).toBe("42501");
  });

  it("rejects tasks that reference another user's agent or project", async () => {
    const agentOfA = (await storeA.snapshot()).agents[0].id;
    const agentOfB = (await storeB.snapshot()).agents[0].id;
    const projectOfA = (await storeA.snapshot()).projects[0].id;
    const base = { title: "t", description: "d", priority: "low", status: "pending", owner_id: b.id };
    const byAgent = await b.client.from("tasks").insert({ ...base, agent_id: agentOfA });
    expect(byAgent.error?.code).toBe("23503");
    const byProject = await b.client.from("tasks").insert({ ...base, agent_id: agentOfB, project_id: projectOfA });
    expect(byProject.error?.code).toBe("23503");
  });

  it("keeps history append-only", async () => {
    const id = crypto.randomUUID();
    await storeA.insert("events", { id, at: new Date().toISOString(), level: "info", message: "x", agentId: null, taskId: null, projectId: null });
    const update = await a.client.from("activity_events").update({ message: "edited" }).eq("id", id).select();
    expect(update.error).not.toBeNull();
    const remove = await a.client.from("activity_events").delete().eq("id", id);
    expect(remove.error).not.toBeNull();
  });

  it("denies everything to anonymous clients", async () => {
    for (const table of ["profiles", "agents", "projects", "tasks", "activity_events", "files", "agent_messages"]) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }
    const insert = await anon.from("projects").insert(toRow(project("anon")));
    expect(insert.error).not.toBeNull();
  });
});

describe("atomic claims", () => {
  it("let only one concurrent request start an agent", async () => {
    const agentId = (await storeA.snapshot()).agents[1].id;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => storeA.claim("agents", agentId, "status", ["idle"], { status: "working" })),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    await storeA.update("agents", agentId, { status: "idle" });
  });
});

describe("storage", () => {
  it("keeps each user's files private", async () => {
    const path = `${a.id}/${crypto.randomUUID()}/nota.txt`;
    const up = await a.client.storage.from("office-files").upload(path, new Blob(["segredo"], { type: "text/plain" }));
    expect(up.error).toBeNull();
    const steal = await b.client.storage.from("office-files").download(path);
    expect(steal.error).not.toBeNull();
    const plant = await b.client.storage.from("office-files").upload(`${a.id}/x/plant.txt`, new Blob(["x"], { type: "text/plain" }));
    expect(plant.error).not.toBeNull();
    const meta = await b.client.from("files").insert({ owner_id: b.id, name: "x", storage_path: path, mime_type: "text/plain", size_bytes: 1 });
    expect(meta.error).not.toBeNull(); // path must start with the owner's id
    expect((await a.client.storage.from("office-files").download(path)).error).toBeNull();
  });
});

describe("realtime", () => {
  it("delivers a user's changes to their other devices only", async () => {
    const deviceA2 = createClient(url, publishableKey, options);
    const watcherB = createClient(url, publishableKey, options);
    await deviceA2.realtime.setAuth(a.token);
    await watcherB.realtime.setAuth(b.token);
    const seenByA2: string[] = [];
    const seenByB: string[] = [];
    const subscribe = (client: SupabaseClient, seen: string[], name: string) =>
      new Promise<void>((resolve, reject) => {
        client
          .channel(name)
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "projects" }, payload => seen.push((payload.new as { id: string }).id))
          .subscribe(status => (status === "SUBSCRIBED" ? resolve() : status === "CHANNEL_ERROR" ? reject(new Error(status)) : undefined));
      });
    await Promise.all([subscribe(deviceA2, seenByA2, "a2"), subscribe(watcherB, seenByB, "b")]);
    // The change-data-capture worker starts with the first subscription; give it time to attach.
    await new Promise(resolve => setTimeout(resolve, 4000));

    const p = project("tempo real");
    await storeA.insert("projects", p);
    const deadline = Date.now() + 8000;
    while (!seenByA2.includes(p.id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    await new Promise(resolve => setTimeout(resolve, 1000));

    expect(seenByA2).toContain(p.id);
    expect(seenByB).not.toContain(p.id);
    await deviceA2.removeAllChannels();
    await watcherB.removeAllChannels();
  }, 30000);
});

function toRow(record: ReturnType<typeof project>) {
  return { id: record.id, name: record.name, request: record.request, status: record.status };
}
