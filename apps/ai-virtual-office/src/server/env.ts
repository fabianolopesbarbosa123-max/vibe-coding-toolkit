import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .trim()
  .optional()
  .transform(value => value || undefined);
const optionalNumber = optional
  .transform(value => (value === undefined ? undefined : Number(value)))
  .pipe(z.number().nonnegative().optional());

const envSchema = z.object({
  ANTHROPIC_API_KEY: optional,
  ANTHROPIC_AUTH_TOKEN: optional,
  ANTHROPIC_MODEL: optional.transform(value => value ?? "claude-opus-5-5"),
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: optional,
  OPENAI_INPUT_PRICE_PER_MTOK: optionalNumber,
  OPENAI_OUTPUT_PRICE_PER_MTOK: optionalNumber,
  OFFICE_LOCAL_MODE: optional.transform(value => value === "true"),
  OFFICE_DATA_FILE: optional.transform(value => value ?? ".data/office.json"),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

/** Parses the environment once. Errors name the variable, never its value. */
export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const names = parsed.error.issues.map(issue => issue.path.join(".")).join(", ");
    throw new Error(`Invalid environment variables: ${names}`);
  }
  cached = parsed.data;
  return cached;
}
