import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { migrate } from "./db/migrate.js";
import { createPool } from "./db/pool.js";
import { HttpRecipeHubClient } from "./integrations/recipeHubClient.js";
import { buildApp } from "./api/app.js";
import { startRecipeKafkaConsumer } from "./workers/recipeConsumer.js";
import { closeQueues, createQueues } from "./workers/queues.js";
import { startJobWorkers } from "./workers/jobWorkers.js";

async function main() {
  const config = loadConfig();
  await migrate(config.databaseUrl);
  const db = createPool(config.databaseUrl);
  const recipeHub = new HttpRecipeHubClient(config.recipeHubBaseUrl);
  const queues = config.bullmqEnabled ? createQueues(config) : null;
  const app = await buildApp({ config, db, recipeHub, queues });

  const workers = queues ? startJobWorkers(config, db, app.log) : null;
  const consumer = await startRecipeKafkaConsumer(config, db, app.log, queues);

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    await consumer?.stop();
    await workers?.close();
    if (queues) await closeQueues(queues);
    await db.end();
    process.exit(1);
  }

  const shutdown = async () => {
    await consumer?.stop();
    await workers?.close();
    if (queues) await closeQueues(queues);
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
