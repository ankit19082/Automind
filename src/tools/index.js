import { fetchCommitsSchema, fetchCommits } from "./github.js";
import { sendSlackMessageSchema, sendSlackMessage } from "./slack.js";
import {
  updateJiraTicketSchema,
  updateJiraTicket,
  searchJiraTicketsSchema,
  searchJiraTickets,
} from "./jira.js";
import {
  writeFileSchema,
  writeFile,
  readFileSchema,
  readFile,
  listDirSchema,
  listDir,
} from "./filesystem.js";

export const tools = [
  { type: "function", function: fetchCommitsSchema },
  { type: "function", function: sendSlackMessageSchema },
  { type: "function", function: updateJiraTicketSchema },
  { type: "function", function: searchJiraTicketsSchema },
  { type: "function", function: writeFileSchema },
  { type: "function", function: readFileSchema },
  { type: "function", function: listDirSchema },
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
    case "search_jira_tickets":
      return searchJiraTickets(args);
    case "write_file":
      return writeFile(args);
    case "read_file":
      return readFile(args);
    case "list_dir":
      return listDir(args);
    default:
      throw new Error(`Tool ${name} not found`);
  }
};
