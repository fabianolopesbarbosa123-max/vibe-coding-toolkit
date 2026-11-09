import "server-only";
import { z } from "zod";
import type { Agent, Provider } from "@/lib/domain";
import { ANTHROPIC_PRICES, FALLBACK_WORST_PRICE, priceFor, type Price } from "@/lib/pricing";

/**
 * Central configuration for AI providers: keys, allowed models, prices, and default
 * per-user limits. Keys live only in server environment variables and never leave
 * this module; the browser only learns whether a provider is available.
 */

const optional = z.string().trim().optional().transform(value => value || undefined);
const optionalNumber = optional.transform(value => (value === undefined ? undefined : Number(value)));
/** Number, or "unlimited" to disable a default limit. */
const limit = (fallback: number) =>
  optional.transform(value => (value === "unlimited" ? null : value === undefined ? fallback : Number(value))).pipe(z.number().nonnegative().nullable());

const schema = z.object({
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_AUTH_TOKEN: optional,
  ANTHROPIC_MODEL: optional.transform(value => value ?? "claude-opus-5-5"),
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: optional,
  OPENAI_INPUT_PRICE_PER_MTOK: optionalNumber.pipe(z.number().nonnegative().optional()),
  OPENAI_OUTPUT_PRICE_PER_MTOK: optionalNumber.pipe(z.number().nonnegative().optional()),
  /** Comma-separated allowlist; defaults to the priced Claude models plus OPENAI_MODEL. */
  OFFICE_ALLOWED_MODELS: optional,
  // Default per-user limits (app defaults, not provider limits). Override per user in public.usage_limits.
  OFFICE_DEFAULT_MONTHLY_BUDGET_USD: limit(10),
  OFFICE_DEFAULT_MONTHLY_TOKEN_LIMIT: limit(2_000_000),
  OFFICE_DEFAULT_DAILY_REQUEST_LIMIT: limit(100),
  OFFICE_DEFAULT_MAX_CONCURRENT_RUNS: limit(2),
  OFFICE_STALE_AFTER_MINUTES: optionalNumber.pipe(z.number().int().min(5).max(240).optional()).transform(value => value ?? 20),
});

export type AiConfig = z.infer<typeof schema> & { allowedModels: Set<string>; openaiPrice: Price | null };

let cached: AiConfig | undefined;

export function getAiConfig(): AiConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid AI configuration: ${parsed.error.issues.map(issue => issue.path.join(".")).join(", ")}`);
  }
  const env = parsed.data;
  const allowed = env.OFFICE_ALLOWED_MODELS
    ? env.OFFICE_ALLOWED_MODELS.split(",").map(model => model.trim()).filter(Boolean)
    : [...Object.keys(ANTHROPIC_PRICES), ...(env.OPENAI_MODEL ? [env.OPENAI_MODEL] : [])];
  const openaiPrice =
    env.OPENAI_INPUT_PRICE_PER_MTOK !== undefined && env.OPENAI_OUTPUT_PRICE_PER_MTOK !== undefined
      ? { input: env.OPENAI_INPUT_PRICE_PER_MTOK, output: env.OPENAI_OUTPUT_PRICE_PER_MTOK }
      : null;
  cached = { ...env, allowedModels: new Set(allowed), openaiPrice };
  return cached;
}

/** Providers this process can call itself (keys present), reported by workers to the database. */
export function configuredProviders(): Provider[] {
  return (["anthropic", "openai"] as const).filter(provider => providerStatus(provider).available);
}

/** Test hook: re-read the environment. */
export function resetAiConfig() {
  cached = undefined;
}

/**
 * Whether a provider can run calls. `remote` (web server in Supabase mode) is the set the
 * queue workers reported, because there the workers hold the keys and make the calls;
 * otherwise the keys in this process's environment decide.
 */
export function providerStatus(provider: Provider, remote?: ReadonlySet<Provider>): { available: boolean; detail: string } {
  const config = getAiConfig();
  if (remote) {
    const name = provider === "anthropic" ? "Claude API" : "OpenAI API";
    return remote.has(provider)
      ? { available: true, detail: `Configurada nos workers de execução (modelo padrão: ${provider === "anthropic" ? config.ANTHROPIC_MODEL : (config.OPENAI_MODEL ?? "—")})` }
      : { available: false, detail: `Nenhum worker com a ${name} configurada foi visto nas últimas 24 h. Configure a chave no worker.` };
  }
  if (provider === "anthropic") {
    return config.ANTHROPIC_API_KEY || config.ANTHROPIC_AUTH_TOKEN
      ? { available: true, detail: `Modelo padrão: ${config.ANTHROPIC_MODEL}` }
      : { available: false, detail: "Defina ANTHROPIC_API_KEY no servidor para ativar a Claude API." };
  }
  if (!config.OPENAI_API_KEY) return { available: false, detail: "Defina OPENAI_API_KEY no servidor." };
  if (!config.OPENAI_MODEL) return { available: false, detail: "Defina OPENAI_MODEL com o modelo autorizado." };
  return { available: true, detail: `Modelo padrão: ${config.OPENAI_MODEL}${config.openaiPrice ? "" : " (sem preço configurado)"}` };
}

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
export const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

/** Output allowance per call; also the bound used for worst-case budget checks. */
export const MAX_OUTPUT_TOKENS = 16000;

export function modelFor(agent: Pick<Agent, "provider" | "model">): string {
  const config = getAiConfig();
  return agent.model ?? (agent.provider === "anthropic" ? config.ANTHROPIC_MODEL : (config.OPENAI_MODEL ?? ""));
}

/**
 * Highest per-token price a call may be billed at: the model's own price or, when the
 * refusal fallback is on, the fallback's price if higher. Null when no price is known.
 */
export function worstPrice(agent: Pick<Agent, "provider" | "model">, promptBytes: number): Price | null {
  const model = modelFor(agent);
  const price = priceFor(agent.provider, model, promptBytes, getAiConfig().openaiPrice);
  if (!price) return null;
  if (agent.provider !== "anthropic" || !FALLBACK_MODELS.has(model)) return price;
  return { input: Math.max(price.input, FALLBACK_WORST_PRICE.input), output: Math.max(price.output, FALLBACK_WORST_PRICE.output) };
}
