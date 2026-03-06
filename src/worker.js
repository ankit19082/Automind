import { Worker } from "bullmq";
import { connection, cleanQueue } from "./queue/jobQueue.js";
import { runAgentOrchestrator } from "./agent/orchestrator.js";
import { JiraMonitor } from "./services/jiraMonitor.js";

console.log("Automind Background Worker starting...");

// Clean the queue before starting to ensure a fresh state
await cleanQueue();

const worker = new Worker(
  "agentTasks",
  async (job) => {
    return await runAgentOrchestrator(job);
  },
  { connection },
);

// Start JIRA Monitor
const jiraMonitor = new JiraMonitor();
jiraMonitor.start();

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
