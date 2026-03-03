import { Queue } from "bullmq";
import Redis from "ioredis";

const redisConfig = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
};

const cleanQueue = async () => {
  const connection = new Redis(redisConfig);
  const queue = new Queue("agentTasks", { connection });

  console.log("Cleaning queue: agentTasks...");

  await queue.pause();
  await queue.drain();
  await queue.clean(0, 1000, "completed");
  await queue.clean(0, 1000, "failed");
  await queue.clean(0, 1000, "wait");
  await queue.clean(0, 1000, "paused");
  await queue.resume();

  console.log(
    "Queue cleaned successfully! All pending, failed, and completed jobs removed.",
  );
  process.exit(0);
};

cleanQueue().catch((err) => {
  console.error("Failed to clean queue:", err);
  process.exit(1);
});
