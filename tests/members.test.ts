import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, configureRuntime } from "../server/runtime.ts";
import { passwordHash } from "../server/password.ts";
import { digest } from "../app/api/workspace/core.ts";
import { route } from "../server/router.ts";

const directory = mkdtempSync(join(tmpdir(), "adviser-members-"));
const runtime = createRuntime(directory, "https://adviser.test");
configureRuntime(runtime);
runtime.ADMIN_PASSWORD_HASH = await passwordHash("test-admin-password");
after(() => {
  runtime.DB.close();
  rmSync(directory, { recursive: true, force: true });
});

async function post(
  body: unknown,
  cookie = "",
  expected = 200,
  origin = "https://adviser.test",
) {
  const r = await route(
    new Request("https://adviser.test/api/workspace", {
      method: "POST",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return { data, cookie: r.headers.get("set-cookie")?.split(";")[0] || cookie };
}
async function get(path: string, cookie = "", expected = 200) {
  const r = await route(
    new Request("https://adviser.test" + path, { headers: { cookie } }),
  );
  assert.equal(r.status, expected);
  return r.json();
}

test("only admins can list customers and delete confirmed non-admin accounts; retained records never reconnect to a new account", async () => {
  const admin = await post({
    action: "login",
    email: "ADMIN",
    password: "test-admin-password",
  });
  const target = await post({
    action: "register",
    email: "remove@example.test",
    name: "삭제 대상",
    password: "old-customer-password",
  });
  const secondSession = await post({
    action: "login",
    email: "remove@example.test",
    password: "old-customer-password",
  });
  const other = await post({
    action: "register",
    email: "other@example.test",
    name: "다른 고객",
    password: "test-customer-password",
  });
  const targetId = (await get("/api/workspace", target.cookie)).user.id;
  const deletion = {
    action: "deleteMember",
    memberId: targetId,
    confirmEmail: "remove@example.test",
  };

  await get("/api/workspace?members=1", "", 401);
  await get("/api/workspace?members=1", other.cookie, 403);
  const list = await get("/api/workspace?members=1", admin.cookie);
  assert.equal(list.members.length, 2);
  assert(!JSON.stringify(list).includes("password"));
  assert(!JSON.stringify(list).includes("adviser_session"));
  assert(!list.members.some((m: any) => m.email === "admin"));
  await post(deletion, "", 401);
  await post(deletion, other.cookie, 403);
  await post(deletion, admin.cookie, 403, "https://evil.test");
  await post(
    { ...deletion, confirmEmail: "other@example.test" },
    admin.cookie,
    400,
  );
  await post({ ...deletion, confirmEmail: null }, admin.cookie, 400);
  await post({ ...deletion, memberId: "absent" }, admin.cookie, 404);
  await post(
    { ...deletion, memberId: "administrator", confirmEmail: "admin" },
    admin.cookie,
    403,
  );
  await runtime.DB.prepare(
    "INSERT INTO users(id,email,name,password,role,created) VALUES('second-admin','admin2','관리자 2','unused','admin',?)",
  )
    .bind(Date.now())
    .run();
  await post(
    { ...deletion, memberId: "second-admin", confirmEmail: "admin2" },
    admin.cookie,
    403,
  );

  const orderId = (
    await post({ action: "create", service: "write" }, target.cookie)
  ).data.id;
  await post(
    { action: "chat", id: orderId, body: "기존 상담 내용" },
    target.cookie,
  );
  const fileId = crypto.randomUUID();
  await runtime.BUCKET.put(
    fileId,
    new TextEncoder().encode("보관할 첨부파일").buffer,
  );
  await runtime.DB.prepare(
    "INSERT INTO files(id,order_id,name,size,kind,created) VALUES(?,?,?,?,'source',?)",
  )
    .bind(fileId, orderId, "sample.txt", 30, Date.now())
    .run();
  const paymentId = crypto.randomUUID();
  await runtime.DB.prepare(
    "INSERT INTO payments(id,order_id,amount,status,created,updated) VALUES(?,?,100000,'CONFIRMING',?,?)",
  )
    .bind(paymentId, orderId, Date.now(), Date.now())
    .run();
  await post(deletion, admin.cookie, 409);
  assert((await get("/api/workspace", target.cookie)).user);
  await runtime.DB.prepare("UPDATE payments SET status='DONE' WHERE id=?")
    .bind(paymentId)
    .run();
  await runtime.DB.prepare(
    "INSERT INTO notices(id,user_id,order_id,body,created) VALUES(?,?,?,'샘플 알림',?)",
  )
    .bind(crypto.randomUUID(), targetId, orderId, Date.now())
    .run();

  await post(deletion, admin.cookie);
  await post(deletion, admin.cookie, 404);
  const removed = await runtime.DB.prepare("SELECT * FROM users WHERE id=?")
    .bind(targetId)
    .first<any>();
  assert.equal(removed.name, "삭제된 회원");
  assert.equal(removed.password, "");
  assert.notEqual(removed.email, "remove@example.test");
  assert.equal(removed.deleted_by, "administrator");
  assert(removed.deleted_at > 0);
  assert.equal(
    (
      await runtime.DB.prepare(
        "SELECT COUNT(*) n FROM sessions WHERE user_id=?",
      )
        .bind(targetId)
        .first<any>()
    ).n,
    0,
  );
  assert.equal(
    (
      await runtime.DB.prepare("SELECT COUNT(*) n FROM notices WHERE user_id=?")
        .bind(targetId)
        .first<any>()
    ).n,
    0,
  );
  for (const cookie of [target.cookie, secondSession.cookie]) {
    assert.equal((await get("/api/workspace", cookie)).user, null);
    await post({ action: "create", service: "write" }, cookie, 401);
  }
  await post(
    {
      action: "login",
      email: "remove@example.test",
      password: "old-customer-password",
    },
    "",
    401,
  )