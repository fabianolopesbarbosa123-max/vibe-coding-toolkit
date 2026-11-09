import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.mjs";

/** Integration tests need a running Supabase stack; see docs/quality.md. */
export default mergeConfig(base, defineConfig({ test: { include: ["src/**/*.integration.ts"], testTimeout: 20000 } }));
