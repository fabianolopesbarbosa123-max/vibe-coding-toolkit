import { describe, expect, it } from "vitest";
import { z } from "zod";
import { assertSameOrigin, HttpError, readJson } from "./http";

const request = (headers: Record<string, string>, body = "{}") =>
  new Request("http://localhost:3000/api/x", { method: "POST", headers, body });

describe("assertSameOrigin", () => {
  it("accepts same-origin JSON requests", () => {
    expect(() => assertSameOrigin(request({ origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" }))).not.toThrow();
  });
  it("rejects cross-site and missing origins", () => {
    for (const origin of ["https://evil.example", "null"]) {
      expect(() => assertSameOrigin(request({ origin, host: "localhost:3000", "content-type": "application/json" }))).toThrow(HttpError);
    }
    expect(() => assertSameOrigin(request({ host: "localhost:3000", "content-type": "application/json" }))).toThrow(HttpError);
  });
  it("rejects non-JSON bodies", () => {
    expect(() => assertSameOrigin(request({ origin: "http://localhost:3000", host: "localhost:3000", "content-type": "text/plain" }))).toThrow(/JSON/);
  });
});

describe("readJson", () => {
  it("returns 422 with field names, not values", async () => {
    const promise = readJson(
      request({ origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" }, JSON.stringify({ name: "" })),
      z.object({ name: z.string().min(1) }),
    );
    await expect(promise).rejects.toMatchObject({ status: 422, message: "Campos inválidos: name" });
  });
});
