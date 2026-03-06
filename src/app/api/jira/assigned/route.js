import { searchJiraTickets } from "@/tools/jira";

export async function GET() {
  try {
    const jql = 'assignee = currentUser() AND status != "Done"';
    const tickets = await searchJiraTickets({ jql });
    return Response.json({ tickets });
  } catch (error) {
    console.error("Failed to fetch assigned JIRA tickets:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
