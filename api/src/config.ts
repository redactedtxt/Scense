import { z } from "zod";

// "true"/"false" from the environment. z.coerce.boolean() would turn the string "false"
// into true (any non-empty string is truthy), so spell the two values out.
const flag = z.enum(["true", "false"]).transform((value) => value === "true");

// The deploy writes every variable into .env, so an unset one can arrive as "" rather
// than missing. z.coerce.number() would read "" as 0 (a guest cap of 0 would close the
// chat to every guest), so treat a blank value as "use the default".
const unsetIfBlank = (value: unknown) => (value === "" ? undefined : value);
const count = (fallback: number) => z.preprocess(unsetIfBlank, z.coerce.number().int().min(0).default(fallback));
const price = (fallback: number) => z.preprocess(unsetIfBlank, z.coerce.number().min(0).default(fallback));
const fraction = (fallback: number) => z.preprocess(unsetIfBlank, z.coerce.number().min(0).max(1).default(fallback));

// The AI settings (M9) are their own schema so tests and createApp can build the
// defaults without a database URL or a JWT secret (aiDefaults below).
const aiSchema = z.object({
  // Blank means "no key": the chat says the assistant is unavailable and the rest of
  // the site works as usual. Tests never set it (vitest.config.ts blanks it).
  ANTHROPIC_API_KEY: z.string().default(""),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-haiku-5-5"),
  LLM_MAX_TOKENS: count(400),
  // A stuck call should fail fast and show the friendly message, not hang the page.
  LLM_TIMEOUT_SECONDS: count(20),
  CHAT_MAX_USER_MESSAGES: count(8),
  // How many earlier messages (user or assistant, each one a turn) go back to the model.
  CHAT_HISTORY_TURNS: count(8),
  CHAT_MESSAGE_MAX_CHARS: count(500),
  CHAT_REPLY_MAX_WORDS: count(120),
  // Chats are deleted this many days after their last message (DECISIONS B36).
  CHAT_RETENTION_DAYS: count(30),
  // An owned bottle is shown as a pick only if it matches the taste profile at least
  // this well (cosine, 0 to 1). Otherwise owning a 41% match would push it to the top.
  CHAT_OWNED_MIN_MATCH: fraction(0.6),
  // Bottles a visitor names in the chat ("my favourite is ...") count as a strong
  // profile update: their profile, scaled so its largest weight is this, merged like
  // the model's update. Weights under CHAT_NAMED_MIN_WEIGHT after scaling are dropped,
  // so a bottle's faint families don't nudge everything. At most CHAT_NAMED_MAX a turn.
  CHAT_NAMED_BOTTLE_WEIGHT: fraction(1),
  CHAT_NAMED_MIN_WEIGHT: fraction(0.25),
  CHAT_NAMED_MAX: count(5),
  // Distinct guests per Toronto day who may use the AI features, not conversations: a
  // guest's new chats never take another slot (DECISIONS B36). The name predates that and
  // is kept so the GitHub secret and server .env need no change.
  GUEST_DAILY_CONVERSATION_CAP: count(100),
  // US dollars per million tokens, for the admin report's cost estimate only.
  // claude-haiku-5-5 list prices on 2026-10-21 (prompts up to 100K tokens).
  LLM_INPUT_USD_PER_MTOK: price(0.1),
  LLM_OUTPUT_USD_PER_MTOK: price(0.5),
  // Blank turns GET /api/admin/usage off entirely.
  ADMIN_TOKEN: z.string().default(""),
});

// Validate env once at startup so a missing variable fails loudly, not mid-request.
// Every tunable number of the auth layer lives here with its default, so changing one
// is an environment edit, not a code change (SPEC section 14).
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  // Comma-separated allowlist; production is exactly https://scense.name.
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // The same scoring.yaml the pipeline reads, so note scores and fragrance scores
  // share one set of numbers. Relative to the API's working directory.
  SCORING_CONFIG_PATH: z.string().default("../pipeline/config/scoring.yaml"),

  // Signs the session cookie. 32 characters is the floor for an HMAC-SHA256 key.
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  // Browsers only send a Secure cookie over HTTPS (localhost excepted). The dev compose
  // file turns it off so the dev server also works when opened by LAN address.
  COOKIE_SECURE: flag.default(true),

  // How many proxies sit in front of the API. Production has exactly one (Caddy), which
  // overwrites X-Forwarded-For with the visitor's address. See DECISIONS B31.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

  LOGIN_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  LOGIN_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  SIGNUP_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  SIGNUP_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(60),

  // Writes per signed-in user (M8). A review write is a POST, PUT, or DELETE; 10 an hour
  // is plenty for a person and stops a script filling pages with reviews. Pair ratings
  // are one small upsert each and people click through several cards, so they get more.
  REVIEW_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  REVIEW_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(60),
  PAIR_RATING_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  PAIR_RATING_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(60),
});

