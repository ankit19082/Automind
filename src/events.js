import Redis from "ioredis";

const redisConfig = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
};

// Publisher connection
let publisher;
if (globalThis.redisPublisher) {
  publisher = globalThis.redisPublisher;
} else {
  publisher = new Redis(redisConfig);
  globalThis.redisPublisher = publisher;
}

export const logEmitter = {
  emit: (event, jobId, logMsg, data = {}) => {
    if (event === "log") {
      const payload = JSON.stringify({ jobId, logMsg, data });
      publisher.publish("task-logs", payload);
    }
  },
  // Higher level subscribe helper for SSE
  subscribe: (jobId, onLog) => {
    const subscriber = new Redis(redisConfig);

    subscriber.subscribe("task-logs", (err) => {
      if (err) console.error("Failed to subscribe to task-logs:", err);
    });

    subscriber.on("message", (channel, message) => {
      if (channel === "task-logs") {
        const { jobId: msgJobId, logMsg, data } = JSON.parse(message);
        if (String(msgJobId) === String(jobId)) {
          onLog(msgJobId, logMsg, data);
        }
      }
    });

    return () => {
      subscriber.unsubscribe();
      subscriber.quit();
    };
  },
};
