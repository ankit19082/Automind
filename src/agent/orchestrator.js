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
  const { prompt, cwd } = job.data;

  const broadcastLog = (msg) => {
    console.log(`[Job ${job.id}] ${msg}`);
    logEmitter.emit("log", job.id, msg);
    if (!taskMemory.has(job.id))
      taskMemory.set(job.id, { status: "running", logs: [] });
    taskMemory.get(job.id).logs.push(msg);
  };

  broadcastLog(`Starting orchestrator with task: "${prompt}"`);
  if (cwd) broadcastLog(`Working directory: ${cwd}`);

  const messages = [
    {
      role: "system",
      content: `You are AutoMind, an autonomous DevOps and Productivity agent. You have access to tools for GitHub, Slack, Jira, and local filesystem manipulation.
Your current working directory is: ${cwd || process.cwd()}

GUIDELINES:
1.  **Project Analysis**: Before making changes to an existing project, always start by exploring the directory structure using 'list_dir' and reading key files using 'read_file' (e.g., package.json, README.md, or relevant source files).
2.  **Context Awareness**: Understand the current code patterns and folder structures before introducing new files or modifications.
3.  **Action**: Once you have sufficient context, perform the requested task using the appropriate tools.
4.  **CWD**: All paths should be relative to the current working directory provided above.`,
    },
    { role: "user", content: prompt },
  ];

  try {
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      broadcastLog(`\n🧠 Thinking (Turn ${iterations}/${MAX_ITERATIONS})...`);

      let response;
      try {
        response = await openai.chat.completions.create({
          model: "qwen2.5",
          messages,
          tools,
          tool_choice: "auto",
        });
      } catch (ollamaErr) {
        broadcastLog(`❌ Ollama Error: ${ollamaErr.message}`);
        throw ollamaErr;
      }

      const responseMessage = response.choices[0].message;
      messages.push(responseMessage);

      if (
        !responseMessage.tool_calls ||
        responseMessage.tool_calls.length === 0
      ) {
        if (responseMessage.content) {
          broadcastLog(`💡 Final Response: ${responseMessage.content}`);
        }
        break;
      }

      broadcastLog(
        `🛠️  The agent wants to use ${responseMessage.tool_calls.length} tool(s).`,
      );

      for (const toolCall of responseMessage.tool_calls) {
        broadcastLog(`👉 Calling tool: ${toolCall.function.name}`);

        let toolArgs;
        try {
          toolArgs = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          toolArgs = toolCall.function.arguments;
        }

        // Inject cwd into tool arguments for filesystem tools
        const fsTools = ["write_file", "read_file", "list_dir"];
        if (fsTools.includes(toolCall.function.name) && cwd && !toolArgs.cwd) {
          toolArgs.cwd = cwd;
        }

        await new Promise((r) => setTimeout(r, 1000));
        let toolResult;
        try {
          toolResult = await executeTool(
            toolCall.function.name,
            JSON.stringify(toolArgs),
          );
          broadcastLog(
            `Tool executed successfully: ${toolCall.function.name}.`,
          );
        } catch (error) {
          toolResult = { error: error.message };
          broadcastLog(
            `Tool failed: ${toolCall.function.name}. Error: ${error.message}`,
          );
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }
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
