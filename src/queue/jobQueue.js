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

// Function to clear all jobs from the queue (all statuses)
export const cleanQueue = async () => {
  try {
    // 1. Remove all waiting jobs
    await taskQueue.drain();

    // 2. Clear out jobs in other states (completed, failed, active, etc.)
    const statuses = ["completed", "failed", "active", "delayed", "paused"];
    for (const status of statuses) {
      await taskQueue.clean(0, 1000, status);
    }

    console.log("Task queue fully cleaned (all statuses).");
    return { success: true };
  } catch (err) {
    console.error("Failed to clean task queue:", err);
    return { success: false, error: err.message };
  }
};
