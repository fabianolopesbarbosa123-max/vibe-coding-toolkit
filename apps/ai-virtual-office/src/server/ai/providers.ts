import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { Agent, Integration, Provider } from "@/lib/domain";
import { FALLBACK_MODELS, getAiConfig, MAX_OUTPUT_TOKENS, modelFor, providerStatus } from "./config";

export class IntegrationUnavailableError extends Error {
  constructor(readonly provider: Provider, detail: string) {
    super(detail);
    this.name = "IntegrationUnavailableError";
  }
}

export interface BilledUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Generation<T> {
  output: T;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** One entry per billed attempt (e.g. a refusal fallback), each with its own model. */
  billed: BilledUsage[];
}

export { providerStatus } from "./config";

export function listIntegrations(storeKind: "file" | "supabase", remote?: ReadonlySet<Provider>): Integration[] {
  const claude = providerStatus("anthropic", remote);
  const openai = providerStatus("openai", remote);
  return [
    { id: "claude-api", label: "Claude API", status: claude.available ? "available" : "unavailable", detail: claude.detail },
    { id: "openai-api", label: "OpenAI API", status: openai.available ? "available" : "unavailable", detail: openai.detail },
    {
      id: "database",
      label: "Banco de dados",
      status: "available",
      detail: storeKind === "supabase" ? "Supabase (Postgres)" : "Arquivo local .data/ (somente desenvolvimento)",
    },
    { id: "claude-code", label: "Claude Code", status: "planned", detail: "Etapa 3: execução de código em sandbox com aprovação humana." },
    { id: "github", label: "GitHub", status: "planned", detail: "Etapa 4: branches e pull requests via GitHub App." },
  ];
}

function resolveModel(agent: Pick<Agent, "provider" | "model">): string {
  const status = providerStatus(agent.provider);
  if (!status.available) throw new IntegrationUnavailableError(agent.provider, status.detail);
  return modelFor(agent);
}

/** Uses per-attempt usage when the API reports it (fallbacks), else the top-level usage. */
function anthropicBilling(usage: { input_tokens: number; output_tokens: number; iterations?: unknown }, model: string): BilledUsage[] {
  const iterations = Array.isArray(usage.iterations) ? (usage.iterations as Record<string, unknown>[]) : [];
  const billed = iterations
    .filter(entry => typeof entry.input_tokens === "number" && typeof entry.output_tokens === "number")
    .map(entry => ({
      model: typeof entry.model === "string" ? entry.model : model,
      inputTokens: entry.input_tokens as number,
      outputTokens: entry.output_tokens as number,
    }));
  return billed.length ? billed : [{ model, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }];
}

function assertNotRefused(stopReason: string | null) {
  if (stopReason === "refusal") throw new Error("O modelo recusou esta solicitação.");
  if (stopReason === "max_tokens") throw new Error("A resposta excedeu o limite de tokens.");
}

let anthropicClient: Anthropic | undefined;
let openaiClient: OpenAI | undefined;
const anthropic = () =>
  (anthropicClient ??= new Anthropic({ apiKey: getAiConfig().ANTHROPIC_API_KEY ?? null, authToken: getAiConfig().ANTHROPIC_AUTH_TOKEN ?? null }));
const openai = () => (openaiClient ??= new OpenAI({ apiKey: getAiConfig().OPENAI_API_KEY }));

function anthropicExtras(model: string) {
  return FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
}

export async function generateText(
  agent: Pick<Agent, "provider" | "model">,
  system: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<Generation<string>> {
  const model = resolveModel(agent);
  if (agent.provider === "anthropic") {
    const response = await anthropic().beta.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: "user", content: prompt }],
      ...anthropicExtras(model),
    }, { signal });
    assertNotRefused(response.stop_reason);
    const output = response.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("\n").trim();
    return {
      output,
      provider: "anthropic",
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      billed: anthropicBilling(response.usage, response.model),
    };
  }
  const response = await openai().responses.create({ model, instructions: system, input: prompt, max_output_tokens: MAX_OUTPUT_TOKENS }, { signal });
  return {
    output: response.output_text.trim(),
    provider: "openai",
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    billed: [{ model, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 }],
  };
}

export async function generateObject<T extends z.ZodType>(
  agent: Pick<Agent, "provider" | "model">,
  system: string,
  prompt: string,
  schema: T,
  signal?: AbortSignal,
): Promise<Generation<z.infer<T>>> {
  const model = resolveModel(agent);
  if (agent.provider === "anthropic") {
    const response = await anthropic().beta.messages.parse({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: betaZodOutputFormat(schema) },
      ...anthropicExtras(model),
    }, { signal });
    assertNotRefused(response.stop_reason);
    if (!response.parsed_output) throw new Error("O modelo não retornou um plano válido.");
    return {
      output: response.parsed_output as z.infer<T>,
      provider: "anthropic",
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      billed: anthropicBilling(response.usage, response.model),
    };
  }
  const response = await openai().responses.parse({
    model,
    instructions: system,
    input: prompt,
    text: { format: zodTextFormat(schema, "plan") },
    max_output_tokens: MAX_OUTPUT_TOKENS,
  }, { signal });
  if (!response.output_parsed) throw new Error("O modelo não retornou um plano válido.");
  return {
    output: response.output_parsed as z.infer<T>,
    provider: "openai",
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    billed: [{ model, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0 }],
  };
}

/** Transient provider failures worth retrying later: network, rate limit, overload, server errors. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Anthropic.APIUserAbortError || error instanceof OpenAI.APIUserAbortError) return false;
  if (error instanceof Anthropic.APIConnectionError || error instanceof OpenAI.APIConnectionError) return true;
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || (error.status !== undefined && error.status >= 500);
  }
  return false;
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof OpenAI.APIUserAbortError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/** Public, bounded error text. Never includes request bodies or credentials. */
export function describeError(error: unknown): string {
  if (error instanceof IntegrationUnavailableError) return error.message;
  if (isAbortError(error)) return "Execução cancelada ou interrompida pelo tempo limite.";
  if (error instanceof Error && error.name === "BudgetExceededError") return error.message;
  if (error instanceof Anthropic.APIConnectionError || error instanceof OpenAI.APIConnectionError) {
    return "Falha de conexão com o provedor de IA.";
  }
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    const status = error.status ? `HTTP ${error.status}` : "erro";
    if (error.status === 401 || error.status === 403) return `${status}: credencial inválida ou sem permissão.`;
    if (error.status === 429) return `${status}: limite de uso atingido; tente novamente mais tarde.`;
    return `${status} do provedor de IA.`;
  }
  return error instanceof Error ? error.message.slice(0, 300) : "Erro desconhecido.";
}
