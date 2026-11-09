import { describe, expect, it } from "vitest";
import { seedAgentId } from "./supabase-store";

describe("seedAgentId", () => {
  it("is a stable UUID per user and role", () => {
    const id = seedAgentId("11111111-1111-1111-1111-111111111111", "ceo");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(seedAgentId("11111111-1111-1111-1111-111111111111", "ceo")).toBe(id);
  });
  it("differs across users and roles", () => {
    const a = seedAgentId("11111111-1111-1111-1111-111111111111", "ceo");
    expect(seedAgentId("22222222-2222-2222-2222-222222222222", "ceo")).not.toBe(a);
    expect(seedAgentId("11111111-1111-1111-1111-111111111111", "analyst")).not.toBe(a);
  });
});
