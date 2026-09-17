import { GET, POST } from "../app/api/workspace/route.ts";
import { POST as upload } from "../app/api/files/route.ts";
import { GET as download } from "../app/api/files/[id]/route.ts";
import { POST as payments } from "./payments.ts";
import { mutate } from "./runtime.ts";
import { error, response } from "../app/api/workspace/core.ts";
export async function route(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  try {
    if (req.method === "GET") {
      if (path === "/api/workspace") return GET(req);
      if (/^\/api\/files\/[a-f0-9-]{36}$/.test(path))
        return download(req, {
          params: Promise.resolve({ id: path.split("/").pop()! }),
        });
      if (path === "/healthz") return response({ ok: true });
    }
    if (req.method === "POST")
      return await mutate(async () => {
        if (path === "/api/workspace") return POST(req);
        if (path === "/api/files") return upload(req);
        if (path === "/api/payments") return payments(req);
        return response({ error: "요청 경로를 찾을 수 없습니다." }, 404);
      });
    return response({ error: "요청 경로를 찾을 수 없습니다." }, 404);
  } catch (e) {
    return error(e);
  }
}
