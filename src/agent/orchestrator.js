import OpenAI from "openai";
import { tools, executeTool } from "../tools/index.js";
import { logEmitter } from "../events.js";

const openai = new OpenAI({
  apiKey: "ollama",
  baseURL: process.env.OLLAMA_API_BASE || "http://127.0.0.1:11434/v1",
});

// A simple in-memory task memory system
const taskMemory = new Map();

export const runAgentOrchestrator = async (job) => {
  const { prompt } = job.data;

  const broadcastLog = (msg) => {
    console.log(`[Job ${job.id}] ${msg}`);
    logEmitter.emit("log", job.id, msg);
    if (!taskMemory.has(job.id))
      taskMemory.set(job.id, { status: "running", logs: [] });
    taskMemory.get(job.id).logs.push(msg);
  };

  broadcastLog(`Starting orchestrator with task: "${prompt}"`);

  const messages = [
    {
      role: "system",
      content:
        "You are an autonomous DevOps and Productivity agent. You have access to tools for GitHub, Slack, and Jira.",
    },
    { role: "user", content: prompt },
  ];

  try {
    if (true) {
      const response = await openai.chat.completions.create({
        model: "qwen2.5",
        messages,
        tools,
        tool_choice: "auto",
      });

      const responseMessage = response.choices[0].message;

      if (responseMessage.tool_calls) {
        for (const toolCall of responseMessage.tool_calls) {
          broadcastLog(`Calling tool: ${toolCall.function.name}`);
          await new Promise((r) => setTimeout(r, 1000));
          await executeTool(
            toolCall.function.name,
            toolCall.function.arguments,
          );
          broadcastLog(
            `Tool executed successfully: ${toolCall.function.name}.`,
          );
        }
      }
    } else {
      broadcastLog(
        "No OPENAI_API_KEY found. Running simulated agent interaction workflow.",
      );

      broadcastLog(
        "Thinking: Need to fetch latest commits to prepare release notes.",
      );
      await new Promise((r) => setTimeout(r, 2000));
      await executeTool("fetch_commits", JSON.stringify({ repo: "backend" }));
      broadcastLog("Tool executed: fetch_commits. Got 2 commits.");

      broadcastLog(
        "Thinking: Now generating release notes and notifying Slack.",
      );
      await new Promise((r) => setTimeout(r, 2000));
      await executeTool(
        "send_slack_message",
        JSON.stringify({
          channel: "#deployments",
          msg: "Deployment successful!",
        }),
      );
      broadcastLog("Tool executed: send_slack_message.");

      broadcastLog('Thinking: Updating Jira ticket status to "Done".');
      await new Promise((r) => setTimeout(r, 2000));
      await executeTool(
        "update_jira_ticket",
        JSON.stringify({
          ticketId: "PROJ-123",
          status: "Done",
          comment: "Released",
        }),
      );
      broadcastLog("Tool executed: update_jira_ticket.");
    }

    broadcastLog("Task completed successfully!");
    taskMemory.get(job.id).status = "completed";
    return { success: true, memory: taskMemory.get(job.id) };
  } catch (error) {
    broadcastLog(`Agent Orchestrator Error: ${error.message}`);
    taskMemory.get(job.id).status = "failed";
    console.log("error", error);
    throw error;
  }
};
