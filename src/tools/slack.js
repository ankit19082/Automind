export const sendSlackMessageSchema = {
  name: "send_slack_message",
  description: "Sends a message to a specific Slack channel.",
  parameters: {
    type: "object",
    properties: {
      channel: {
        type: "string",
        description: "Slack channel ID or name (e.g., #deployments)",
      },
      msg: {
        type: "string",
        description: "The message to send",
      },
    },
    required: ["channel", "msg"],
  },
};

export const sendSlackMessage = async ({ channel, msg }) => {
  console.log(`[SLACK SIMULATION] Sent to ${channel}: ${msg}`);
  return { success: true, timestamp: new Date().toISOString() };
};
