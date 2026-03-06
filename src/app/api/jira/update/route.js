import { updateJiraTicket } from "@/tools/jira";

export async function POST(request) {
  try {
    const { ticketId, status, comment } = await request.json();
    if (!ticketId || !status) {
      return Response.json(
        { error: "Missing ticketId or status" },
        { status: 400 },
      );
    }

    const result = await updateJiraTicket({
      ticketId,
      status,
      comment,
      skipAIEvaluation: true, // Direct update from dashboard
    });

    return Response.json(result);
  } catch (error) {
    console.error("Failed to update JIRA ticket:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
