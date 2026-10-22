// A stand-in for the Anthropic Messages API, for the Playwright smoke tests (M11).
//
// The API under test runs unchanged, with ANTHROPIC_BASE_URL pointing here, so the real
// llm.ts, caps, reply guard, and recommendation code all run, and nothing is billed
// (SPEC section 14: never call Anthropic from CI). It answers the three kinds of call
// the API makes, told apart by the JSON schema the API asks for:
//   - the chat (schema has "reply"): a taste update and ready_to_recommend, so picks show;
//   - the concierge's slot reading (schema has "slots"): fills a slot only when the
//     visitor's words contain a known phrase, with that phrase as the evidence quote,
//     the way the real model must (DECISIONS B37);
//   - the concierge's one sentence per pick (anything else): a plain sentence per key.
// GET /_calls returns how many calls of each kind it has answered.
//
//   node e2e/mock-anthropic.mjs            (port 4010, or MOCK_ANTHROPIC_PORT)
import { createServer } from "node:http";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 4010);
const calls = { chat: 0, slots: 0, reasons: 0 };

// Phrase in the visitor's message -> [slot, value]. Only what the smoke test types.
const SLOT_PHRASES = [
  ["date night", "occasion", "date_night"],
  ["at 8", "time_of_day", "night"],
  ["winter", "season", "winter"],
  ["terrace", "setting", "outdoor"],
  ["subtle", "projection", "low"],
];
const SLOT_NAMES = ["occasion", "time_of_day", "season", "setting", "projection"];

function chatAnswer() {
  return {
    reply: "That sounds like warm Woody Amber with a spicy edge and a little sweetness.",
    profile_update: { families: { "Woody Amber": 0.8, Amber: 0.4 }, facets: { spicy: 0.5, sweet: 0.3 } },
    summary: "You lean toward warm, spicy, slightly sweet scents.",
    mentioned_fragrances: [],
    ready_to_recommend: true,
  };
}

function slotsAnswer(said) {
  const text = said.toLowerCase();
  const slots = Object.fromEntries(SLOT_NAMES.map((name) => [name, { value: null, evidence: "" }]));
  for (const [phrase, slot, value] of SLOT_PHRASES) {
    if (text.includes(phrase)) slots[slot] = { value, evidence: phrase };
  }
  const next = SLOT_NAMES.find((name) => slots[name].value === null) ?? null;
  return { slots, next_question: "", question_slot: next };
}

function reasonsAnswer(schema) {
  const keys = Object.keys(schema?.properties ?? {});
  return Object.fromEntries(keys.map((key) => [key, "Easy to wear for this outing."]));
}

function answerFor(body) {
  const schema = body.output_config?.format?.schema;
  const properties = schema?.properties ?? {};
  if ("reply" in properties) {
    calls.chat++;
    return chatAnswer();
  }
  if ("slots" in properties) {
    calls.slots++;
    return slotsAnswer(String(body.messages?.at(-1)?.content ?? ""));
  }
  calls.reasons++;
  return reasonsAnswer(schema);
}

// The Message object the SDK expects back (only the fields llm.ts reads, plus the ids).
function message(model, payload) {
  return {
    id: `msg_mock_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: JSON.stringify(payload) }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 500, output_tokens: 80 },
  };
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/_calls") return send(res, 200, calls);
  if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
    return send(res, 404, { type: "error", error: { type: "not_found_error", message: req.url } });
  }
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    try {
      const body = JSON.parse(raw);
      send(res, 200, message(body.model, answerFor(body)));
    } catch (err) {
      send(res, 400, { type: "error", error: { type: "invalid_request_error", message: String(err) } });
    }
  });
});

server.listen(port, () => console.log(`mock Anthropic listening on port ${port}`));
