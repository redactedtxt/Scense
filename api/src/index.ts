import { createApp } from "./app.js";
import { aiSettings, authSettings, loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { loadCatalogueSettings } from "./services/catalogue.js";
import { anthropicLlm, createAnthropicClient } from "./services/llm.js";
import { loadConciergeSettings } from "./services/occasions.js";
import { loadMatrices } from "./services/scoring.js";
import { startWarmups, warmupSchemas, warmupsEnabled } from "./services/warmup.js";

const config = loadConfig();
const ai = aiSettings(config);
// No key, no model client: the chat shows "unavailable" and everything else runs.
const llm = ai.apiKey
  ? anthropicLlm(createAnthropicClient(ai.apiKey, ai.timeoutMs, ai.baseUrl), ai.model, ai.maxTokens)
  : null;
if (!llm) console.warn("ANTHROPIC_API_KEY is not set: the chat and the concierge will report the assistant as unavailable.");

const db = createPool(config.DATABASE_URL);
const app = createApp(
  db,
  loadMatrices(config.SCORING_CONFIG_PATH),
  loadCatalogueSettings(config.SCORING_CONFIG_PATH),
  authSettings(config),
  Date.now,
  { settings: ai, llm, concierge: loadConciergeSettings(config.OCCASIONS_CONFIG_PATH) },
);

app.listen(config.PORT, () => {
  console.log(`API listening on port ${config.PORT}`);
  // Keeps Anthropic's schema cache warm (DECISIONS B40). Started after listening and
  // never awaited, so a slow or failing warm-up can't hold up startup.
  if (llm && warmupsEnabled(ai)) {
    startWarmups({ llm, db, schemas: warmupSchemas(), intervalMs: ai.warmupIntervalMs, retryMs: ai.warmupRetryMs });
  }
});
