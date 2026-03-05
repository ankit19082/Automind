import { NextResponse } from "next/server";
import { taskQueue } from "@/queue/jobQueue";

export async function GET() {
  // Use 'force-dynamic' to prevent Next.js from aggressively caching this route
  try {
    const jobs = await taskQueue.getJobs([
      "waiting",
      "active",
      "completed",
      "failed",
      "delayed",
      "paused",
    ]);

    const jobDetails = await Promise.all(
      jobs.map(async (job) => {
        const state = await job.getState();
        return {
          id: job.id,
          prompt: job.data?.prompt || "Unknown task",
          status: state,
          createdAt: job.timestamp,
          finishedAt: job.finishedOn || null,
          failedReason: job.failedReason || null,
        };
      }),
    );

    jobDetails.sort((a, b) => b.createdAt - a.createdAt);

    return NextResponse.json({ tasks: jobDetails }, { status: 200 });
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 },
    );
  }
}
export const dynamic = "force-dynamic";
