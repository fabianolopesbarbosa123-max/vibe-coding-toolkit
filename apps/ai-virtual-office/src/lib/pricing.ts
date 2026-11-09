/**
 * First-party Claude API list prices in USD per million tokens, from Anthropic's
 * published pricing (reviewed 2026-10-06). Update this table when prices change;
 * models missing here have no known price and are not allowed by default.
 */
export interface Price {
  input: number;
  output: number;
}

interface TieredPrice extends Price {
  /** Prompts above this many input tokens are billed at `above` rates. */
  threshold?: number;
  above?: Price;
}

export const ANTHROPIC_PRICES: Record<string, TieredPrice> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, threshold: 100_000, above: { input: 0.5, output: 2.5 } },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** The most expensive model the server-side refusal fallback may route to (Claude Opus 4.8). */
export const FALLBACK_WORST_PRICE: Price = ANTHROPIC_PRICES["claude-opus-4-8"];

export function priceFor(provider: "anthropic" | "openai", model: string, inputTokens: number, openaiPrice?: Price | null): Price | null {
  if (provider === "openai") return openaiPrice ?? null;
  const price = ANTHROPIC_PRICES[model];
  if (!price) return null;
  return price.threshold !== undefined && price.above && inputTokens > price.threshold ? price.above : price;
}

export function estimateCostUsd(
  provider: "anthropic" | "openai",
  model: string,
  inputTokens: number,
  outputTokens: number,
  openaiPrice?: Price | null,
): number | null {
  const price = priceFor(provider, model, inputTokens, openaiPrice);
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/**
 * Upper bound of a call's cost before it runs: every UTF-8 byte counted as one input
 * token (a token is never shorter than one byte) plus the full output allowance.
 */
export function worstCaseCostUsd(price: Price, promptBytes: number, maxOutputTokens: number): number {
  return (promptBytes * price.input + maxOutputTokens * price.output) / 1_000_000;
}
