#!/usr/bin/env node
import { Command } from "commander";
import http from "http";
import { execSync } from "child_process";
import { Codex } from "@openai/codex-sdk";
import { fileURLToPath } from "url";
import path from "path";
import { config } from "dotenv";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "fs";
import os from "os";
import readline from "readline";
import Anthropic from "@anthropic-ai/sdk";
import { getJiraTicket, updateJiraTicket } from "../src/tools/jira.js";

class Spinner {
  constructor(message = "Agent is working") {
    this.message = message;
    this.frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this.currentFrame = 0;
    this.interval = null;
  }

  start() {
    process.stdout.write("\x1B[?25l"); // Hide cursor
    this.interval = setInterval(() => {
      process.stdout.write(
        `\r\x1b[36m${this.frames[this.currentFrame]}\x1b[0m ${this.message}...`,
      );
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }, 80);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write("\r\x1B[K"); // Clear line
      process.stdout.write("\x1B[?25h"); // Show cursor
    }
  }
}

const spinner = new Spinner();

// Load .env from the Automind project directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env") });

const program = new Command();
const PORT = parseInt(process.env.AUTOMIND_PORT || "3000");

program
  .name("automind")
  .description("AI DevOps/Productivity Agent CLI")
  .version("1.0.0");

// ─── task command ─────────────────────────────────────────────────────────────
program
  .command("task <prompt>")
  .description("Submit a task to the AutoMind Agent")
  .action(async (prompt) => {
    console.log(`\n🤖 AutoMind Agent`);
    console.log(`📋 Task: "${prompt}"`);
    console.log(`🔗 Connecting to http://localhost:${PORT}...\n`);

    const postData = JSON.stringify({ prompt, cwd: process.cwd() });
    const options = {
      hostname: "localhost",
      port: PORT,
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
          console.log(`✅ Task queued (Job ID: ${jobId})`);
          spinner.start();
          streamLogs(jobId);
        } else {
          console.error(`❌ Error submitting task: ${res.statusCode} ${data}`);
        }
      });
    });

    req.on("error", (e) => {
      console.error(
        `\n❌ Connection Error. Is the AutoMind server running?\n` +
          `   Try: npm run dev (in the Automind project folder)\n` +
          `   Or set a custom port: AUTOMIND_PORT=3001 automind task "..."\n\n` +
          `   System Error: ${e.message}`,
      );
    });

    req.write(postData);
    req.end();

    // Watchdog to check if logs start within a reasonable time
    setTimeout(() => {
      if (spinner.interval) {
        spinner.stop();
        console.warn(
          `\n⚠️  Stall detected: No logs received after 10s.\n` +
            `   Is the worker running? Try: node src/worker.js\n` +
            `   The agent might be taking a long time to "think" with Anthropic.\n`,
        );
        spinner.start();
      }
    }, 10000);
  });

// ─── clean command ────────────────────────────────────────────────────────────
program
  .command("clean")
  .description("Clear all pending/waiting tasks from the agent queue")
  .action(async () => {
    console.log(`\n🧹 Cleaning AutoMind Queue...`);
    const options = {
      hostname: "localhost",
      port: PORT,
      path: "/api/tasks/clean",
      method: "POST",
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          console.log(`✅ Queue cleared successfully.`);
        } else {
          console.error(`❌ Error cleaning queue: ${res.statusCode} ${data}`);
        }
      });
    });

    req.on("error", (e) => {
      console.error(`\n❌ Connection Error: ${e.message}`);
    });

    req.end();
  });

// ─── jira command ─────────────────────────────────────────────────────────────
program
  .command("jira <ticketId>")
  .description("Update Jira ticket status")
  .action(async (ticketId) => {
    console.log("\n🤖 AutoMind Jira Update\n");
    console.log(`Updating Jira ticket ${ticketId}`);
    const ticket = await getJiraTicket(ticketId);
    console.log(ticket);
  });
