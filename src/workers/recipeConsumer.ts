import { Kafka, logLevel, type Consumer } from "kafkajs";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { RecipeEventIngestService } from "../integrations/recipeEvents.js";
import type { JobQueues } from "./queues.js";

export type RecipeConsumerHandle = {
  stop: () => Promise<void>;
};

export async function startRecipeKafkaConsumer(
  config: AppConfig,
  db: Pool,
  log: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void },
  queues: JobQueues | null = null,
): Promise<RecipeConsumerHandle | null> {
  if (!config.kafka.enabled) {
    log.info("Kafka consumer disabled (KAFKA_ENABLED!=true)");
    return null;
  }

  const ingest = new RecipeEventIngestService(db);
  const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers,
    logLevel: logLevel.ERROR,
  });

  const consumer: Consumer = kafka.consumer({ groupId: config.kafka.groupId });
  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.topic, fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const raw = JSON.parse(message.value.toString("utf8")) as unknown;
      try {
        if (queues) {
          await queues.recipeIngest.add(
            "kafka-event",
            { cloudEvent: raw },
            { removeOnComplete: 200, removeOnFail: 100 },
          );
          log.info("recipe event enqueued to BullMQ");
          return;
        }
        const result = await ingest.applyCloudEvent(raw);
        log.info({ result }, "recipe event processed");
      } catch (err) {
        log.error({ err }, "failed to process recipe event");
        throw err;
      }
    },
  });

  log.info(
    {
      brokers: config.kafka.brokers,
      topic: config.kafka.topic,
      groupId: config.kafka.groupId,
      viaBullMq: !!queues,
    },
    "Kafka recipe consumer started",
  );

  return {
    stop: async () => {
      await consumer.disconnect();
    },
  };
}
