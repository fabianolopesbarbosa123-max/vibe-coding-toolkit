import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { Agent, Integration, Provider } from "@/lib/domain";
import { getEnv } from "../env";

export class IntegrationUnavailableError extends Error {
  constructor(readonly provider: Provider, detail: string) {
    super(detail);
    this.name = "IntegrationUnavailableError";
  }
}

export interface Generation<T> {
  output: T;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const MAX_TOKENS = 16000;

export function providerStatus(provider: Provider): { available: boolean; detail: string } {
  const env = getEnv();
  if (provider === "anthropic") {
    return env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN
      ? { available: true, detail: `Modelo padrão: ${env.ANTHROPIC_MODEL}` }
      : { available: false, detail: "Defina ANTHROPIC_API_KEY no .env.local para ativar a Claude API." };
  }
  if (!env.OPENAI_API_KEY) return { available: false, detail: "Defina OPENAI_API_KEY no .env.local." };
  if (!env.OPENAI_MODEL) return { available: false, detail: "Defina OPENAI_MODEL com o modelo autorizado." };
  return { available: true, detail: `Modelo padrão: ${env.OPENAI_MODEL}` };
}

export function listIntegrations(storeKind: "file" | "supabase"): Integration[] {
  const claude = providerStatus("anthropic");
  const openai = providerStatus("openai");
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
  const env = getEnv();
  return agent.model ?? (agent.provider === "anthropic" ? env.ANTHROPIC_MODEL : env.OPENAI_MODEL!);
}

function assertNotRefused(stopReason: string | null) {
  if (stopReason === "refusal") throw new Error("O modelo recusou esta solicitação.");
  if (stopReason === "max_tokens") throw new Error("A resposta excedeu o limite de tokens.");
}

let anthropicClient: Anthropic | undefined;
let openaiClient: OpenAI | undefined;
const anthropic = () => (anthropicClient ??= new Anthropic());
const openai = () => (openaiClient ??= new OpenAI({ apiKey: getEnv().OPENAI_API_KEY }));

function anthropicExtras(model: string) {
  return FALLBACK_MODELS.has(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
}

export async function generateText(
  agent: Pick<Agent, "provider" | "model">,
  system: string,
  prompt: string,
): Promise<Generation<string>> {
  const model = resolveModel(agent);
  if (agent.provider === "anthropic") {
    const response = await anthropic().beta.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: prompt }],
      ...anthropicExtras(model),
    });
    assertNotRefused(response.stop_reason);
    const output = response.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("\n").trim();
    return {
      output,
      provider: "anthropic",
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
  const response = await openai().responses.create({ model, instructions: system, input: prompt });
  return {
    output: response.output_text.trim(),
    provider: "openai",
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

export async function generateObject<T extends z.ZodType>(
  agent: Pick<Agent, "provider" | "model">,
  system: string,
  prompt: string,
  schema: T,
): Promise<Generation<z.infer<T>>> {
  const model = resolveModel(agent);
  if (agent.provider === "anthropic") {
    const response = await anthropic().beta.messages.parse({
      model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: betaZodOutputFormat(schema) },
      ...anthropicExtras(model),
    });
    assertNotRefused(response.stop_reason);
    if (!response.parsed_output) throw new Error("O modelo não retornou um plano válido.");
    return {
      output: response.parsed_output as z.infer<T>,
      provider: "anthropic",
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
  const response = await openai().responses.parse({
    model,
    instructions: system,
    input: prompt,
    text: { format: zodTextFormat(schema, "plan") },
  });
  if (!response.output_parsed) throw new Error("O modelo não retornou um plano válido.");
  return {
    output: response.output_parsed as z.infer<T>,
    provider: "openai",
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

/** Public, bounded error text. Never includes request bodies or credentials. */
export function describeError(error: unknown): string {
  if (error instanceof IntegrationUnavailableError) return error.message;
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