// ─── pull command ─────────────────────────────────────────────────────────────
program
  .command("pull")
  .description("Pull latest changes from the remote repository")
  .action(() => {
    console.log("\n🤖 AutoMind Git Pull\n");

    try {
      // 1. Verify git repo
      execSync("git rev-parse --git-dir", { stdio: "ignore" });

      console.log("📥 Pulling changes...");
      const output = execSync("git pull", { encoding: "utf-8" });
      console.log(output);
      console.log("✅ Pull successful.");
    } catch (error) {
      if (error.message.includes("Not inside a git repository")) {
        console.error("❌ Not inside a git repository.");
      } else {
        console.error(`❌ Pull failed: ${error.message}`);
      }
      process.exit(1);
    }
  });

// ─── push command ─────────────────────────────────────────────────────────────
program
  .command("push")
  .description("Auto-generate commit message from staged changes and push")
  .description("Analyzes changes, commits, and pushes to remote")
  .option("--dry-run", "Show the commit message without actually committing")
  .option("--no-slack", "Skip Slack notification after push")
  .option("--cwd <path>", "Working directory for the git operations")
  .action(async (opts) => {
    await handlePush(opts);
  });

async function handlePush(opts) {
  const workingDir = opts.cwd || process.cwd();
  console.log(`\n🤖 AutoMind Git Push (Dir: ${workingDir})\n`);

  // 1. Verify git repo
  try {
    execSync("git rev-parse --git-dir", { stdio: "ignore", cwd: workingDir });
  } catch {
    console.error("❌ Not inside a git repository.");
    return;
  }

  // 2. Stage all if nothing explicitly staged
  let diff = execSync("git diff --staged", {
    encoding: "utf-8",
    cwd: workingDir,
  });
  if (!diff.trim()) {
    console.log(
      "ℹ️  No staged changes found. Staging all modified/new files...",
    );
    execSync("git add .", { stdio: "inherit", cwd: workingDir });
    diff = execSync("git diff --staged", {
      encoding: "utf-8",
      cwd: workingDir,
    });
  }

  if (!diff.trim()) {
    console.log("✅ Nothing to commit. Working tree is clean.");
    process.exit(0);
  }

  // 3. Show summary of staged files
  const statusLines = execSync("git status --short", {
    encoding: "utf-8",
    cwd: workingDir,
  }).trim();
  console.log("📁 Staged changes:");
  console.log(
    statusLines
      .split("\n")
      .map((l) => `   ${l}`)
      .join("\n"),
  );
  console.log("");

  // 4. Generate commit message
  let commitMessage = "";

  // Try Ollama (KiloCode) first
  try {
    const trimmedDiff =
      diff.length > 8000 ? diff.substring(0, 8000) + "\n...(truncated)" : diff;

    commitMessage = await generateAIResponse(
      "You are an expert developer analyzing a git diff. First, mentally review the changes file-by-file to understand exactly what type of change was made in each file. Then, generate a concise git commit message based on your analysis. Always generate the commit message in clear, professional English. First line: a short summary (max 72 chars) using the appropriate type prefix. Then a blank line. Then 2-4 bullet points describing the specific changes made, grouping them logically if possible. Respond with ONLY the final commit message, with no extra explanation or reasoning.",
      trimmedDiff,
      "🧠 Analyzing changes",
    );
  } catch (e) {
    console.warn(
      `⚠️  AI error, using smart fallback: ${e.message.split("\n")[0]}`,
    );
  }

  // Smart fallback: parse the actual diff content
  if (!commitMessage) {
    commitMessage = buildCommitMessageFromDiff(diff);
  }

  console.log("\n📝 Commit message:\n");
  console.log("   " + commitMessage.replace(/\n/g, "\n   "));
  console.log("");

  if (opts.dryRun) {
    console.log("ℹ️  Dry run mode — skipping commit and push.");
    process.exit(0);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) =>
    rl.question(
      "❓ Do you want to commit and push with this message? (y/N) ",
      resolve,
    ),
  );
  rl.close();

  if (
    answer.trim().toLowerCase() !== "y" &&
    answer.trim().toLowerCase() !== "yes"
  ) {
    console.log("\n🚫 Commit aborted by user.\n");
    process.exit(0);
  }

  // 5. Commit using temp file (preserves multi-line messages perfectly)
  const tmpFile = path.join(os.tmpdir(), `automind-commit-${Date.now()}.txt`);
  try {
    writeFileSync(tmpFile, commitMessage, "utf-8");
    execSync(`git commit -F ${JSON.stringify(tmpFile)}`, {
      stdio: "inherit",
      cwd: workingDir,
    });
    unlinkSync(tmpFile);
    console.log("");
  } catch (e) {
    try {
      unlinkSync(tmpFile);
    } catch {}
    console.error(`❌ Commit failed: ${e.message}`);
    return;
  }

  // 6. Get commit hash for Slack notification
  const commitHash = execSync("git rev-parse --short HEAD", {
    encoding: "utf-8",
    cwd: workingDir,
  }).trim();
  const branch = execSync("git rev-parse --abbrev-ref HEAD", {
    encoding: "utf-8",
    cwd: workingDir,
  }).trim();

  // 7. Push to remote
  console.log("🚀 Pushing to remote...");
  try {
    const remotes = execSync("git remote", {
      encoding: "utf-8",
      cwd: workingDir,
    }).trim();
    if (!remotes) {
      console.log("⚠️  No git remote configured. Commit was saved locally.");
      console.log("   To push: git remote add origin <your-repo-url>");
      return;
    }
    execSync("git push", { stdio: "inherit", cwd: workingDir });
    console.log("\n✅ Successfully pushed to remote!");
  } catch (e) {
    console.error(`❌ Push failed: ${e.message}`);
    return;
  }

  // 6. Optional interactive prompt for daily client update
  if (!opts.noSlack && commitMessage) {
    const rlUpdatePrompt = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const generateUpdateAnswer = await new Promise((resolve) =>
      rlUpdatePrompt.question(
        "❓ Do you want to generate a daily update message for the client using AI? (y/N) ",
        resolve,
      ),
    );
    rlUpdatePrompt.close();

    if (
      generateUpdateAnswer.trim().toLowerCase() === "y" ||
      generateUpdateAnswer.trim().toLowerCase() === "yes"
    ) {
      let updateSummary = commitMessage; // fallback

      // Generate full summary using AI
      try {
        const trimmedDiff =
          diff.length > 8000
            ? diff.substring(0, 8000) + "\n...(truncated)"
            : diff;

        updateSummary = await generateAIResponse(
          "You are an expert developer communicating with a client. Based on the provided git diff, generate a professional daily update message about the work completed today. Summarize what was accomplished in this push in a clear, business-friendly, and positive tone. Focus on the progress made, features added, or issues resolved rather than technical implementation details. Use a readable, bulleted format. Do not include raw code or git diff formatting.",
          trimmedDiff,
          "🧠 Generating daily update for client",
        );
      } catch (e) {
        console.warn(
          `⚠️  Failed to generate daily client update: ${e.message.split("\n")[0]}`,
        );
      }

      console.log("\n💬 Daily Client Update Preview:\n");
      console.log("   " + updateSummary.replace(/\n/g, "\n   "));
      console.log("");

      const rl2 = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const sendUpdateAnswer = await new Promise((resolve) =>
        rl2.question(
          "❓ Do you want to send this update to the predefined Slack channel? (y/N) ",
          resolve,
        ),
      );
      rl2.close();

      if (
        sendUpdateAnswer.trim().toLowerCase() === "y" ||
        sendUpdateAnswer.trim().toLowerCase() === "yes"
      ) {
        await sendSlackNotification(updateSummary);
        console.log("✅ Message sent to Slack.\n");
      } else {
        console.log("\n🚫 Sending skipped.\n");
      }

      await handleJiraUpdate({
        commitMessage,
        branch,
        slackSummary: updateSummary,
        diff,
      });
    } else {
      console.log("\n🚫 Client update generation skipped.\n");
      await handleJiraUpdate({
        commitMessage,
        branch,
        slackSummary: commitMessage,
        diff,
      });
    }
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Parses the git diff to build a meaningful Conventional Commit message
 * without needing OpenAI.
 */
function buildCommitMessageFromDiff(diff) {
  const files = execSync("git diff --staged --name-only", { encoding: "utf-8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  const fileCount = files.length;

  // Count additions/deletions
  const addedLines = (diff.match(/^\+[^+]/gm) || []).length;
  const removedLines = (diff.match(/^-[^-]/gm) || []).length;

  // Extract newly added/removed function/method names from the diff
  const addedFunctions = [
    ...new Set(
      (
        diff.match(
          /^\+.*(?:function |const |class |def |async |export (?:function|const|class|default))(\w+)/gm,
        ) || []
      )
        .map(
          (l) =>
            l.match(
              /(?:function |const |class |def |async |export (?:function|const|class|default) *)(\w+)/,
            )?.[1],
        )
        .filter(Boolean),
    ),
  ].slice(0, 4);

  const removedFunctions = [
    ...new Set(
      (diff.match(/^-.*(?:function |const |class |def )(\w+)/gm) || [])
        .map((l) => l.match(/(?:function |const |class |def )(\w+)/)?.[1])
        .filter(Boolean),
    ),
  ].slice(0, 3);

  // New files vs modified files
  const newFiles = execSync("git diff --staged --diff-filter=A --name-only", {
    encoding: "utf-8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const modifiedFiles = execSync(
    "git diff --staged --diff-filter=M --name-only",
    { encoding: "utf-8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const deletedFiles = execSync(
    "git diff --staged --diff-filter=D --name-only",
    { encoding: "utf-8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);

  // Determine commit type
  const hasFix =
    diff.includes("fix") ||
    diff.includes("bug") ||
    diff.includes("error") ||
    files.some((f) => f.includes("fix"));
  const hasDocs = files.every((f) => /\.(md|txt|rst)$/.test(f));
  const hasTests = files.some((f) => /test|spec/.test(f));
  const hasStyle = files.some((f) => /\.(css|scss|less)$/.test(f));
  const isOnlyNew = newFiles.length === fileCount;

  // Detect scope from most common directory
  const dirs = [
    ...new Set(
      files.map((f) => f.split("/")[0]).filter((d) => !d.includes(".")),
    ),
  ].slice(0, 2);
  const scope = dirs.length ? `(${dirs.join(", ")})` : "";

  let type;
  if (hasDocs) type = "docs";
  else if (hasTests) type = "test";
  else if (hasStyle) type = "style";
  else if (hasFix) type = "fix";
  else if (isOnlyNew) type = "feat";
  else type = "refactor";

  // Build summary line
  let summary = "";
  if (addedFunctions.length) {
    summary = `${type}${scope}: add ${addedFunctions.join(", ")}`;
  } else if (modifiedFiles.length && !isOnlyNew) {
    summary = `${type}${scope}: update ${fileCount} file${fileCount > 1 ? "s" : ""}`;
  } else {
    summary = `${type}${scope}: add ${fileCount} new file${fileCount > 1 ? "s" : ""}`;
  }

  // Build detail bullets
  const bullets = [];
  if (newFiles.length)
    bullets.push(`- Add: ${newFiles.slice(0, 3).join(", ")}`);
  if (modifiedFiles.length)
    bullets.push(`- Modify: ${modifiedFiles.slice(0, 3).join(", ")}`);
  if (deletedFiles.length)
    bullets.push(`- Remove: ${deletedFiles.slice(0, 2).join(", ")}`);
  if (addedFunctions.length)
    bullets.push(`- New exports: ${addedFunctions.join(", ")}`);
  if (removedFunctions.length)
    bullets.push(`- Removed: ${removedFunctions.join(", ")}`);
  bullets.push(`- ${addedLines} additions, ${removedLines} deletions`);

  return `${summary}\n\n${bullets.join("\n")}`;
}

/**
 * Sends a Slack notification after a successful push.
 */
async function sendSlackPushNotification({
  slackSummary,
  commitHash,
  branch,
  statusLines,
}) {
  const token = process.env.SLACK_BOT_TOKEN;
  const channel = "#general";

  if (!token || token.startsWith("xoxb-your")) {
    console.log("ℹ️  Slack token not set — skipping Slack notification.");
    return;
  }

  const fileList = statusLines
    .split("\n")
    .map((l) => `• ${l.trim()}`)
    .join("\n");

  // Get repo URL if available
  let repoUrl = "";
  try {
    const remote = execSync("git remote get-url origin", {
      encoding: "utf-8",
    }).trim();
    repoUrl = remote
      .replace("git@github.com:", "https://github.com/")
      .replace(/\.git$/, "");
  } catch {}

  const text = `*Changes summary:*\n${slackSummary}\n\n`;

  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text, mrkdwn: true }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`\n📣 Slack notification sent to ${channel} ✅`);
    } else {
      console.warn(`\n⚠️  Slack error: ${data.error}`);
    }
  } catch (e) {
    console.warn(`\n⚠️  Slack notification failed: ${e.message}`);
  }
}

/**
 * Stream SSE logs from the agent server to the terminal.
 */
function streamLogs(jobId) {
  const url = `http://localhost:${PORT}/api/logs?jobId=${jobId}`;
  http
    .get(url, (res) => {
      res.on("data", async (chunk) => {
        const messages = chunk.toString().split("\n\n");
        for (const message of messages) {
          if (message.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(message.substring(6));
              if (parsed.msg) {
                const time = new Date(parsed.timestamp).toLocaleTimeString([], {
                  hour12: false,
                });
                spinner.stop();
                console.log(`  [${time}] ${parsed.msg}`);
                if (parsed.msg.includes("Task completed")) {
                  console.log("\n✅ Agent task finished!");

                  // Check if there are modified files to push
                  if (
                    parsed.memory &&
                    parsed.memory.modifiedFiles &&
                    parsed.memory.modifiedFiles.length > 0
                  ) {
                    const jobCwd = parsed.memory.cwd || process.cwd();
                    spinner.stop();
                    console.log("\n📁 The agent modified the following files:");
                    parsed.memory.modifiedFiles.forEach((f) =>
                      console.log(`   • ${f}`),
                    );

                    console.log("\n🔍 Reviewing changes...");
                    try {
                      // Show diff for the modified files
                      const filesArg = parsed.memory.modifiedFiles
                        .map((f) => JSON.stringify(f))
                        .join(" ");
                      const diffOutput = execSync(
                        `git diff --color ${filesArg}`,
                        {
                          encoding: "utf-8",
                          cwd: jobCwd,
                        },
                      );
                      if (diffOutput.trim()) {
                        console.log("\n" + diffOutput);
                      } else {
                        console.log(
                          "ℹ️  No unstaged changes found (files might be identical to original).",
                        );
                      }
                    } catch (e) {
                      console.warn(`⚠️  Could not show diff: ${e.message}`);
                    }

                    const rlPush = readline.createInterface({
                      input: process.stdin,
                      output: process.stdout,
                    });

                    const answer = await new Promise((resolve) =>
                      rlPush.question(
                        "\n❓ Review the changes above. Is everything fine? (y/N) ",
                        resolve,
                      ),
                    );
                    rlPush.close();

                    if (
                      answer.trim().toLowerCase() === "y" ||
                      answer.trim().toLowerCase() === "yes"
                    ) {
                      console.log("\n📥 Staging files...");
                      for (const file of parsed.memory.modifiedFiles) {
                        try {
                          execSync(`git add ${JSON.stringify(file)}`, {
                            stdio: "inherit",
                            cwd: jobCwd,
                          });
                        } catch (e) {
                          console.warn(
                            `⚠️  Failed to stage ${file}: ${e.message}`,
                          );
                        }
                      }

                      // Trigger the push command logic
                      console.log("\n🚀 Starting push workflow...");
                      await handlePush({ cwd: jobCwd });
                    }
                  }
                  process.exit(0);
                }
              }
            } catch {}
          }
        }
      });
      res.on("error", (e) =>
        console.error(`\n❌ Log stream error: ${e.message}`),
      );
    })
    .on("error", (e) =>
      console.error(`\n❌ Cannot connect to log stream: ${e.message}`),
    );
}

/**
 * Automates Jira status mapping
 */
async function handleJiraUpdate({ commitMessage, branch, slackSummary, diff }) {
  console.log("\n🧠 Checking for Jira tickets to update...");

  // 1. Check for credentials and prompt if missing/placeholders
  const jiraEnvVars = {
    JIRA_BASE_URL: process.env.JIRA_BASE_URL,
    JIRA_EMAIL: process.env.JIRA_EMAIL,
    JIRA_API_TOKEN: process.env.JIRA_API_TOKEN,
  };

  const isPlaceholder = (val, key) =>
    !val ||
    val.includes("your-org") ||
    val.includes("your_jira_email") ||
    val.includes("your_jira_api_token");

  const missingVars = Object.keys(jiraEnvVars).filter((key) =>
    isPlaceholder(jiraEnvVars[key], key),
  );

  if (missingVars.length > 0) {
    console.log(
      "⚠️  JIRA credentials are missing or placeholders in .env file.",
    );
    const rlCreds = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    for (const key of missingVars) {
      const value = await new Promise((resolve) =>
        rlCreds.question(`❓ Enter your ${key}: `, resolve),
      );
      process.env[key] = value.trim();

      // Basic persistence to .env
      const envPath = path.resolve(__dirname, "../.env");
      try {
        let content = "";
        if (existsSync(envPath)) {
          content = readFileSync(envPath, "utf-8");
        }

        const regex = new RegExp(`^${key}=.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, `${key}=${value.trim()}`);
        } else {
          content +=
            (content.length > 0 && !content.endsWith("\n") ? "\n" : "") +
            `${key}=${value.trim()}\n`;
        }
        writeFileSync(envPath, content, "utf-8");
      } catch (e) {
        console.warn(`⚠️  Failed to update .env for ${key}: ${e.message}`);
      }
    }
    rlCreds.close();
    console.log("✅ Credentials updated (temporarily and in .env).\n");
  }

  const rlJiraPrompt = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const updateJiraAnswer = await new Promise((resolve) =>
    rlJiraPrompt.question(
      "\n❓ Do you want to update a Jira ticket for this task? (y/N) ",
      resolve,
    ),
  );
  rlJiraPrompt.close();

  if (
    updateJiraAnswer.trim().toLowerCase() !== "y" &&
    updateJiraAnswer.trim().toLowerCase() !== "yes"
  ) {
    console.log("🚫 Jira update skipped.\n");
    return;
  }

  console.log("\n🧠 Checking for Jira tickets to update...");

  // 2. Try to find PROJ-123 in branch or commitMessage
  const textToSearch = [branch, commitMessage].filter(Boolean).join(" ");
  let jiraMatch = textToSearch.match(/[A-Z]+-\d+/i);
  let ticketId;

  if (!jiraMatch) {
    console.log(
      "ℹ️  No Jira ticket ID found in branch name or commit message.",
    );
    const rlTicket = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const manualTicket = await new Promise((resolve) =>
      rlTicket.question(
        "❓ Enter the Scrum Number (Jira Ticket ID): ",
        resolve,
      ),
    );
    rlTicket.close();

    if (manualTicket.trim()) {
      ticketId = manualTicket.trim().toUpperCase();
    }
  } else {
    ticketId = jiraMatch[0].toUpperCase();
  }

  if (!ticketId) {
    console.log("🚫 No JIRA ticket ID provided. Skipping JIRA update.\n");
    return;
  }

  console.log(`🔗 Target Jira ticket: ${ticketId}`);

  try {
    const ticketDetails = await getJiraTicket(ticketId);
    console.log(`📋 Ticket Title: ${ticketDetails.title}`);

    // Default status for this workflow is "Human-Review"
    let newStatus = "Human-Review";

    console.log(`📝 Target status: ${newStatus}\n`);

    const rl3 = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const sendJiraAnswer = await new Promise((resolve) =>
      rl3.question(
        `❓ Do you want to update Jira ticket ${ticketId} to '${newStatus}'? (y/N) `,
        resolve,
      ),
    );
    rl3.close();

    if (
      sendJiraAnswer.trim().toLowerCase() === "y" ||
      sendJiraAnswer.trim().toLowerCase() === "yes"
    ) {
      await updateJiraTicket({
        ticketId,
        status: newStatus,
        diff,
      });
      console.log(`✅ Jira ticket ${ticketId} updated successfully.\n`);
    } else {
      console.log("\n🚫 Jira update skipped.\n");
    }
  } catch (e) {
    console.warn(`⚠️  Failed to process Jira update: ${e.message}\n`);
  }
}

async function generateAIResponse(
  systemPrompt,
  userPrompt,
  spinnerMessage = "Analyzing with AI",
) {
  spinner.message = spinnerMessage;
  spinner.start();

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    });

    const response = await anthropic.messages.create({
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    return response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  } catch (e) {
    console.error(`\n❌ AI Response Error: ${e.message}`);
    return "";
  } finally {
    spinner.stop();
  }
}

program.parse();