export type Config = z.infer<typeof schema> & z.infer<typeof aiSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return { ...schema.parse(env), ...aiSchema.parse(env) };
}

export type Limit = { max: number; windowMs: number };

// The slice of the config the auth routes, the account routes, and their middleware need.
export type AuthSettings = {
  jwtSecret: string;
  sessionDays: number;
  bcryptCost: number;
  cookieSecure: boolean;
  trustProxyHops: number;
  corsOrigins: string[];
  loginLimit: Limit;
  signupLimit: Limit;
  reviewLimit: Limit;
  pairRatingLimit: Limit;
};

const MINUTE_MS = 60_000;

// The slice of the config the chat, the caps, and the admin report need.
export type AiSettings = {
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
  maxUserMessages: number;
  historyTurns: number;
  messageMaxChars: number;
  replyMaxWords: number;
  retentionDays: number;
  ownedMinMatch: number;
  namedBottleWeight: number;
  namedMinWeight: number;
  namedMax: number;
  guestDailyConversationCap: number;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  adminToken: string;
};

export function aiDefaults(): AiSettings {
  return aiSettings(aiSchema.parse({}));
}

export function aiSettings(config: z.infer<typeof aiSchema>): AiSettings {
  return {
    apiKey: config.ANTHROPIC_API_KEY.trim(),
    model: config.ANTHROPIC_MODEL,
    maxTokens: config.LLM_MAX_TOKENS,
    timeoutMs: config.LLM_TIMEOUT_SECONDS * 1000,
    maxUserMessages: config.CHAT_MAX_USER_MESSAGES,
    historyTurns: config.CHAT_HISTORY_TURNS,
    messageMaxChars: config.CHAT_MESSAGE_MAX_CHARS,
    replyMaxWords: config.CHAT_REPLY_MAX_WORDS,
    retentionDays: config.CHAT_RETENTION_DAYS,
    ownedMinMatch: config.CHAT_OWNED_MIN_MATCH,
    namedBottleWeight: config.CHAT_NAMED_BOTTLE_WEIGHT,
    namedMinWeight: config.CHAT_NAMED_MIN_WEIGHT,
    namedMax: config.CHAT_NAMED_MAX,
    guestDailyConversationCap: config.GUEST_DAILY_CONVERSATION_CAP,
    inputUsdPerMTok: config.LLM_INPUT_USD_PER_MTOK,
    outputUsdPerMTok: config.LLM_OUTPUT_USD_PER_MTOK,
    adminToken: config.ADMIN_TOKEN.trim(),
  };
}

export function authSettings(config: Config): AuthSettings {
  return {
    jwtSecret: config.JWT_SECRET,
    sessionDays: config.SESSION_DAYS,
    bcryptCost: config.BCRYPT_COST,
    cookieSecure: config.COOKIE_SECURE,
    trustProxyHops: config.TRUST_PROXY_HOPS,
    corsOrigins: config.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
    loginLimit: { max: config.LOGIN_LIMIT_MAX, windowMs: config.LOGIN_LIMIT_WINDOW_MINUTES * MINUTE_MS },
    signupLimit: { max: config.SIGNUP_LIMIT_MAX, windowMs: config.SIGNUP_LIMIT_WINDOW_MINUTES * MINUTE_MS },
    reviewLimit: { max: config.REVIEW_LIMIT_MAX, windowMs: config.REVIEW_LIMIT_WINDOW_MINUTES * MINUTE_MS },
    pairRatingLimit: {
      max: config.PAIR_RATING_LIMIT_MAX,
      windowMs: config.PAIR_RATING_LIMIT_WINDOW_MINUTES * MINUTE_MS,
    },
  };
}
