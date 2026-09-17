import {
  bindings,
  db,
  user,
  own,
  response,
  error,
  fail,
} from "../../workspace/core.ts";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const u = await user(req);
    if (!u) fail("로그인이 필요합니다.", 401);
    const { id } = await params;
    const f = await db()
      .prepare("SELECT * FROM files WHERE id=?")
      .bind(id)
      .first<any>();
    if (!f) fail("파일이 없습니다.", 404);
    await own(f.order_id, u);
    const obj = await bindings().BUCKET.get(id);
    if (!obj) fail("파일을 찾을 수 없습니다.", 404);
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition":
          "attachment; filename*=UTF-8''" + encodeURIComponent(f.name),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return error(e);
  }
}
