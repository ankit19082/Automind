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

// Load .env from the Automind project directory (where this CLI lives)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../.env") });

const program = new Command();

// Port is configurable via AUTOMIND_PORT env var, defaults to 3000
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
  .action(async (opts) => {
    console.log("\n🤖 AutoMind Git Push\n");

    // 1. Check we are in a git repo
    try {
      execSync("git rev-parse --git-dir", { stdio: "ignore" });
    } catch {
      console.error("❌ Not inside a git repository.");
      process.exit(1);
    }

    // 2. Get staged diff
    let diff = "";
    try {
      diff = execSync("git diff --staged", { encoding: "utf-8" });
    } catch (e) {
      console.error(`❌ Failed to get staged diff: ${e.message}`);
      process.exit(1);
    }

    if (!diff.trim()) {
      // Nothing staged — stage all changes
      console.log(
        "ℹ️  No staged changes found. Staging all modified/new files...",
      );
      try {
        execSync("git add .", { stdio: "inherit" });
        diff = execSync("git diff --staged", { encoding: "utf-8" });
      } catch (e) {
        console.error(`❌ Failed to stage files: ${e.message}`);
        process.exit(1);
      }
    }

    if (!diff.trim()) {
      console.log("✅ Nothing to commit. Working tree is clean.");
      process.exit(0);
    }

    // 3. Show summary of what's staged
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
    console.log("🧠 Generating commit message...");
    let commitMessage = "";

    if (process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        // Trim diff to avoid token limits
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
                "First line: short summary (max 72 chars). Then optionally 2-3 bullet points of key changes. " +
                "Respond with only the commit message, no extra explanation.",
            },
            { role: "user", content: trimmedDiff },
          ],
        });
        commitMessage = res.choices[0].message.content.trim();
      } catch (e) {
        console.warn(
          `⚠️  OpenAI error, falling back to basic message: ${e.message}`,
        );
      }
    }

    // Fallback: analyze diff to generate a smart conventional commits message
    if (!commitMessage) {
      const files = execSync("git diff --staged --name-only", {
        encoding: "utf-8",
      })
        .trim()
        .split("\n")
        .filter(Boolean);
      const fileCount = files.length;

      // Detect change type from filenames and diff content
      const hasFix =
        diff.includes("fix") ||
        diff.includes("bug") ||
        files.some((f) => f.includes("fix"));
      const hasDocs = files.every(
        (f) => f.endsWith(".md") || f.endsWith(".txt"),
      );
      const hasTests = files.some(
        (f) => f.includes("test") || f.includes("spec"),
      );
      const hasStyle = files.some((f) =>
        [".css", ".scss", ".less"].some((ext) => f.endsWith(ext)),
      );
      const isNewFiles =
        execSync("git diff --staged --diff-filter=A --name-only", {
          encoding: "utf-8",
        }).trim().length > 0;

      // Detect affected scope from paths
      const dirs = [
        ...new Set(files.map((f) => f.split("/")[0]).filter((d) => d !== ".")),
      ].slice(0, 2);
      const scope = dirs.length ? `(${dirs.join(", ")})` : "";

      let type;
      if (hasDocs) type = "docs";
      else if (hasTests) type = "test";
      else if (hasStyle) type = "style";
      else if (hasFix) type = "fix";
      else if (isNewFiles) type = "feat";
      else type = "refactor";

      const summary = `${type}${scope}: update ${fileCount} file${fileCount > 1 ? "s" : ""}`;
      const details = files
        .slice(0, 8)
        .map((f) => `- ${f}`)
        .join("\n");
      commitMessage = `${summary}\n\n${details}`;
    }

    console.log("\n📝 Commit message:\n");
    console.log("   " + commitMessage.replace(/\n/g, "\n   "));
    console.log("");

    if (opts.dryRun) {
      console.log("ℹ️  Dry run mode — skipping commit and push.");
      process.exit(0);
    }

    // 5. Commit using a temp file to properly handle multi-line messages
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

    // 6. Push
    console.log("🚀 Pushing to remote...");
    try {
      // Check if remote is configured
      const remotes = execSync("git remote", { encoding: "utf-8" }).trim();
      if (!remotes) {
        console.log("⚠️  No git remote configured. Commit was saved locally.");
        console.log("   To push, run: git remote add origin <your-repo-url>");
        process.exit(0);
      }
      execSync("git push", { stdio: "inherit" });
      console.log("\n✅ Successfully pushed to remote!");
    } catch (e) {
      console.error(`❌ Push failed: ${e.message}`);
      process.exit(1);
    }
  });

// ─── helpers ──────────────────────────────────────────────────────────────────
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
            } catch (e) {
              // ignore keep-alive pings
            }
          }
        }
      });

      res.on("error", (e) => {
        console.error(`\n❌ Log stream error: ${e.message}`);
      });
    })
    .on("error", (e) => {
      console.error(`\n❌ Cannot connect to log stream: ${e.message}`);
    });
}

program.parse();
