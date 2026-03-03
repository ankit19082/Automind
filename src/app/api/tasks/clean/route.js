import { NextResponse } from "next/server";
import { cleanQueue } from "@/queue/jobQueue";

export async function POST() {
  try {
    const result = await cleanQueue();
    if (result.success) {
      return NextResponse.json({ message: "Queue cleaned successfully" });
    } else {
      return NextResponse.json(
        { error: "Failed to clean queue", details: result.error },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error("Error cleaning queue:", error);
    return NextResponse.json(
      { error: "Internal server error during queue cleanup" },
      { status: 500 },
    );
  }
}
