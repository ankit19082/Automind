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

export const getJiraTicket = async (ticketId) => {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      "Missing JIRA environment variables (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)",
    );
  }

  const response = await fetch(
    `${baseUrl}/rest/api/2/issue/${ticketId}?fields=summary,description,status`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString(
          "base64",
        )}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Jira ticket ${ticketId}: ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();
  const summary = data.fields?.summary || "No Title";
  const description = data.fields?.description || "No description";
  const status = data.fields?.status?.name || "Unknown";

  return {
    id: ticketId,
    title: summary,
    description:
      typeof description === "string"
        ? description
        : JSON.stringify(description),
    status: status,
  };
};

export const updateJiraTicket = async ({ ticketId, status, comment }) => {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_TOKEN;

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      "Missing JIRA environment variables (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)",
    );
  }

  const headers = {
    Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  try {
    // 1. Transition the status if provided
    if (status) {
      const transitionsRes = await fetch(
        `${baseUrl}/rest/api/2/issue/${ticketId}/transitions`,
        { headers },
      );
      if (transitionsRes.ok) {
        const transitionsData = await transitionsRes.json();

        const transition = transitionsData.transitions.find(
          (t) =>
            t.name.toLowerCase() === status.toLowerCase() ||
            t.to.name.toLowerCase() === status.toLowerCase(),
        );

        if (transition) {
          const transitionRes = await fetch(
            `${baseUrl}/rest/api/2/issue/${ticketId}/transitions`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ transition: { id: transition.id } }),
            },
          );

          if (!transitionRes.ok) {
            console.warn(
              `[JIRA] Failed to transition to '${status}': ${transitionRes.status} ${transitionRes.statusText}`,
            );
          } else {
            console.log(
              `[JIRA] Successfully transitioned ticket ${ticketId} to ${status}`,
            );
          }
        } else {
          console.warn(
            `[JIRA] Warning: Could not find valid transition for '${status}'. Available: ${transitionsData.transitions.map((t) => t.name).join(", ")}`,
          );
        }
      }
    }

    // 2. Add comment if provided
    if (comment) {
      const commentRes = await fetch(
        `${baseUrl}/rest/api/2/issue/${ticketId}/comment`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ body: comment }),
        },
      );

      if (!commentRes.ok) {
        console.warn(
          `[JIRA] Failed to add comment: ${commentRes.status} ${commentRes.statusText}`,
        );
      } else {
        console.log(`[JIRA] Successfully added comment to ticket ${ticketId}`);
      }
    }

    return { success: true, ticketId, updated: new Date().toISOString() };
  } catch (error) {
    console.error(`[JIRA] Error updating ticket:`, error.message);
    throw error;
  }
};
