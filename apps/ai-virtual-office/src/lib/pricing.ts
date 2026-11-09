/** USD per million tokens for first-party Claude API rates. Update when prices change. */
const ANTHROPIC_PRICES: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export interface PriceOverride {
  input: number;
  output: number;
}

export function estimateCostUsd(
  provider: "anthropic" | "openai",
  model: string,
  inputTokens: number,
  outputTokens: number,
  openaiPrice?: PriceOverride | null,
): number | null {
  const price = provider === "anthropic" ? ANTHROPIC_PRICES[model] : openaiPrice;
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
