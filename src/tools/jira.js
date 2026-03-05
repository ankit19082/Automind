import Anthropic from "@anthropic-ai/sdk";
import readline from "readline";
import http from "http";

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

export const updateJiraTicket = async ({ ticketId, status, comment, diff }) => {
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
    console.log(`[JIRA] Fetching ticket ${ticketId} for AI evaluation...`);
    const ticketDetails = await getJiraTicket(ticketId);

    console.log(`[JIRA] Asking AI to evaluate if functionality is complete...`);
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    });

    const truncatedDiff = diff
      ? diff.length > 10000
        ? diff.substring(0, 10000) + "\n...(truncated)"
        : diff
      : "No direct file changes provided.";

    const prompt = `You are a technical project manager. 
Ticket Summary: ${ticketDetails.title}
Ticket Description: ${ticketDetails.description}

Comment describing changes/implementation:
${comment}

Actual file changes (diff):
${truncatedDiff}

Check if the content functionality described in the ticket is completely done based on the actual file changes and comment.
Respond strictly in JSON format with the following structure:
{
  "status": "Human-Review" | "In Progress",
  "remaining": ["List of things still remaining or missing based on the ticket description, if any"]
}

If it is fully done, respond with "status": "Human-Review" and an empty array for "remaining".
If there is still something remaining according to the functionality, respond with "status": "In Progress" and list the missing things in the "remaining" array.
Output nothing else but the JSON object.`;

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    let aiResponseText = response.content[0].text.trim();
    // Strip markdown formatting if AI wrapped it in ```json
    if (aiResponseText.startsWith("```json")) {
      aiResponseText = aiResponseText
        .replace(/^```json\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
    } else if (aiResponseText.startsWith("```")) {
      aiResponseText = aiResponseText
        .replace(/^```\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
    }

    let aiResult;
    try {
      aiResult = JSON.parse(aiResponseText);
    } catch (parseError) {
      console.warn(
        `[JIRA] Failed to parse AI JSON response. Falling back. Response: ${aiResponseText}`,
      );
      throw new Error("Invalid AI JSON response");
    }

    const aiStatus = aiResult.status;
    const remainingItems = aiResult.remaining || [];

    if (
      aiStatus === "Human-Review" ||
      aiStatus === "Humun-Review" ||
      aiStatus === "In Progress"
    ) {
      aiDeterminedStatus =
        aiStatus === "Humun-Review" ? "Human-Review" : aiStatus;
      console.log(`[JIRA] AI determined status: ${aiDeterminedStatus}`);

      // Construct dynamic comment based on AI evaluation
      // let autoComment = `Automated evaluation from Automind.\n\nSummary of changes:\n${comment || "No explicit comment provided."}`;

      if (aiDeterminedStatus === "In Progress" && remainingItems.length > 0) {
        console.log(
          `\n\n⚠️ AI determined that the following requirements are still remaining or incomplete:\n${remainingItems.map((item) => `- ${item}`).join("\n")}`,
        );

        // Prompt the user to let Automind finish the work
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const finishWorkAnswer = await new Promise((resolve) =>
          rl.question(
            "\n❓ Would you like the AutoMind Agent to attempt to complete these remaining requirements right now? (y/N) ",
            resolve,
          ),
        );
        rl.close();

        if (
          finishWorkAnswer.trim().toLowerCase() === "y" ||
          finishWorkAnswer.trim().toLowerCase() === "yes"
        ) {
          console.log("\n🚀 Generating task for AutoMind Agent...");
          const agentTaskPrompt = `Based on the Jira ticket '${ticketDetails.title}', please implement the following missing requirements:\n${remainingItems.map((item) => `- ${item}`).join("\n")}`;

          const postData = JSON.stringify({
            prompt: agentTaskPrompt,
            cwd: process.cwd(),
          });

          const resolvedPort = parseInt(
            process.env.PORT || process.env.AUTOMIND_PORT || "3001",
          );

          const options = {
            hostname: "localhost",
            port: resolvedPort,
            path: "/api/tasks",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData),
            },
          };

          const req = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              if (res.statusCode === 201) {
                const { jobId } = JSON.parse(data);
                console.log(
                  `✅ AutoMind Task queued successfully (Job ID: ${jobId}). You can check the agent logs to monitor its progress!`,
                );
              } else {
                console.error(
                  `❌ Error submitting Automind task: ${res.statusCode} ${data}`,
                );
              }
            });
          });

          req.on("error", (e) => {
            console.error(
              `\n❌ Failed to connect to AutoMind server to submit the follow-up task. Is the server running? (${e.message})`,
            );
          });

          req.write(postData);
          req.end();
        }
      }
    } else {
      console.warn(
        `[JIRA] AI returned unexpected status: ${aiStatus}. Proceeding with original status.`,
      );
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
