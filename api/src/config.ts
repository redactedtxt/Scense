import { z } from "zod";

// "true"/"false" from the environment. z.coerce.boolean() would turn the string "false"
// into true (any non-empty string is truthy), so spell the two values out.
const flag = z.enum(["true", "false"]).transform((value) => value === "true");

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
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}

export type Limit = { max: number; windowMs: number };

// The slice of the config the auth routes and middleware need.
export type AuthSettings = {
  jwtSecret: string;
  sessionDays: number;
  bcryptCost: number;
  cookieSecure: boolean;
  trustProxyHops: number;
  corsOrigins: string[];
  loginLimit: Limit;
  signupLimit: Limit;
};

const MINUTE_MS = 60_000;

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
  };
}
