import { searchJiraTickets } from "../tools/jira.js";
import { taskQueue } from "../queue/jobQueue.js";

export class JiraMonitor {
  constructor(intervalMs = 60000) {
    this.intervalMs = intervalMs;
    this.intervalId = null;
    this.processedTicketIds = new Set();
    this.isPolling = false;
  }

  start() {
    if (this.intervalId) return;
    console.log(
      `[JiraMonitor] Starting JIRA monitor (interval: ${this.intervalMs}ms)...`,
    );
    this.poll();
    this.intervalId = setInterval(() => this.poll(), this.intervalMs);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async poll() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const jql = 'assignee = currentUser() AND status = "In Progress"';
      // console.log(`[JiraMonitor] Polling JIRA with JQL: ${jql}`);

      const tickets = await searchJiraTickets({ jql });

      for (const ticket of tickets) {
        if (!this.processedTicketIds.has(ticket.id)) {
          console.log(
            `[JiraMonitor] Found new "In Progress" ticket: ${ticket.id} - ${ticket.title}`,
          );

          // Add to queue
          const prompt = `Please work on JIRA ticket ${ticket.id}: ${ticket.title}. \n\nDescription: ${ticket.description}`;
          await taskQueue.add("agentTasks", {
            prompt,
            cwd: process.cwd(),
            jiraTicketId: ticket.id,
          });

          this.processedTicketIds.add(ticket.id);
        }
      }
    } catch (error) {
      console.error(`[JiraMonitor] Error polling JIRA:`, error.message);
    } finally {
      this.isPolling = false;
    }
  }
}
