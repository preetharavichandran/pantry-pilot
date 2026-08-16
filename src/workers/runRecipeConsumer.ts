import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { migrate } from "../db/migrate.js";
import { createPool } from "../db/pool.js";
import { startRecipeKafkaConsumer } from "./recipeConsumer.js";

async function main() {
  const config = loadConfig();
  if (!config.kafka.enabled) {
    console.error("Set KAFKA_ENABLED=true to run the recipe consumer");
    process.exit(1);
  }
  await migrate(config.databaseUrl);
  const db = createPool(config.databaseUrl);
  const log = {
    info: (o: unknown, msg?: string) => console.log(msg ?? "", o),
    error: (o: unknown, msg?: string) => console.error(msg ?? "", o),
  };
  const consumer = await startRecipeKafkaConsumer(config, db, log);
  if (!consumer) {
    process.exit(1);
  }

  const shutdown = async () => {
    await consumer.stop();
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
