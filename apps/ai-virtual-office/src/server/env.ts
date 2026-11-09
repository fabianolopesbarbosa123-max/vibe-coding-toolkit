import "server-only";
import { z } from "zod";

const optional = z
  .string()
  .trim()
  .optional()
  .transform(value => value || undefined);

/** Non-AI server settings. AI keys, models, prices, and limits live in ai/config.ts. */
const envSchema = z.object({
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
