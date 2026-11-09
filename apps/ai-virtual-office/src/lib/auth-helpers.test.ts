import { describe, expect, it } from "vitest";
import { authErrorMessage, passwordProblem } from "./auth-errors";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/tasks?x=1")).toBe("/tasks?x=1");
  });
  it("blocks open redirects and missing values", () => {
    for (const value of ["//evil.example", "/\\evil.example", "https://evil.example", "", null, undefined]) {
      expect(safeNext(value)).toBe("/");
    }
  });
});

describe("passwordProblem", () => {
  it("requires length and character classes", () => {
    expect(passwordProblem("Ab1")).toMatch(/8/);
    expect(passwordProblem("abcdefgh1")).toMatch(/maiúsculas/);
    expect(passwordProblem("Abcdefgh1")).toBeNull();
  });
});

describe("authErrorMessage", () => {
  it("maps known codes and hides unknown details", () => {
    expect(authErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe("E-mail ou senha incorretos.");
    expect(authErrorMessage({ code: "unexpected", message: "db stack trace" })).not.toMatch(/stack/);
    expect(authErrorMessage({ name: "AuthRetryableFetchError" })).toMatch(/conexão/);
  });
});

describe("requestOrigin", () => {
  it("prefers the Host header the browser used", async () => {
    const { requestOrigin } = await import("./safe-next");
    const headers = new Headers({ host: "127.0.0.1:3000" });
    expect(requestOrigin({ headers, nextUrl: new URL("http://localhost:3000/x") })).toBe("http://127.0.0.1:3000");
  });
});
