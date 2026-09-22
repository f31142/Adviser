import { GET, POST } from "../app/api/workspace/route.ts";
import { POST as upload } from "../app/api/files/route.ts";
import { GET as download } from "../app/api/files/[id]/route.ts";
import { POST as payments } from "./payments.ts";
import { mutate } from "./runtime.ts";
import { error, response } from "../app/api/workspace/core.ts";
import { events, publishUpdates } from "./events.ts";
export async function route(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  try {
    if (req.method === "GET") {
      if (path === "/api/events") return await events(req);
      if (path === "/api/workspace") return GET(req);
      if (/^\/api\/files\/[a-f0-9-]{36}$/.test(path))
        return download(req, {
          params: Promise.resolve({ id: path.split("/").pop()! }),
        });
      if (path === "/healthz") return response({ ok: true });
    }
    if (req.method === "POST")
      return await mutate(async () => {
        const result =
          path === "/api/workspace"
            ? await POST(req)
            : path === "/api/files"
              ? await upload(req)
              : path === "/api/payments"
                ? await payments(req)
                : response({ error: "요청 경로를 찾을 수 없습니다." }, 404);
        if (result.ok) publishUpdates();
        return result;
      });
    return response({ error: "요청 경로를 찾을 수 없습니다." }, 404);
  } catch (e) {
    return error(e);
  }
}
