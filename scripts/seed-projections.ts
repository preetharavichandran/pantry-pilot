/**
 * Seed a minimal RecipeHub-starter-shaped projection without Kafka.
 * Usage: npm run seed:projections
 */
import { loadConfig } from "../src/config.js";
import { migrate } from "../src/db/migrate.js";
import { createPool } from "../src/db/pool.js";
import { starterProjectionEvents } from "../src/fixtures/recipes.js";
import { RecipeEventIngestService } from "../src/integrations/recipeEvents.js";

async function main() {
  const config = loadConfig();
  await migrate(config.databaseUrl);
  const db = createPool(config.databaseUrl);
  const ingest = new RecipeEventIngestService(db);
  for (const event of starterProjectionEvents()) {
    const result = await ingest.applyCloudEvent(event);
    const title = String((event.data as { title?: string }).title ?? event.id);
    console.log(title, result.status);
  }
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
