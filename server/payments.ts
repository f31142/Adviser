import {
  bindings,
  db,
  user,
  own,
  safe,
  response,
  error,
  fail,
  now,
  uuid,
  limited,
  message,
  notifyOther,
  type User,
} from "../app/api/workspace/core.ts";
type Attempt = {
  id: string;
  order_id: string;
  amount: number;
  status: string;
  payment_key: string | null;
  created: number;
};
async function provider(path: string, body?: unknown, key?: string) {
  const r = await bindings().paymentFetch(
    "https://api.tosspayments.com/v1/payments" + path,
    {
      method: body ? "POST" : "GET",
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(bindings().TOSS_SECRET_KEY + ":").toString("base64"),
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  if (!r.ok)
    fail(
      "결제업체에서 결과를 확인하지 못했습니다. 결제 상태 확인을 눌러 주세요.",
      502,
    );
  return r.json() as Promise<any>;
}
async function reconcile(p: Attempt, o: any, u: User, result: any) {
  if (
    result.orderId !== p.id ||
    result.paymentKey !== p.payment_key ||
    result.totalAmount !== p.amount ||
    result.currency !== "KRW"
  )
    fail(
      "결제 정보가 신청 내역과 일치하지 않습니다. 관리자에게 문의해 주세요.",
      409,
    );
  if (result.status === "DONE") {
    if (p.status === "DONE") return;
    if (o.status !== "approved" || o.payment !== "unpaid")
      fail("신청 상태를 확인해야 합니다. 관리자에게 문의해 주세요.", 409);
    await db().batch([
      db()
        .prepare("UPDATE payments SET status='DONE',updated=? WHERE id=?")
        .bind(now(), p.id),
      db()
        .prepare(
          "UPDATE orders SET payment='paid',status='received',updated=? WHERE id=?",
        )
        .bind(now(), o.id),
      message(
        o.id,
        u,
        "온라인 결제가 확인되어 작업이 접수되었습니다.",
        "system",
      ),
      ...(await notifyOther(o, u, "온라인 결제가 확인되었습니다.")),
    ]);
    return;
  }
  if (result.status === "CANCELED" && result.balanceAmount === 0) {
    if (p.status === "CANCELED") return;
    await db().batch([
      db()
        .prepare("UPDATE payments SET status='CANCELED',updated=? WHERE id=?")
        .bind(now(), p.id),
      db()
        .prepare(
          "UPDATE orders SET payment='refunded',status='refunded',updated=? WHERE id=?",
        )
        .bind(now(), o.id),
      message(o.id, u, "결제업체의 전액 취소 내역이 확인되었습니다.", "system"),
      ...(await notifyOther(o, u, "온라인 결제 취소가 확인되었습니다.")),
    ]);
    return;
  }
  if (["ABORTED", "EXPIRED"].includes(result.status)) {
    if (p.status === "DONE") fail("결제 내역을 관리자와 확인해 주세요.", 409);
    await db()
      .prepare("UPDATE payments SET status='FAILED',updated=? WHERE id=?")
      .bind(now(), p.id)
      .run();
    fail("결제가 실패하거나 만료되었습니다. 결제를 다시 시작해 주세요.");
  }
  if (result.status === "PARTIAL_CANCELED")
    fail(
      "부분 환불 내역이 있습니다. 남은 정산 내용을 관리자와 확인해 주세요.",
      409,
    );
  fail(
    "아직 결제가 완료되지 않았습니다. 결제 창을 완료하거나 잠시 후 다시 확인해 주세요.",
    409,
  );
}
export async function POST(req: Request) {
  try {
    safe(req);
    if (!(req.headers.get("content-type") || "").startsWith("application/json"))
      fail("JSON 요청이 필요합니다.", 415);
    const u = await user(req);
    if (!u) fail("로그인이 필요합니다.", 401);
    if (!bindings().TOSS_CLIENT_KEY || !bindings().TOSS_SECRET_KEY)
      fail("온라인 결제를 준비 중입니다.", 503);
    const b = (await req.json()) as any;
    if (!b || typeof b !== "object" || Array.isArray(b))
      fail("요청 형식을 확인해 주세요.");
    await limited("payment:" + u.id, 40);
    if (b.action === "checkout") {
      const o = await own(String(b.id || ""), u);
      if (u.id !== o.user_id) fail("고객 본인만 결제할 수 있습니다.", 403);
      if (o.status !== "approved" || o.payment !== "unpaid")
        fail("관리자 승인 후 미결제 신청만 결제할 수 있습니다.");
      if (
        await db()
          .prepare(
            "SELECT id FROM payments WHERE order_id=? AND status='CONFIRMING'",
          )
          .bind(o.id)
          .first()
      )
        fail("결제를 확인 중입니다. 결제 상태 확인을 눌러 주세요.", 409);
      let p = await db()
        .prepare(
          "SELECT * FROM payments WHERE order_id=? AND status='READY' AND created>? ORDER BY created DESC LIMIT 1",
        )
        .bind(o.id, now() - 5 * 60 * 1000)
        .first<Attempt>();
      if (!p) {
        p = {
          id: uuid(),
          order_id: o.id,
          amount: o.amount,
          status: "READY",
          payment_key: null,
          created: now(),
        };
        await db()
          .prepare(
            "INSERT INTO payments(id,order_id,amount,created,updated) VALUES(?,?,?,?,?)",
          )
          .bind(p.id, o.id, o.amount, now(), now())
          .run();
      }
      return response({
        clientKey: bindings().TOSS_CLIENT_KEY,
        customerKey: u.id,
        orderId: p.id,
        amount: p.amount,
        orderName:
          o.service === "edit"
            ? "Adviser 기존 서류 첨삭"
            : "Adviser 초안 작성 지원",
        successUrl: bindings().APP_URL + "/payment/success",
        failUrl: bindings().APP_URL + "/payment/fail",
      });
    }
    if (b.action === "confirm") {
      const p = await db()
        .prepare("SELECT * FROM payments WHERE id=?")
        .bind(String(b.orderId || ""))
        .first<Attempt>();
      if (!p) fail("결제 요청을 찾을 수 없습니다.", 404);
      const o = await own(p.order_id, u);
      if (u.id !== o.user_id) fail("고객 본인만 결제할 수 있습니다.", 403);
      if (
        !Number.isSafeInteger(b.amount) ||
        b.amount !== p.amount ||
        b.amount !== o.amount ||
        typeof b.paymentKey !== "string" ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(b.paymentKey)
      )
        fail("결제 금액 또는 요청 정보를 확인해 주세요.");
      if (p.payment_key && p.payment_key !== b.paymentKey)
        fail("다른 결제 요청입니다.", 409);
      if (p.status === "DONE") return response({ ok: true, id: o.id });
      if (
        !["READY", "CONFIRMING"].includes(p.status) ||
        o.status !== "approved" ||
        o.payment !== "unpaid"
      )
        fail("결제할 수 없는 신청입니다.");
      const other = await db()
        .prepare(
          "SELECT id FROM payments WHERE order_id=? AND id!=? AND status IN ('CONFIRMING','DONE')",
        )
        .bind(o.id, p.id)
        .first();
      if (other) fail("이미 진행 중인 결제가 있습니다.", 409);
      await db()
        .prepare(
          "UPDATE payments SET status='CONFIRMING',payment_key=?,updated=? WHERE id=?",
        )
        .bind(b.paymentKey, now(), p.id)
        .run();
      p.payment_key = b.paymentKey;
      let result;
      try {
        result = await provider(
          "/confirm",
          { paymentKey: p.payment_key, orderId: p.id, amount: p.amount },
          p.id,
        );
      } catch {
        result = await provider("/" + encodeURIComponent(p.payment_key!));
      }
      await reconcile(p, o, u, result);
      return response({ ok: true, id: o.id });
    }
    if (b.action === "sync") {
      const o = await own(String(b.id || ""), u);
      const p = await db()
        .prepare(
          "SELECT * FROM payments WHERE order_id=? AND payment_key IS NOT NULL ORDER BY created DESC LIMIT 1",
        )
        .bind(o.id)
        .first<Attempt>();
      if (!p) fail("확인할 온라인 결제 내역이 없습니다.");
      await reconcile(
        p,
        o,
        u,
        await provider("/" + encodeURIComponent(p.payment_key!)),
      );
      return response({ ok: true, id: o.id });
    }
    fail("지원하지 않는 요청입니다.");
  } catch (e) {
    return error(e);
  }
}
