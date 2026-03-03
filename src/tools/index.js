import { fetchCommitsSchema, fetchCommits } from "./github.js";
import { sendSlackMessageSchema, sendSlackMessage } from "./slack.js";
import { updateJiraTicketSchema, updateJiraTicket } from "./jira.js";

export const tools = [
  { type: "function", function: fetchCommitsSchema },
  { type: "function", function: sendSlackMessageSchema },
  { type: "function", function: updateJiraTicketSchema },
];

export const executeTool = async (name, argsRaw) => {
  const args = JSON.parse(argsRaw);
  console.log(`Executing tool: ${name}`, args);
  switch (name) {
    case "fetch_commits":
      return fetchCommits(args);
    case "send_slack_message":
      return sendSlackMessage(args);
    case "update_jira_ticket":
      return updateJiraTicket(args);
    default:
      throw new Error(`Tool ${name} not found`);
  }
};
