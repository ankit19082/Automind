import { NextResponse } from "next/server";
import { taskQueue } from "@/queue/jobQueue";

export async function POST(request) {
  try {
    const { prompt } = await request.json();

    if (!prompt) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    const job = await taskQueue.add("agentTask", { prompt });
    return NextResponse.json(
      { jobId: job.id, message: "Task queued successfully" },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error queuing task:", error);
    return NextResponse.json(
      { error: "Failed to queue task" },
      { status: 500 },
    );
  }
}
