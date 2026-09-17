import {
  bindings,
  db,
  now,
  uuid,
  config,
  passwordHash,
  verify,
  digest,
  user,
  own,
  safe,
  response,
  error,
  fail,
  limited,
  message,
  notifyOther,
  sessionCookie,
} from "./core.ts";

export async function GET(req: Request) {
  try {
    const u = await user(req);
    const c = {
      ...(await config()),
      onlinePayment: !!(
        bindings().TOSS_CLIENT_KEY && bindings().TOSS_SECRET_KEY
      ),
      testPayment: bindings().TOSS_CLIENT_KEY?.startsWith("test_") || false,
    };
    const url = new URL(req.url);
    if (!u) return response({ user: null, config: c, orders: [], notices: [] });
    const id = url.searchParams.get("order");
    if (id) {
      const o = await own(id, u);
      const [m, f] = await Promise.all([
        db()
          .prepare(
            "SELECT * FROM messages WHERE order_id=? ORDER BY created,id",
          )
          .bind(id)
          .all(),
        db()
          .prepare("SELECT * FROM files WHERE order_id=? ORDER BY created")
          .bind(id)
          .all(),
      ]);
      return response({ order: o, messages: m.results, files: f.results });
    }
    const [os, ns] = await Promise.all([
      u.role === "admin"
        ? db()
            .prepare(
              "SELECT o.*,u.name customer,u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.updated DESC LIMIT 500",
            )
            .all()
        : db()
            .prepare(
              "SELECT * FROM orders WHERE user_id=? ORDER BY updated DESC LIMIT 500",
            )
            .bind(u.id)
            .all(),
      db()
        .prepare(
          "SELECT * FROM notices WHERE user_id=? ORDER BY created DESC LIMIT 50",
        )
        .bind(u.id)
        .all(),
    ]);
    return response({
      user: u,
      config: c,
      orders: os.results,
      notices: ns.results,
    });
  } catch (e) {
    return error(e);
  }
}
export async function POST(req: Request) {
  try {
    safe(req);
    if (!(req.headers.get("content-type") || "").startsWith("application/json"))
      fail("JSON 요청이 필요합니다.", 415);
    if (Number(req.headers.get("content-length") || 0) > 200000)
      fail("입력 내용이 너무 깁니다.");
    const b = (await req.json()) as any;
    if (!b || typeof b !== "object" || Array.isArray(b))
      fail("요청 형식을 확인해 주세요.");
    const action = b.action;
    let u = await user(req);
    if (action === "login" || action === "register") {
      const email = String(b.email || "")
          .trim()
          .toLowerCase(),
        password = String(b.password || "");
      await limited("auth:" + email);
      await limited(
        "ip:" + (req.headers.get("x-adviser-client-ip") || "shared"),
        60,
      );
      if (password.length > 128 || email.length > 254)
        fail("입력 값을 확인해 주세요.");
      if (action === "register") {
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          password.length < 10 ||
          !String(b.name || "").trim() ||
          String(b.name).length > 60
        )
          fail("이름, 이메일과 10자 이상의 비밀번호를 입력해 주세요.");
        const id = uuid();
        try {
          await db()
            .prepare(
              "INSERT INTO users(id,email,name,password,role,created) VALUES(?,?,?,?,?,?)",
            )
            .bind(
              id,
              email,
              b.name.trim(),
              await passwordHash(password),
              "customer",
              now(),
            )
            .run();
        } catch {
          fail("가입할 수 없습니다. 이메일을 확인하거나 로그인해 주세요.");
        }
      }
      if (email === "admin" && bindings().ADMIN_PASSWORD_HASH) {
        await db()
          .prepare(
            "INSERT OR IGNORE INTO users(id,email,name,password,role,created) VALUES('administrator','admin','관리자',?,'admin',?)",
          )
          .bind(bindings().ADMIN_PASSWORD_HASH!, now())
          .run();
      }
      const found = await db()
        .prepare("SELECT * FROM users WHERE email=?")
        .bind(email)
        .first<any>();
      const hash =
        found?.password ||
        "dummy:0000000000000000000000000000000000000000000000000000000000000000";
      if (!(await verify(password, hash)) || !found)
        fail("아이디 또는 비밀번호를 확인해 주세요.", 401);
      const token = uuid() + uuid();
      await db()
        .prepare("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)")
        .bind(await digest(token), found.id, now() + 7 * 86400000)
        .run();
      return response({ ok: true }, 200, {
        "Set-Cookie": sessionCookie(token, 604800),
      });
    }
    if (action === "logout") {
      const t = req.headers
        .get("cookie")
        ?.match(/(?:^|;\s*)adviser_session=([^;]+)/)?.[1];
      if (t)
        await db()
          .prepare("DELETE FROM sessions WHERE token=?")
          .bind(await digest(t))
          .run();
      return response({ ok: true }, 200, { "Set-Cookie": sessionCookie() });
    }
    if (!u) fail("로그인이 필요합니다.", 401);
    if (action === "password") {
      const row = await db()
        .prepare("SELECT password FROM users WHERE id=?")
        .bind(u.id)
        .first<any>();
      await limited("password:" + u.id);
      if (!(await verify(String(b.current || ""), row.password)))
        fail("현재 비밀번호가 일치하지 않습니다.");
      if (
        typeof b.password !== "string" ||
        b.password.length < 10 ||
        b.password.length > 128
      )
        fail("새 비밀번호는 10~128자로 입력해 주세요.");
      await db().batch([
        db()
          .prepare("UPDATE users SET password=? WHERE id=?")
          .bind(await passwordHash(b.password), u.id),
        db().prepare("DELETE FROM sessions WHERE user_id=?").bind(u.id),
      ]);
      return response({ ok: true }, 200, { "Set-Cookie": sessionCookie() });
    }
    if (action === "read") {
      await db()
        .prepare("UPDATE notices SET seen=1 WHERE user_id=?")
        .bind(u.id)
        .run();
      return response({ ok: true });
    }
    if (action === "settings") {
      if (u.role !== "admin") fail("관리자 권한이 필요합니다.", 403);
      const c = b.config;
      if (
        !c ||
        ![c.editPrice, c.writePrice].every(
          (x) => Number.isSafeInteger(x) && x >= 1000 && x <= 10000000,
        ) ||
        !Number.isSafeInteger(c.revisionLimit) ||
        c.revisionLimit < 0 ||
        c.revisionLimit > 100
      )
        fail("가격과 수정 횟수를 확인해 주세요.");
      const out = {
        editPrice: c.editPrice,
        writePrice: c.writePrice,
        revisionLimit: c.revisionLimit,
        bank: String(c.bank || "").slice(0, 50),
        account: String(c.account || "").slice(0, 80),
        holder: String(c.holder || "").slice(0, 50),
        policy: String(c.policy || "").slice(0, 5000),
        retention: String(c.retention || "").slice(0, 2000),
      };
      await db()
        .prepare(
          "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .bind("config", JSON.stringify(out))
        .run();
      return response({ ok: true });
    }
    if (action === "create") {
      if (u.role === "admin") fail("고객 계정에서 신청해 주세요.", 403);
      if (!["edit", "write"].includes(b.service))
        fail("서비스를 선택해 주세요.");
      await limited("orders:" + u.id, 20);
      const c = await config(),
        id = uuid();
      await db()
        .prepare(
          "INSERT INTO orders(id,user_id,service,amount,status,payment,revision_limit,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          u.id,
          b.service,
          b.service === "edit" ? c.editPrice : c.writePrice,
          "draft",
          "unpaid",
          c.revisionLimit,
          now(),
          now(),
        )
        .run();
      return response({ id });
    }
    const o = await own(String(b.id || ""), u);
    const statements: any[] = [];
    if (action === "save" || action === "submit") {
      if (
        u.id !== o.user_id ||
        !["draft", "payment", "application_supplement"].includes(o.status)
      )
        fail("작성 중이거나 보완 요청된 신청서만 수정할 수 있습니다.");
      const f = b.form;
      const keys = [
        "institution",
        "job",
        "education",
        "career",
        "experience",
        "questions",
        "deadline",
        "notes",
      ];
      if (
        !f ||
        keys.some((k) => typeof f[k] !== "string" || f[k].length > 20000)
      )
        fail("설문 내용을 확인해 주세요.");
      if (action === "submit") {
        if (b.consent !== true) fail("서류 열람 동의가 필요합니다.");
        if (keys.filter((k) => k !== "notes").some((k) => !f[k].trim()))
          fail(
            "필수 항목을 모두 입력해 주세요. 해당 내용이 없으면 ‘없음’으로 적어 주세요.",
          );
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(f.deadline) ||
          Number.isNaN(Date.parse(f.deadline)) ||
          new Date(f.deadline).toISOString().slice(0, 10) !== f.deadline ||
          f.deadline <
            new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" })
        )
          fail("마감일을 확인해 주세요.");
        if (
          o.service === "edit" &&
          !(await db()
            .prepare(
              "SELECT id FROM files WHERE order_id=? AND kind='source' LIMIT 1",
            )
            .bind(o.id)
            .first())
        )
          fail("첨삭할 기존 서류를 첨부해 주세요.");
      }
      statements.push(
        db()
          .prepare(
            "UPDATE orders SET form=?,status=?,updated=? WHERE id=? AND status=?",
          )
          .bind(
            JSON.stringify({
              ...Object.fromEntries(keys.map((k) => [k, f[k]])),
              ...(action === "submit" ? { consentAt: now() } : {}),
            }),
            action === "submit"
              ? o.payment === "paid"
                ? "received"
                : "approval"
              : o.status === "payment"
                ? "draft"
                : o.status,
            now(),
            o.id,
            o.status,
          ),
      );
      if (action === "submit") {
        statements.push(
          message(
            o.id,
            u,
            o.payment === "paid"
              ? "신청서가 접수되었습니다."
              : "신청서가 접수되었습니다. 관리자 검토·승인 후 결제할 수 있습니다.",
            "system",
          ),
          ...(await notifyOther(o, u, "새 신청이 접수되었습니다.")),
        );
      }
    } else if (action === "approve") {
      if (u.role !== "admin") fail("관리자 권한이 필요합니다.", 403);
      if (
        o.status !== "approval" ||
        !["unpaid", "bank_requested"].includes(o.payment)
      )
        fail("검토 대기 중인 신청만 승인할 수 있습니다.");
      statements.push(
        db()
          .prepare(
            "UPDATE orders SET status='approved',updated=? WHERE id=? AND status='approval'",
          )
          .bind(now(), o.id),
        message(
          o.id,
          u,
          "서류 검토가 완료되어 신청이 승인되었습니다. 결제를 진행해 주세요.",
          "system",
        ),
        ...(await notifyOther(
          o,
          u,
          "신청이 승인되었습니다. 결제를 진행해 주세요.",
        )),
      );
    } else if (action === "requestSupplement") {
      if (u.role !== "admin") fail("관리자 권한이 필요합니다.", 403);
      if (o.status !== "approval")
        fail("검토 중인 신청만 보완을 요청할 수 있습니다.");
      statements.push(
        db()
          .prepare(
            "UPDATE orders SET status='application_supplement',updated=? WHERE id=? AND status='approval'",
          )
          .bind(now(), o.id),
        message(
          o.id,
          u,
          "신청서 보완을 요청했습니다. 채팅에서 보완할 내용을 확인하고 다시 제출해 주세요.",
          "system",
        ),
        ...(await notifyOther(o, u, "신청서 보완 요청이 도착했습니다.")),
      );
    } else if (action === "reject") {
      if (u.role !== "admin") fail("관리자 권한이 필요합니다.", 403);
      if (o.status !== "approval") fail("검토 중인 신청만 반려할 수 있습니다.");
      if (
        typeof b.reason !== "string" ||
        !b.reason.trim() ||
        b.reason.length > 1000
      )
        fail("반려 사유를 1~1,000자로 입력해 주세요.");
      statements.push(
        db()
          .prepare("UPDATE orders SET status='rejected',updated=? WHERE id=?")
          .bind(now(), o.id),
        message(o.id, u, "신청 반려: " + b.reason.trim(), "system"),
        ...(await notifyOther(o, u, "신청 검토 결과를 확인해 주세요.")),
      );
    } else if (action === "bank") {
      if (u.id !== o.user_id)
        fail("고객 본인만 결제를 요청할 수 있습니다.", 403);
      if (o.status !== "approved") fail("관리자 승인 후 결제할 수 있습니다.");
      const c = await config();
      if (!c.bank || !c.account || !c.holder)
        fail("입금 계좌가 아직 등록되지 않았습니다.");
      if (o.payment !== "unpaid") fail("이미 처리된 결제입니다.");
      if (
        await db()
          .prepare(
            "SELECT id FROM payments WHERE order_id=? AND status='CONFIRMING'",
          )
          .bind(o.id)
          .first()
      )
        fail("온라인 결제 확인 중입니다.");
      statements.push(
        db()
          .prepare(
            "UPDATE orders SET payment='bank_requested',updated=? WHERE id=? AND payment='unpaid' AND status='approved'",
          )
          .bind(now(), o.id),
        message(
          o.id,
          u,
          "계좌이체 신청 · " +
            c.bank +
            " " +
            c.account +
            " / " +
            c.holder +
            " / 입금자: " +
            String(b.depositor || u.name).slice(0, 60),
          "system",
        ),
        ...(await notifyOther(o, u, "입금 확인 요청이 도착했습니다.")),
      );
    } else if (action === "confirmPayment") {
      if (u.role !== "admin") fail("관리자 권한이 필요합니다.", 403);
      if (o.payment !== "bank_requested" || o.status !== "approved")
        fail("입금 확인 대기 건만 처리할 수 있습니다.");
      statements.push(
        db()
          .prepare(
            "UPDATE orders SET payment='paid',status='received',updated=? WHERE id=? AND payment='bank_requested' AND status='approved'",
          )
          .bind(now(), o.id),
        message(
          o.id,
          u,
          "관리자가 입금을 확인했습니다. 작업 시작을 기다려 주세요.",
          "system",
        ),
        ...(await notifyOther(
          o,
          u,
          "결제가 확인되었습니다. 작업이 접수되었습니다.",
        )),
      );
    } else if (action === "chat") {
      if (["cancelled", "refunded", "rejected"].includes(o.status))
        fail("종료된 작업에는 메시지를 보낼 수 없습니다.");
      if (typeof b.body !== "string" || !b.body.trim() || b.body.length > 5000)
        fail("메시지는 1~5,000자로 입력해 주세요.");
      await limited("chat:" + u.id, 100);
      statements.push(
        message(o.id, u, b.body.trim()),
        db()
          .prepare("UPDATE orders SET updated=? WHERE id=?")
          .bind(now(), o.id),
        ...(await notifyOther(o, u, u.name + "님의 새 메시지")),
      );
    } else if (action === "status") {
      if (u.role !== "admin") fail("관리자 권한이 필요합니다.", 403);
      if (o.payment !== "paid") fail("결제 확인 후 작업을 진행할 수 있습니다.");
      const transitions: Record<string, string[]> = {
        received: ["supplement", "working"],
        supplement: ["working"],
        working: ["supplement", "review", "complete"],
        review: ["working", "complete"],
        complete: ["working"],
      };
      if (!transitions[o.status]?.includes(b.status))
        fail("변경할 수 없는 진행 상태입니다.");
      if (
        ["review", "complete"].includes(b.status) &&
        !(await db()
          .prepare(
            "SELECT id FROM files WHERE order_id=? AND kind='result' LIMIT 1",
          )
          .bind(o.id)
          .first())
      )
        fail("먼저 초안 또는 결과물을 등록해 주세요.");
      statements.push(
        db()
          .prepare(
            "UPDATE orders SET status=?,updated=? WHERE id=? AND status=?",
          )
          .bind(b.status, now(), o.id, o.status),
        message(o.id, u, "진행 상태가 변경되었습니다.", "system"),
        ...(await notifyOther(o, u, "작업 진행 상태가 변경되었습니다.")),
      );
    } else if (action === "revision") {
      if (u.role === "admin" || !["review", "complete"].includes(o.status))
        fail("검토 또는 완료 상태에서 수정 요청할 수 있습니다.");
      if (o.revision_limit > 0 && o.revisions >= o.revision_limit)
        fail("수정 가능 횟수를 모두 사용했습니다. 채팅으로 문의해 주세요.");
      if (!String(b.body || "").trim()) fail("수정 요청 내용을 적어 주세요.");
      statements.push(
        db()
          .prepare(
            "UPDATE orders SET status='working',revisions=revisions+1,updated=? WHERE id=? AND status=? AND revisions=?",
          )
          .bind(now(), o.id, o.status, o.revisions),
        message(o.id, u, "[수정 요청] " + String(b.body).slice(0, 5000)),
        ...(await notifyOther(o, u, "수정 요청이 도착했습니다.")),
      );
    } else if (action === "cancel") {
      if (
        ["cancelled", "cancel_requested", "refunded", "rejected"].includes(
          o.status,
        )
      )
        fail("이미 취소 처리 중이거나 종료되었습니다.");
      if (
        await db()
          .prepare(
            "SELECT id FROM payments WHERE order_id=? AND status='CONFIRMING'",
          )
          .bind(o.id)
          .first()
      )
        fail("온라인 결제 확인 중입니다. 결제 상태를 먼저 확인해 주세요.");
      const immediate = o.payment === "unpaid";
      statements.push(
        db()
          .prepare("UPDATE orders SET status=?,updated=? WHERE id=?")
          .bind(immediate ? "cancelled" : "cancel_requested", now(), o.id),
        message(
          o.id,
          u,
          immediate
            ? "결제 전 신청을 취소했습니다."
            : "취소를 요청했습니다. 환불 여부는 관리자가 확인합니다.",
          "system",
        ),
        ...(await notifyOther(o, u, "취소 요청이 도착했습니다.")),
      );
    } else if (action === "refund") {
      if (
        await db()
          .prepare(
            "SELECT id FROM payments WHERE order_id=? AND status IN ('DONE','CONFIRMING')",
          )
          .bind(o.id)
          .first()
      )
        fail(
          "온라인 결제는 결제업체에서 취소한 후 결제 상태 동기화를 실행해 주세요.",
        );
      if (u.role !== "admin" || o.status !== "cancel_requested")
        fail("취소 요청 건만 처리할 수 있습니다.", 403);
      statements.push(
        db()
          .prepare(
            "UPDATE orders SET status='refunded',payment='refunded',updated=? WHERE id=? AND status='cancel_requested'",
          )
          .bind(now(), o.id),
        message(
          o.id,
          u,
          "관리자가 입금 내역 확인 및 필요한 환불 처리를 완료했습니다.",
          "system",
        ),
        ...(await notifyOther(o, u, "취소 처리가 완료되었습니다.")),
      );
    } else if (action === "purgeFiles") {
      if (
        u.role !== "admin" ||
        !["complete", "cancelled", "refunded", "rejected"].includes(o.status)
      )
        fail("종료된 작업의 자료만 관리자가 삭제할 수 있습니다.", 403);
      const fs = await db()
        .prepare("SELECT id FROM files WHERE order_id=?")
        .bind(o.id)
        .all<{ id: string }>();
      for (const f of fs.results) await bindings().BUCKET.delete(f.id);
      statements.push(
        db().prepare("DELETE FROM files WHERE order_id=?").bind(o.id),
        message(o.id, u, "관리자가 첨부 자료를 삭제했습니다.", "system"),
        ...(await notifyOther(o, u, "작업에 첨부된 자료가 삭제되었습니다.")),
      );
    } else fail("지원하지 않는 요청입니다.");
    await db().batch(statements);
    return response({ ok: true });
  } catch (e) {
    return error(e);
  }
}
