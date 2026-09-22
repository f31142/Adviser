import { user, fail } from "../app/api/workspace/core.ts";

// One process owns the database. Events only invalidate authorized API reads;
// account details, order identifiers and chat text are never broadcast.
const clients = new Set<{ update: () => Promise<void>; close: () => void }>();
export function publishUpdates() {
  for (const client of clients) void client.update();
}
export function closeEventStreams() {
  for (const client of clients) client.close();
}
export async function events(req: Request) {
  const current = await user(req);
  if (!current) fail("로그인이 필요합니다.", 401);
  if (req.headers.get("sec-fetch-site") === "cross-site")
    fail("허용되지 않은 요청입니다.", 403);
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const dispose = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clients.delete(client);
        req.signal.removeEventListener("abort", close);
      };
      const close = () => {
        if (closed) return;
        dispose();
        controller.close();
      };
      const send = (text: string) => {
        if (closed) return;
        if ((controller.desiredSize ?? 1) < -8) {
          close();
          return;
        }
        controller.enqueue(encoder.encode(text));
      };
      const update = async (heartbeatOnly = false) => {
        try {
          const active = await user(req);
          if (closed) return;
          if (!active || active.id !== current.id) {
            send("event: session\ndata: {}\n\n");
            close();
            return;
          }
          send(
            heartbeatOnly
              ? ": heartbeat\n\n"
              : "event: workspace\ndata: {}\n\n",
          );
        } catch {
          close();
        }
      };
      const client = { update: () => update(), close };
      const heartbeat = setInterval(() => void update(true), 15000);
      heartbeat.unref();
      // A canceled ReadableStream is already closed by its reader.
      cleanup = dispose;
      clients.add(client);
      req.signal.addEventListener("abort", close, { once: true });
      if (req.signal.aborted) close();
      else send("retry: 2000\nevent: ready\ndata: {}\n\n");
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
