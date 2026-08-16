import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRuntimeSafety, type AppConfig } from "../src/config.js";

function baseConfig(overrides?: Partial<AppConfig["auth"]>): AppConfig {
  return {
    port: 3102,
    databaseUrl: "postgres://pantrypilot:pantrypilot@localhost:5434/pantrypilot",
    redisUrl: "redis://localhost:6379",
    auth: {
      mode: "Development",
      devIssuer: "recipehub-dev",
      devAudience: "recipehub",
      devSigningKey: "RecipeHub-Dev-Signing-Key-At-Least-32-Chars!",
      googleAuthority: "https://accounts.google.com",
      googleAudience: "",
      ...overrides,
    },
    recipeHubBaseUrl: "http://localhost:8080",
    kafka: {
      enabled: false,
      brokers: ["localhost:19092"],
      topic: "lifeatlas.recipes",
      groupId: "pantry-pilot",
      clientId: "pantry-pilot",
    },
    bullmqEnabled: true,
    projectionStaleAfterMs: 7 * 86400000,
  };
}

test("production refuses Development auth without ALLOW_DEV_AUTH", () => {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://prod/db";
  try {
    assert.throws(
      () =>
        assertRuntimeSafety(baseConfig(), {
          nodeEnv: "production",
          allowDevAuth: false,
        }),
      /AUTH_MODE=Development/,
    );
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("production allows Development auth when ALLOW_DEV_AUTH", () => {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://prod/db";
  try {
    assert.doesNotThrow(() =>
      assertRuntimeSafety(baseConfig(), {
        nodeEnv: "production",
        allowDevAuth: true,
      }),
    );
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});

test("production Google mode requires audience", () => {
  const prev = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://prod/db";
  try {
    assert.throws(
      () =>
        assertRuntimeSafety(baseConfig({ mode: "Google", googleAudience: "" }), {
          nodeEnv: "production",
          allowDevAuth: false,
        }),
      /AUTH_GOOGLE_AUDIENCE/,
    );
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  }
});
