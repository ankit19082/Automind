import { Worker } from "bullmq";
import { connection } from "./queue/jobQueue.js";
import { runAgentOrchestrator } from "./agent/orchestrator.js";

console.log("Automind Background Worker starting...");

const worker = new Worker(
  "agentTasks",
  async (job) => {
    return await runAgentOrchestrator(job);
  },
  { connection },
);

worker.on("completed", (job) => {
  console.log(`Worker: Job ${job.id} has completed!`);
});

worker.on("failed", (job, err) => {
  console.log(`Worker: Job ${job.id} has failed with ${err.message}`);
});

process.on("SIGINT", async () => {
  await worker.close();
  process.exit(0);
});
