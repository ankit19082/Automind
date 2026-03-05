import Anthropic from "@anthropic-ai/sdk";

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

  const response = await fetch(`${baseUrl}/rest/api/2/issue/${ticketId}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${apiToken}`).toString(
        "base64",
      )}`,
      Accept: "application/json",
    },
  });

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

  let aiDeterminedStatus = status;

  try {
    if (comment) {
      console.log(`[JIRA] Fetching ticket ${ticketId} for AI evaluation...`);
      const ticketDetails = await getJiraTicket(ticketId);

      console.log(
        `[JIRA] Asking AI to evaluate if functionality is complete...`,
      );
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
        baseURL: process.env.ANTHROPIC_BASE_URL,
      });

      const prompt = `You are a technical project manager. 
Ticket Summary: ${ticketDetails.title}
Ticket Description: ${ticketDetails.description}

Comment describing changes/implementation:
${comment}

Check if the content functionality described in the ticket is completely done based on the changes.
If it is fully done, respond with exactly "Human-Review" (without quotes).
If there is still something remaining according to the functionality, respond with exactly "In-Progress" (without quotes).
Do not output anything else.`;

      const response = await anthropic.messages.create({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
        max_tokens: 50,
        messages: [{ role: "user", content: prompt }],
      });

      const aiStatus = response.content[0].text.trim();
      if (
        aiStatus === "Human-Review" ||
        aiStatus === "Humun-Review" ||
        aiStatus === "In-Progress"
      ) {
        aiDeterminedStatus =
          aiStatus === "Humun-Review" ? "Human-Review" : aiStatus;
        console.log(`[JIRA] AI determined status: ${aiDeterminedStatus}`);
      } else {
        console.warn(
          `[JIRA] AI returned unexpected status: ${aiStatus}. Proceeding with original status.`,
        );
      }
    }
  } catch (aiError) {
    console.error(
      `[JIRA] AI status check failed: ${aiError.message}. Using original status.`,
    );
  }

  try {
    // 1. Transition the status if provided
    if (aiDeterminedStatus) {
      const transitionsRes = await fetch(
        `${baseUrl}/rest/api/2/issue/${ticketId}/transitions`,
        { headers },
      );
      if (transitionsRes.ok) {
        const transitionsData = await transitionsRes.json();

        const transition = transitionsData.transitions.find(
          (t) =>
            t.name.toLowerCase() === aiDeterminedStatus.toLowerCase() ||
            t.to.name.toLowerCase() === aiDeterminedStatus.toLowerCase(),
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
              `[JIRA] Failed to transition to '${aiDeterminedStatus}': ${transitionRes.status} ${transitionRes.statusText}`,
            );
          } else {
            console.log(
              `[JIRA] Successfully transitioned ticket ${ticketId} to ${aiDeterminedStatus}`,
            );
          }
        } else {
          console.warn(
            `[JIRA] Warning: Could not find valid transition for '${aiDeterminedStatus}'. Available: ${transitionsData.transitions.map((t) => t.name).join(", ")}`,
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
