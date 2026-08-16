function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw.toLowerCase() === "true";
}

export type AuthMode = "Development" | "Google";

export type AppConfig = {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  auth: {
    mode: AuthMode;
    devIssuer: string;
    devAudience: string;
    devSigningKey: string;
    googleAuthority: string;
    googleAudience: string;
  };
  recipeHubBaseUrl: string;
  kafka: {
    enabled: boolean;
    brokers: string[];
    topic: string;
    groupId: string;
    clientId: string;
  };
  /** BullMQ workers + optional async plan / ingest enqueue. */
  bullmqEnabled: boolean;
  /** Max age of newest projection before plans are marked projectionStale. */
  projectionStaleAfterMs: number;
};

/**
 * Refuse unsafe defaults when running a production image/deploy.
 * Local Compose may set ALLOW_DEV_AUTH=true with AUTH_MODE=Development.
 */
export function assertRuntimeSafety(
  config: AppConfig,
  opts?: { nodeEnv?: string; allowDevAuth?: boolean },
): void {
  const nodeEnv = opts?.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const allowDevAuth = opts?.allowDevAuth ?? envFlag("ALLOW_DEV_AUTH");
  if (nodeEnv !== "production") return;

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set explicitly when NODE_ENV=production");
  }
  if (config.auth.mode === "Development" && !allowDevAuth) {
    throw new Error(
      "AUTH_MODE=Development is not allowed when NODE_ENV=production (set AUTH_MODE=Google, or ALLOW_DEV_AUTH=true for lab Compose only)",
    );
  }
  if (config.auth.mode === "Google" && !config.auth.googleAudience) {
    throw new Error("AUTH_GOOGLE_AUDIENCE is required when AUTH_MODE=Google");
  }
}

export function loadConfig(): AppConfig {
  const mode = (process.env.AUTH_MODE ?? "Development") as AuthMode;
  if (mode !== "Development" && mode !== "Google") {
    throw new Error(`AUTH_MODE must be Development or Google, got: ${mode}`);
  }

  const brokers = (process.env.KAFKA_BROKERS ?? "localhost:19092")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean);

  const config: AppConfig = {
    port: Number(process.env.PORT ?? "3102"),
    databaseUrl: required(
      "DATABASE_URL",
      "postgres://pantrypilot:pantrypilot@localhost:5434/pantrypilot",
    ),
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
    auth: {
      mode,
      devIssuer: process.env.AUTH_DEV_ISSUER ?? "recipehub-dev",
      devAudience: process.env.AUTH_DEV_AUDIENCE ?? "recipehub",
      devSigningKey:
        process.env.AUTH_DEV_SIGNING_KEY ?? "RecipeHub-Dev-Signing-Key-At-Least-32-Chars!",
      googleAuthority: process.env.AUTH_GOOGLE_AUTHORITY ?? "https://accounts.google.com",
      googleAudience: process.env.AUTH_GOOGLE_AUDIENCE ?? "",
    },
    recipeHubBaseUrl: process.env.RECIPE_HUB_BASE_URL ?? "http://localhost:8080",
    kafka: {
      enabled: envFlag("KAFKA_ENABLED"),
      brokers,
      topic: process.env.KAFKA_TOPIC ?? "lifeatlas.recipes",
      groupId: process.env.KAFKA_GROUP_ID ?? "pantry-pilot",
      clientId: process.env.KAFKA_CLIENT_ID ?? "pantry-pilot",
    },
    bullmqEnabled: envFlag("BULLMQ_ENABLED", true),
    projectionStaleAfterMs: Number(process.env.PROJECTION_STALE_AFTER_MS ?? String(7 * 86400000)),
  };

  assertRuntimeSafety(config);
  return config;
}
