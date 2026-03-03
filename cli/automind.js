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

    // Try OpenAI first
    if (
      process.env.OPENAI_API_KEY &&
      !process.env.OPENAI_API_KEY.includes("your_")
    ) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const trimmedDiff =
          diff.length > 8000
            ? diff.substring(0, 8000) + "\n...(truncated)"
            : diff;

        const res = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are an expert developer. Generate a concise git commit message from the provided diff. " +
                "Use Conventional Commits format (feat:, fix:, chore:, refactor:, docs:, style:, test:). " +
                "First line: short summary (max 72 chars). Then a blank line. Then 2-4 bullet points describing the ACTUAL changes made (functions added, logic changed, bugs fixed, etc.). " +
                "Respond with ONLY the commit message, no extra explanation.",
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
      await sendSlackPushNotification({
        commitMessage,
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
  commitMessage,
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

  const firstLine = commitMessage.split("\n")[0];
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
    `🚀 *New push to \`${branch}\`* — \`${commitHash}\`\n` +
    `> ${firstLine}\n\n` +
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
