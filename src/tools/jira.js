export const updateJiraTicketSchema = {
  name: "update_jira_ticket",
  description: "Updates the status or adds a comment to a Jira ticket.",
  parameters: {
    type: "object",
    properties: {
      ticketId: {
        type: "string",
        description: "The ID of the Jira ticket (e.g., PROJ-123)",
      },
      status: {
        type: "string",
        description: "The new status for the ticket (e.g., Done, In Progress)",
      },
      comment: {
        type: "string",
        description: "Optional comment to add to the ticket",
      },
    },
    required: ["ticketId"],
  },
};

export const updateJiraTicket = async ({ ticketId, status, comment }) => {
  console.log(
    `[JIRA SIMULATION] Ticket ${ticketId} updated. Status: ${status}, Comment: ${comment}`,
  );
  return { success: true, ticketId, updated: new Date().toISOString() };
};
