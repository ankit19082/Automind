import { Queue } from "bullmq";
import Redis from "ioredis";
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../.env") });

console.log("Redis Host:", process.env.REDIS_HOST || "localhost");

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
};

const connection = new Redis(redisConfig);
connection.on("error", (err) => console.error("Redis Error:", err));
connection.on("connect", () => console.log("Redis Connected!"));

const taskQueue = new Queue("agentTasks", { connection });

async function checkQueue() {
  console.log("Checking queue status...");
  try {
    const counts = await taskQueue.getJobCounts(
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
    );
    console.log("Queue Counts:", counts);

    const activeJobs = await taskQueue.getJobs(["active"]);
    console.log(
      "Active Jobs:",
      activeJobs.map((j) => ({ id: j.id, data: j.data })),
    );

    const waitingJobs = await taskQueue.getJobs(["waiting"]);
    console.log(
      "Waiting Jobs:",
      waitingJobs.map((j) => ({ id: j.id, data: j.data })),
    );
  } catch (err) {
    console.error("Error checking queue:", err);
  } finally {
    await taskQueue.close();
    await connection.quit();
    process.exit(0);
  }
}

checkQueue();
