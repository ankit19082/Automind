import { logEmitter } from "@/events";

export async function GET(request, { params }) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("jobId") || params?.jobId;

  if (!jobId) {
    return new Response("Missing jobId", { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const cleanup = logEmitter.subscribe(
        jobId,
        (msgJobId, logMsg, data = {}) => {
          const payload = {
            timestamp: Date.now(),
            msg:
              typeof logMsg === "string"
                ? logMsg
                : "Log message object received",
            ...data,
          };
          // If logMsg is an object with a msg property, use it
          if (typeof logMsg === "object" && logMsg.msg) {
            payload.msg = logMsg.msg;
          }

          controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
        },
      );

      // Keep connection alive
      const intervalId = setInterval(() => {
        controller.enqueue(`:\n\n`);
      }, 15000);

      request.signal.addEventListener("abort", () => {
        cleanup();
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
