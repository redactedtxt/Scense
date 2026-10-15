import { z } from "zod";

// Validate env once at startup so a missing variable fails loudly, not mid-request.
// Later milestones add JWT_SECRET, etc.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // The same scoring.yaml the pipeline reads, so note scores and fragrance scores
  // share one set of numbers. Relative to the API's working directory.
  SCORING_CONFIG_PATH: z.string().default("../pipeline/config/scoring.yaml"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
