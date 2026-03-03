import { logEmitter } from "@/events";

export async function GET(request, { params }) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || params?.jobId;

  if (!jobId) {
    return new Response("Missing jobId", { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const onLog = (eventJobId, logMsg) => {
        if (String(eventJobId) === String(jobId)) {
          controller.enqueue(
            `data: ${JSON.stringify({ timestamp: Date.now(), msg: logMsg })}\n\n`,
          );
        }
      };

      logEmitter.on("log", onLog);

      // Keep connection alive
      const intervalId = setInterval(() => {
        controller.enqueue(`:\n\n`);
      }, 15000);

      request.signal.addEventListener("abort", () => {
        logEmitter.off("log", onLog);
        clearInterval(intervalId);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
