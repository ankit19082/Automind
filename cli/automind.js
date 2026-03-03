#!/usr/bin/env node
import { Command } from "commander";
import http from "http";
import { execSync } from "child_process";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import path from "path";
import { config } from "dotenv";
import { writeFileSync, unlinkSync } from "fs";
import os from "os";
import readline from "readline";

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

    const postData = JSON.stringify({ prompt });
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
          console.log(
            `✅ Task queued (Job ID: ${jobId})\n📡 Streaming agent logs...\n`,
          );
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
  });

// ─── push command ─────────────────────────────────────────────────────────────
program
  .command("push")
  .description("Auto-generate commit message from staged changes and push")
  .option("--dry-run", "Show the commit message without actually committing")
  .option("--no-slack", "Skip Slack notification after push")
  .action(async (opts) => {
    console.log("\n🤖 AutoMind Git Push\n");

    // 1. Verify git repo
    try {
      execSync("git rev-parse --git-dir", { stdio: "ignore" });
    } catch {
      console.error("❌ Not inside a git repository.");
      process.exit(1);
    }

    // 2. Stage all if nothing explicitly staged
    let diff = execSync("git diff --staged", { encoding: "utf-8" });
    if (!diff.trim()) {
      console.log(
        "ℹ️  No staged changes found. Staging all modified/new files...",
      );
      execSync("git add .", { stdio: "inherit" });
      diff = execSync("git diff --staged", { encoding: "utf-8" });
    }

    if (!diff.trim()) {
      console.log("✅ Nothing to commit. Working tree is clean.");
      process.exit(0);
    }

    // 3. Show summary of staged files
    const statusLines = execSync("git status --short", {
      encoding: "utf-8",
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
    console.log("🧠 Analyzing changes...");
    let commitMessage = "";

    // Try Ollama (KiloCode) first
    if (process.env.OLLAMA_API_BASE || true) {
      try {
        const openai = new OpenAI({
          apiKey: "ollama", // API key is not required for local Ollama, but the SDK requires a string
          baseURL: "http://127.0.0.1:11434/v1",
        });
        const trimmedDiff =
          diff.length > 8000
            ? diff.substring(0, 8000) + "\n...(truncated)"
            : diff;

        const res = await openai.chat.completions.create({
          model: "qwen2.5", // Using the model the user just pulled
          messages: [
            {
              role: "system",
              content:
                "You are an expert developer analyzing a git diff. First, mentally review the changes file-by-file to understand exactly what type of change was made in each file. " +
                "Then, generate a concise git commit message based on your analysis. " +
                "Use Conventional Commits format (feat:, fix:, chore:, refactor:, docs:, style:, test:). " +
                "First line: a short summary (max 72 chars) using the appropriate type prefix. Then a blank line. Then 2-4 bullet points describing the specific changes made, grouping them logically if possible. " +
                "Respond with ONLY the final commit message, with no extra explanation or reasoning.",
            },
            { role: "user", content: trimmedDiff },
          ],
        });
        commitMessage = res.choices[0].message.content.trim();
      } catch (e) {
        console.warn(
          `⚠️  OpenAI error, using smart fallback: ${e.message.split("\n")[0]}`,
        );
      }
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
      });
      unlinkSync(tmpFile);
      console.log("");
    } catch (e) {
      try {
        unlinkSync(tmpFile);
      } catch {}
      console.error(`❌ Commit failed: ${e.message}`);
      process.exit(1);
    }

    // 6. Get commit hash for Slack notification
    const commitHash = execSync("git rev-parse --short HEAD", {
      encoding: "utf-8",
    }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
    }).trim();

    // 7. Push to remote
    console.log("🚀 Pushing to remote...");
    try {
      const remotes = execSync("git remote", { encoding: "utf-8" }).trim();
      if (!remotes) {
        console.log("⚠️  No git remote configured. Commit was saved locally.");
        console.log("   To push: git remote add origin <your-repo-url>");
        process.exit(0);
      }
      execSync("git push", { stdio: "inherit" });
      console.log("\n✅ Successfully pushed to remote!");
    } catch (e) {
      console.error(`❌ Push failed: ${e.message}`);
      process.exit(1);
    }

    // 8. Slack notification
    if (opts.slack !== false) {
      console.log("🧠 Generating detailed summary for Slack...");
      let slackSummary = commitMessage; // fallback

      // Generate full summary for slack using Ollama
      if (process.env.OLLAMA_API_BASE || true) {
        try {
          const openai = new OpenAI({
            apiKey: "ollama",
            baseURL: process.env.OLLAMA_API_BASE || "http://127.0.0.1:11434/v1",
          });

          const trimmedDiff =
            diff.length > 8000
              ? diff.substring(0, 8000) + "\n...(truncated)"
              : diff;

          const res = await openai.chat.completions.create({
            model: "qwen2.5",
            messages: [
              {
                role: "system",
                content:
                  "You are an expert developer. Based on the provided git diff, generate a detailed summary of the changes made, suitable for a Slack notification or Pull Request description. " +
                  "Explain WHAT changed and WHY, in a readable, bulleted format. Do not include raw code or the actual git diff formatting, just the higher-level explanation. Keep it concise but descriptive.",
              },
              { role: "user", content: trimmedDiff },
            ],
          });
          slackSummary = res.choices[0].message.content.trim();
        } catch (e) {
          console.warn(
            `⚠️  Failed to generate detailed summary for Slack: ${e.message.split("\n")[0]}`,
          );
        }
      }

      await sendSlackPushNotification({
        slackSummary,
        commitHash,
        branch,
        statusLines,
      });
    }
  });

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

  const text =
    `🚀 *New push to \`${branch}\`* — \`${commitHash}\`\n\n` +
    `*Changes summary:*\n${slackSummary}\n\n` +
    `*Files changed:*\n${fileList}` +
    (repoUrl ? `\n\n<${repoUrl}|View on GitHub>` : "");

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
      res.on("data", (chunk) => {
        const messages = chunk.toString().split("\n\n");
        for (const message of messages) {
          if (message.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(message.substring(6));
              if (parsed.msg) {
                const time = new Date(parsed.timestamp).toLocaleTimeString([], {
                  hour12: false,
                });
                console.log(`  [${time}] ${parsed.msg}`);
                if (parsed.msg.includes("Task completed")) {
                  console.log("\n✅ Agent task finished!");
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

program.parse();
