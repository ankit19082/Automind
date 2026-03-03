import { EventEmitter } from "events";

class LogEmitter extends EventEmitter {}

// Global emitter to ensure we don't recreate it on fast refresh
const globalForLogs = global;
if (!globalForLogs.logEmitter) {
  globalForLogs.logEmitter = new LogEmitter();
}

export const logEmitter = globalForLogs.logEmitter;
