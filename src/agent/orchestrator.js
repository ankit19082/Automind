import Anthropic from "@anthropic-ai/sdk";
import { tools, executeTool } from "../tools/index.js";
import { logEmitter } from "../events.js";

// A simple in-memory task memory system
const taskMemory = new Map();

// Helper to convert OpenAI tool format to Anthropic tool format
const anthropicTools = tools.map((t) => ({
  name: t.function.name,
  description: t.function.description,
  input_schema: t.function.parameters,
}));

export const runAgentOrchestrator = async (job) => {
  const { prompt, cwd } = job.data;

  const broadcastLog = (msg, data = {}) => {
    console.log(`[Job ${job.id}] ${msg}`);
    logEmitter.emit("log", job.id, msg, data);
    if (!taskMemory.has(job.id))
      taskMemory.set(job.id, {
        status: "running",
        logs: [],
        modifiedFiles: new Set(),
      });
    taskMemory.get(job.id).logs.push(msg);
  };

  broadcastLog(`Starting orchestrator with task: "${prompt}"`);
  if (cwd) broadcastLog(`Working directory: ${cwd}`);

  const messages = [{ role: "user", content: prompt }];
  const systemPrompt = `You are AutoMind, an autonomous DevOps and Productivity agent. You have access to tools for GitHub, Slack, Jira, and local filesystem manipulation.
Your current working directory is: ${cwd || process.cwd()}

GUIDELINES:
1.  **Project Analysis**: Before making changes to an existing project, always start by exploring the directory structure using 'list_dir' and reading key files using 'read_file' (e.g., package.json, README.md, or relevant source files).
2.  **Context Awareness**: Understand the current code patterns and folder structures before introducing new files or modifications.
3.  **Action**: Once you have sufficient context, perform the requested task using the appropriate tools.
4.  **CWD**: All paths should be relative to the current working directory provided above.`;

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
    baseURL: process.env.ANTHROPIC_BASE_URL,
  });

  try {
    let iterations = 0;
    const MAX_ITERATIONS = 10;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      broadcastLog(`\n🧠 Thinking (Turn ${iterations}/${MAX_ITERATIONS})...`);

      let response;
      try {
        response = await anthropic.messages.create({
          model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
          max_tokens: 4096,
          system: systemPrompt,
          messages,
          tools: anthropicTools,
        });
      } catch (anthropicErr) {
        broadcastLog(`❌ Anthropic Error: ${anthropicErr.message}`);
        throw anthropicErr;
      }

      const responseMessage = response;
      const contentBlocks = responseMessage.content;

      // Filter out tool calls and text content
      const toolCalls = contentBlocks.filter(
        (block) => block.type === "tool_use",
      );
      const textContent = contentBlocks
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      // Add the assistant's response to the conversation
      messages.push({
        role: "assistant",
        content: contentBlocks,
      });

      if (toolCalls.length === 0) {
        if (textContent) {
          broadcastLog(`💡 Final Response: ${textContent}`);
        }
        break;
      }

      broadcastLog(`🛠️  The agent wants to use ${toolCalls.length} tool(s).`);

      const toolResultsMsg = {
        role: "user",
        content: [],
      };

      for (const toolCall of toolCalls) {
        broadcastLog(`👉 Calling tool: ${toolCall.name}`);

        const toolName = toolCall.name;
        let toolArgs = toolCall.input;

        // Inject cwd into tool arguments for filesystem tools
        const fsTools = ["write_file", "read_file", "list_dir"];
        if (fsTools.includes(toolName) && cwd && !toolArgs.cwd) {
          toolArgs.cwd = cwd;
        }

        // Track modified files
        if (toolName === "write_file" && toolArgs.path) {
          taskMemory.get(job.id).modifiedFiles.add(toolArgs.path);
        }

        await new Promise((r) => setTimeout(r, 1000));
        let toolResult;
        try {
          toolResult = await executeTool(toolName, JSON.stringify(toolArgs));
          broadcastLog(`Tool executed successfully: ${toolName}.`);
        } catch (error) {
          toolResult = { error: error.message };
          broadcastLog(`Tool failed: ${toolName}. Error: ${error.message}`);
        }

        toolResultsMsg.content.push({
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      messages.push(toolResultsMsg);
    }

    const memory = taskMemory.get(job.id);
    memory.status = "completed";
    broadcastLog("Task completed successfully!", {
      memory: {
        ...memory,
        modifiedFiles: Array.from(memory.modifiedFiles),
        cwd: cwd || process.cwd(),
      },
    });

    return {
      success: true,
      memory: {
        ...memory,
        modifiedFiles: Array.from(memory.modifiedFiles), // Convert Set to Array for JSON serialization
      },
    };
  } catch (error) {
    broadcastLog(`Agent Orchestrator Error: ${error.message}`);
    if (taskMemory.has(job.id)) {
      taskMemory.get(job.id).status = "failed";
    }
    console.log("error", error);
    throw error;
  }
};
