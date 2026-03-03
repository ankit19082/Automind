import { Queue } from "bullmq";
import Redis from "ioredis";

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
};

// Next.js fast refresh can cause multiple connections,
// reuse existing in dev.
let connection;
if (globalThis.redisConnection) {
  connection = globalThis.redisConnection;
} else {
  connection = new Redis(redisConfig);
  globalThis.redisConnection = connection;
}

export { connection };

export const taskQueue = new Queue("agentTasks", { connection });
