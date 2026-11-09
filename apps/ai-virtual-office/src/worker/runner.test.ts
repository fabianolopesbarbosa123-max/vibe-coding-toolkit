import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { IntegrationUnavailableError } from "@/server/ai/providers";
import { HttpError } from "@/server/http";
import { BudgetExceededError } from "@/server/usage";
import { isRetryable, JobFailure } from "./runner";

const apiError = (status: number) => Anthropic.APIError.generate(status, { error: { type: "x", message: "m" } }, "m", new Headers());

describe("isRetryable", () => {
  it("retries transient provider failures", () => {
    expect(isRetryable(apiError(429))).toBe(true);
    expect(isRetryable(apiError(500))).toBe(true);
    expect(isRetryable(apiError(529))).toBe(true);
    expect(isRetryable(new Anthropic.APIConnectionError({ message: "down" }))).toBe(true);
  });
  it("never retries permanent failures", () => {
    expect(isRetryable(apiError(400))).toBe(false);
    expect(isRetryable(apiError(401))).toBe(false);
    expect(isRetryable(new BudgetExceededError("sem orçamento"))).toBe(false);
    expect(isRetryable(new IntegrationUnavailableError("anthropic", "sem chave"))).toBe(false);
    expect(isRetryable(new Anthropic.APIUserAbortError())).toBe(false);
    expect(isRetryable(new HttpError(409, "Tarefa já executada ou em execução."))).toBe(false);
  });
  it("retries a busy agent and honors explicit failures", () => {
    expect(isRetryable(new HttpError(409, "Rafael está ocupado(a) com outra tarefa."))).toBe(true);
    expect(isRetryable(new JobFailure("x", true))).toBe(true);
    expect(isRetryable(new JobFailure("x", false))).toBe(false);
  });
});
