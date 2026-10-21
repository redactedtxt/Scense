import Anthropic from "@anthropic-ai/sdk";

// The one place the API talks to Anthropic. Everything else depends on the small `Llm`
// interface below, so tests hand the app a fake and no test ever reaches the network
// (SPEC section 14: never call the Anthropic API from CI).

export type LlmMessage = { role: "user" | "assistant"; content: string };

export type LlmRequest = {
  system: string;
  messages: LlmMessage[];
  // JSON schema the reply must follow (Anthropic structured outputs).
  schema: Record<string, unknown>;
};

export type LlmResponse = {
  text: string; // "" when the model wrote no text block
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
};

export interface Llm {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

// Anthropic could not answer at all: network down, bad key, the monthly spend limit
// reached, overloaded. The chat shows "unavailable right now" and refunds the message.
export class LlmUnavailableError extends Error {}

// The subset of the SDK client we use, so tests can pass a stand-in for it.
export type MessagesClient = Pick<Anthropic, "messages">;

export function createAnthropicClient(apiKey: string, timeoutMs: number): MessagesClient {
  // One automatic retry covers a brief 429 or 529. More would keep the visitor waiting
  // on a call that is unlikely to succeed; the chat already explains the outage.
  return new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
}

export function anthropicLlm(client: MessagesClient, model: string, maxTokens: number): Llm {
  return {
    async complete({ system, messages, schema }) {
      let response: Anthropic.Message;
      const started = Date.now();
      try {
        response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system,
          messages,
          // Thinking would count against the 400-token cap (SPEC section 10) and could
          // use it all before any JSON appears. Translating words into weights needs
          // none, and Haiku 5.5 accepts "disabled" at low effort.
          thinking: { type: "disabled" },
          output_config: { effort: "low", format: { type: "json_schema", schema } },
        });
      } catch (err) {
        logFailure(err, Date.now() - started);
        throw new LlmUnavailableError("The model could not be reached.");
      }
      return {
        text: response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
        stopReason: response.stop_reason,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    },
  };
}

// The status and error type say what went wrong (a spend limit, a bad key, an outage)
// without printing anything a visitor typed. The elapsed time tells a timeout (about
// LLM_TIMEOUT_SECONDS, twice with the retry) from a refused connection or a DNS failure
// (milliseconds).
function logFailure(err: unknown, elapsedMs: number): void {
  const after = `after ${elapsedMs} ms`;
  if (err instanceof Anthropic.APIConnectionError) {
    // The SDK's own message is generic ("Connection error."); the real reason (DNS,
    // TLS, refused, timeout) sits in the error's cause chain.
    console.error(`Anthropic call failed ${after}: no connection or timed out (${causeChain(err)})`);
  } else if (err instanceof Anthropic.APIError) {
    console.error(`Anthropic call failed ${after}: HTTP ${err.status ?? "?"} ${err.type ?? ""}`.trim());
  } else {
    console.error(`Anthropic call failed ${after}:`, err instanceof Error ? err.message : err);
  }
}

// "fetch failed <- ECONNREFUSED connect ECONNREFUSED 1.2.3.4:443": each cause's name,
// code, and message, up to four deep. Anything shaped like an API key is masked, in case
// a library ever puts request headers into an error message.
export function causeChain(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 4; depth++) {
    const code = (current as { code?: unknown }).code;
    parts.push([current.name, typeof code === "string" ? code : null, current.message].filter(Boolean).join(" "));
    current = current.cause;
  }
  return parts.join(" <- ").replace(/sk-ant-[\w-]+/g, "sk-ant-[redacted]");
}
