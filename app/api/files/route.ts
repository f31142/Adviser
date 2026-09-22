import {
  bindings,
  db,
  user,
  own,
  safe,
  uuid,
  now,
  response,
  error,
  fail,
  message,
  notifyOther,
} from "../workspace/core.ts";
export async function POST(req: Request) {
  try {
    safe(req);
    const u = await user(req);
    if (!u) fail("로그인이 필요합니다.", 401);
    if (Number(req.headers.get("content-length") || 0) > 16 * 1024 * 1024)
      fail("파일은 15MB 이하로 첨부해 주세요.");
    const f = await req.formData(),
      o = await own(String(f.get("id")), u),
      file = f.get("file");
    if (
      [
        "cancelled",
        "refunded",
        "cancel_requested",
        "rejected",
        "closed",
      ].includes(o.status)
    )
      fail("종료되거나 취소 요청된 작업에는 첨부할 수 없습니다.");
    if (
      u.role === "admin" &&
      f.get("kind") === "result" &&
      o.payment !== "paid"
    )
      fail("결제 확인 후 초안·결과물을 등록할 수 있습니다.");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > 15 * 1024 * 1024 ||
      !/\.(pdf|docx?|hwpx?|txt)$/i.test(file.name)
    )
      fail("PDF, Word, 한글, TXT 파일을 15MB 이하로 첨부해 주세요.");
    if (file.name.length > 200 || /[\x00-\x1f]/.test(file.name))
      fail("파일 이름을 확인해 주세요.");
    const count = await db()
      .prepare("SELECT COUNT(*) n FROM files WHERE order_id=?")
      .bind(o.id)
      .first<any>();
    if (count.n >= 30) fail("작업당 최대 30개 파일을 첨부할 수 있습니다.");
    const id = uuid(),
      kind =
        u.role === "admin" && f.get("kind") === "result" ? "result" : "source";
    await bindings().BUCKET.put(id, await file.arrayBuffer(), {
      httpMetadata: { contentType: "application/octet-stream" },
    });
    try {
      await db().batch([
        db()
          .prepare(
            "INSERT INTO files(id,order_id,name,size,kind,created) VALUES(?,?,?,?,?,?)",
          )
          .bind(id, o.id, file.name.slice(0, 200), file.size, kind, now()),
        message(
          o.id,
          u,
          (kind === "result" ? "초안·결과물" : "참고 자료") +
            " 첨부: " +
            file.name,
          "system",
        ),
        ...(await notifyOther(o, u, "새 파일이 첨부되었습니다.")),
      ]);
    } catch (e) {
      await bindings().BUCKET.delete(id);
      throw e;
    }
    return response({ ok: true });
  } catch (e) {
    return error(e);
  }
}
