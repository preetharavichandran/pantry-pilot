/**
 * Full Week 2 Kafka E2E:
 * 1) Ensure Redpanda (compose profile kafka)
 * 2) Produce CloudEvents to lifeatlas.recipes
 * 3) Run API with KAFKA_ENABLED=true
 * 4) Wait for projection, then household → plan → shopping
 *
 * Usage: npm run e2e:kafka
 */
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { Kafka, logLevel } from "kafkajs";
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { FIXTURE_IDS, starterProjectionEvents } from "../src/fixtures/recipes.js";
import { mintDevToken, waitUntil } from "../tests/helpers.js";

const execFileAsync = promisify(execFile);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.E2E_PORT ?? "3112";
const base = `http://127.0.0.1:${port}`;
const brokers = (process.env.KAFKA_BROKERS ?? "localhost:19092").split(",");
const topic = process.env.KAFKA_TOPIC ?? "lifeatlas.recipes";
const groupId = `pantry-pilot-e2e-${Date.now()}`;

async function dockerCompose(...args: string[]) {
  await execFileAsync("docker", ["compose", ...args], { cwd: root });
}

async function redpandaReady(): Promise<boolean> {
  try {
    const kafka = new Kafka({
      clientId: "pantry-pilot-e2e-probe",
      brokers,
      logLevel: logLevel.NOTHING,
      connectionTimeout: 2000,
    });
    const admin = kafka.admin();
    await admin.connect();
    await admin.listTopics();
    await admin.disconnect();
    return true;
  } catch {
    return false;
  }
}

async function ensureRedpanda() {
  if (await redpandaReady()) {
    console.log("Redpanda already reachable at", brokers.join(","));
    return;
  }
  console.log("Starting Redpanda via docker compose --profile kafka …");
  await dockerCompose("--profile", "kafka", "up", "-d", "redpanda", "redpanda-init");
  await waitUntil(redpandaReady, { timeoutMs: 90000, intervalMs: 1000, label: "Redpanda" });
  console.log("Redpanda healthy");
}

async function ensureTopic() {
  const kafka = new Kafka({
    clientId: "pantry-pilot-e2e-admin",
    brokers,
    logLevel: logLevel.ERROR,
  });
  const admin = kafka.admin();
  await admin.connect();
  const topics = await admin.listTopics();
  if (!topics.includes(topic)) {
    await admin.createTopics({
      topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
    });
    console.log("created topic", topic);
  }
  await admin.disconnect();
}

async function produceFixtures(prefix: string) {
  const kafka = new Kafka({
    clientId: "pantry-pilot-e2e-producer",
    brokers,
    logLevel: logLevel.ERROR,
  });
  const producer = kafka.producer();
  await producer.connect();
  const events = starterProjectionEvents(prefix);
  for (const event of events) {
    await producer.send({
      topic,
      messages: [
        {
          key: String(event.data.recipeId),
          value: JSON.stringify(event),
          headers: { ce_type: event.type },
        },
      ],
    });
  }
  await producer.disconnect();
  console.log("produced", events.length, "CloudEvents");
}

async function startApi(): Promise<ChildProcess> {
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: port,
      KAFKA_ENABLED: "true",
      KAFKA_BROKERS: brokers.join(","),
      KAFKA_TOPIC: topic,
      KAFKA_GROUP_ID: groupId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (b) => {
    const s = b.toString();
    if (s.includes("error") || s.includes("Kafka")) process.stderr.write(s);
  });
  await waitUntil(async () => {
    try {
      const res = await fetch(`${base}/health`);
      if (!res.ok) return false;
      const body = (await res.json()) as { kafkaEnabled?: boolean };
      return body.kafkaEnabled === true;
    } catch {
      return false;
    }
  }, { timeoutMs: 45000, label: "API with Kafka enabled" });
  return child;
}

async function main() {
  const config = loadConfig();
  await migrate(config.databaseUrl);
  await ensureRedpanda();
  await ensureTopic();

  const prefix = `kafka-e2e-${Date.now()}`;
  const recipeId = FIXTURE_IDS.oatmeal;

  const child = await startApi();
  try {
    await produceFixtures(prefix);

    const db = createPool(config.databaseUrl);
    await waitUntil(async () => {
      const r = await db.query(
        `SELECT 1 FROM recipe_projections WHERE recipe_id = $1 AND deleted_at IS NULL`,
        [recipeId],
      );
      return (r.rowCount ?? 0) > 0;
    }, { timeoutMs: 30000, label: "Kafka projection upsert" });
    console.log("projection visible in DB after Kafka consume");
    await db.end();

    const token = await mintDevToken(`kafka-e2e-${Date.now()}`);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const create = await fetch(`${base}/households`, {
      method: "POST",
      headers,
      body: JSON.stringify({ size: 2, planHorizonDays: 3 }),
    });
    const created = (await create.json()) as { household: { id: string } };
    if (!create.ok) throw new Error(`create ${create.status} ${JSON.stringify(created)}`);
    const id = created.household.id;

    const planRes = await fetch(`${base}/households/${id}/plans`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const planBody = (await planRes.json()) as { meals?: unknown[] };
    console.log("plan", planRes.status, "meals=", planBody.meals?.length);
    if (!planRes.ok) throw new Error(JSON.stringify(planBody));
    if (!planBody.meals || planBody.meals.length < 1) {
      throw new Error("expected meals from Kafka-fed projection");
    }

    console.log("E2E_KAFKA_OK");
  } finally {
    child.kill("SIGTERM");
    await sleep(500);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
