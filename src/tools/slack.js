import dotenv from "dotenv";
dotenv.config();

export const sendSlackMessageSchema = {
  name: "send_slack_message",
  description: "Sends a message to a specific Slack channel.",
  parameters: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description:
          "Slack channel ID or name (e.g., #deployments). Defaults to SLACK_DEFAULT_CHANNEL env var.",
      },
      msg: {
        type: "string",
        description: "The message to send",
      },
    },
    required: ["msg"],
  },
};

export const sendSlackMessage = async ({ channel, msg }) => {
  const token = process.env.SLACK_BOT_TOKEN;
  const targetChannel = "#all-auto-mind";

  if (!token || token.startsWith("xoxb-your")) {
    // Simulation mode — no real token set
    console.log(`[SLACK SIMULATION] Sent to ${targetChannel}: ${msg}`);
    return {
      success: true,
      simulated: true,
      timestamp: new Date().toISOString(),
    };
  }

  // Real Slack API call using Web API
  const body = JSON.stringify({ channel: targetChannel, text: msg });

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }

  console.log(`[SLACK] Message sent to ${targetChannel} ✅`);
  return { success: true, channel: data.channel, ts: data.ts };
};
