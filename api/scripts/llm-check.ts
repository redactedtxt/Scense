// Diagnostic: one tiny request through the same client the API builds, printing the
// outcome and the error's cause chain. Never prints the key. Run inside the api
// container: `npx tsx scripts/llm-check.ts`. Costs a few tokens.
import { aiSettings, loadConfig } from "../src/config.js";
import { anthropicLlm, causeChain, createAnthropicClient } from "../src/services/llm.js";
import { buildSystemPrompt, OUTPUT_SCHEMA } from "../src/services/prompt.js";
import { emptyProfile } from "../src/services/taste.js";

const ai = aiSettings({ ...loadConfig({ ...process.env, DATABASE_URL: "unused", JWT_SECRET: "x".repeat(32) }) });
console.log(`model=${ai.model} timeoutMs=${ai.timeoutMs} maxTokens=${ai.maxTokens} keyLength=${ai.apiKey.length}`);
const client = createAnthropicClient(ai.apiKey, ai.timeoutMs);
const started = Date.now();
try {
  const res = await client.messages.create({
    model: ai.model,
    max_tokens: 16,
    messages: [{ role: "user", content: "Say ok." }],
  });
  console.log(`ok in ${Date.now() - started} ms: stop=${res.stop_reason} usage=${JSON.stringify(res.usage)}`);
} catch (err) {
  console.log(`failed after ${Date.now() - started} ms: ${causeChain(err)}`);
}

// The real chat request: same system prompt, schema, thinking and effort settings.
for (let attempt = 1; attempt <= 2; attempt++) {
  const t = Date.now();
  try {
    const llm = anthropicLlm(client, ai.model, ai.maxTokens);
    const res = await llm.complete({
      system: buildSystemPrompt(emptyProfile(), ai.replyMaxWords),
      messages: [{ role: "user", content: "I love warm vanilla and campfire smoke." }],
      schema: OUTPUT_SCHEMA,
    });
    console.log(`chat request ${attempt} ok in ${Date.now() - t} ms: stop=${res.stopReason} in=${res.inputTokens} out=${res.outputTokens}`);
    console.log(res.text.slice(0, 300));
  } catch (err) {
    console.log(`chat request ${attempt} failed after ${Date.now() - t} ms: ${causeChain(err)}`);
  }
}
