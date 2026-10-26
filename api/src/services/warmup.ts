import type { AiSettings } from "../config.js";
import type { Db } from "../db.js";
import { addTokens, torontoDay, type Feature } from "./caps.js";
import { EXTRACTION_SCHEMA, reasonsSchema } from "./conciergePrompt.js";
import type { Llm } from "./llm.js";
import { OUTPUT_SCHEMA } from "./prompt.js";
import { PICKS } from "./recommend.js";

// Schema warm-ups (DECISIONS B40). Anthropic compiles each structured-output schema the
// first time it sees it and caches the result for 24 hours after its last use. A call
// that has to compile a cold schema can take long enough to hit the timeout, which is
// what a visitor saw in production. So once at startup and then every LLM_WARMUP_HOURS,
// the API sends one tiny call per schema it uses, with the schema exactly as the real
// calls send it, so the same cache entry stays warm.
//
// Warm-ups belong to no visitor. Their tokens are logged under WARMUP_SUBJECT, which the
// guest cap (it counts 'guest:' subjects only) and every visitor's budget (keyed by the
// visitor's own subject) never see, and which the admin report shows on its own line.

export const WARMUP_SUBJECT = "system:warmup";

export type WarmupSchema = { name: string; feature: Feature; schema: Record<string, unknown> };

// Every schema a real call can send. The pick sentences' schema depends on how many picks
// there are (fewer than 3 when a visitor owns fewer bottles), and each count is its own
// cache entry, so each count gets a warm-up.
export function warmupSchemas(): WarmupSchema[] {
  return [
    { name: "chat", feature: "chat", schema: OUTPUT_SCHEMA },
    { name: "concierge extraction", feature: "concierge", schema: EXTRACTION_SCHEMA },
    ...Array.from({ length: PICKS }, (_, i) => ({
      name: `concierge picks (${i + 1})`,
      feature: "concierge" as const,
      schema: reasonsSchema(i + 1),
    })),
  ];
}

// No key means no model client, and tests never warm anything (vitest.config.ts blanks
// the key too; VITEST is the second lock).
export function warmupsEnabled(ai: AiSettings, env: NodeJS.ProcessEnv = process.env): boolean {
  return ai.apiKey !== "" && ai.warmupIntervalMs > 0 && !env.VITEST && env.NODE_ENV !== "test";
}

// The schema is all that matters; the prompt and the reply are as short as they can be.
// One output token cuts the reply off at once, after the schema has been compiled.
const WARMUP_SYSTEM = "Reply with JSON.";
const WARMUP_MAX_TOKENS = 1;

type Log = { info: (message: string) => void; error: (message: string) => void };

// Warms each schema once and returns the ones that failed. Never throws: a failed call
// or a failed token write is logged and the run carries on.
export async function warmSchemas(
  llm: Llm,
  db: Db,
  schemas: WarmupSchema[],
  now: () => number,
  log: Log,
): Promise<WarmupSchema[]> {
  const failed: WarmupSchema[] = [];
  for (const item of schemas) {
    let tokens: { input: number; output: number };
    try {
      const response = await llm.complete({
        system: WARMUP_SYSTEM,
        messages: [{ role: "user", content: "{}" }],
        schema: item.schema,
        maxTokens: WARMUP_MAX_TOKENS,
      });
      tokens = { input: response.inputTokens, output: response.outputTokens };
    } catch (err) {
      log.error(`Schema warm-up failed for ${item.name}: ${err instanceof Error ? err.message : String(err)}`);
      failed.push(item);
      continue;
    }
    try {
      await addTokens(db, { subject: WARMUP_SUBJECT, feature: item.feature, day: torontoDay(now()) }, tokens);
    } catch (err) {
      // The schema is warm; only the ledger missed it. Not worth another call.
      log.error(`Schema warm-up for ${item.name} could not log its tokens: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const warmed = schemas.length - failed.length;
  log.info(`Schema warm-up: ${warmed} of ${schemas.length} warmed.`);
  return failed;
}

export type WarmupOptions = {
  llm: Llm;
  db: Db;
  schemas: WarmupSchema[];
  intervalMs: number;
  retryMs: number;
  now?: () => number;
  log?: Log;
};

// Warms every schema now (without waiting: startup is never held up) and every
// intervalMs after. Schemas that fail are tried again every retryMs until they succeed or
// the next full run starts. Returns a function that stops all timers. The timers are
// unref'd, so they never keep the process alive on their own.
export function startWarmups(options: WarmupOptions): () => void {
  const { llm, db, schemas, intervalMs, retryMs, now = Date.now, log = console } = options;
  let retry: NodeJS.Timeout | null = null;
  let stopped = false;

  const run = (batch: WarmupSchema[]) => {
    void warmSchemas(llm, db, batch, now, log)
      .then((failed) => {
        if (stopped || failed.length === 0) return;
        retry = setTimeout(() => {
          retry = null;
          run(failed);
        }, retryMs);
        retry.unref();
      })
      .catch((err) => log.error(`Schema warm-up crashed: ${err instanceof Error ? err.message : String(err)}`));
  };

  const fullRun = () => {
    if (retry) clearTimeout(retry);
    retry = null;
    run(schemas);
  };

  fullRun();
  const interval = setInterval(fullRun, intervalMs);
  interval.unref();
  return () => {
    stopped = true;
    clearInterval(interval);
    if (retry) clearTimeout(retry);
  };
}
