import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createRuntime, configureRuntime } from "../server/runtime.ts";
import { passwordHash } from "../server/password.ts";
import { route } from "../server/router.ts";
const directory = mkdtempSync(join(tmpdir(), "adviser-workflow-"));
const runtime = createRuntime(directory, "https://adviser.test");
runtime.ADMIN_PASSWORD_HASH = await passwordHash("test-admin-password");
configureRuntime(runtime);
const db = runtime.DB;
const mf = {
  dispatchFetch: (url, init) => route(new Request(url, init)),
  dispose: async () => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  },
};
let checks = 0;
try {
  async function request(body, cookie = "", expected = 200) {
    const r = await mf.dispatchFetch("https://adviser.test/api/workspace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie,
        origin: "https://adviser.test",
      },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    assert.equal(r.status, expected, JSON.stringify(d));
    checks++;
    return { d, cookie: r.headers.get("set-cookie")?.split(";")[0] || cookie };
  }
  const a = await request({
    action: "login",
    email: "ADMIN",
    password: "test-admin-password",
  });
  const c = await request({
    action: "register",
    name: "Customer",
    email: "customer@example.test",
    password: "test-customer-password",
  });
  const other = await request({
    action: "register",
    name: "Other",
    email: "other@example.test",
    password: "test-customer-password",
  });
  assert.ok(c.cookie.includes("adviser_session="));
  await request({ action: "settings", config: {} }, c.cookie, 403);
  await request({ action: "create", service: "edit" }, "", 401);
  const created = await request(
    { action: "create", service: "edit", amount: 1 },
    c.cookie,
  );
  const id = created.d.id;
  let row = await db
    .prepare("SELECT * FROM orders WHERE id=?")
    .bind(id)
    .first();
  assert.equal(row.amount, 100000);
  checks++;
  let r = await mf.dispatchFetch(
    "https://adviser.test/api/workspace?order=" + id,
    { headers: { cookie: other.cookie } },
  );
  assert.equal(r.status, 404);
  checks++;
  await request({ action: "confirmPayment", id }, c.cookie, 403);
  await request({ action: "bank", id }, c.cookie, 400);
  await request(
    {
      action: "settings",
      config: {
        editPrice: 150000,
        writePrice: 100000,
        revisionLimit: 2,
        bank: "TEST BANK",
        account: "TEST ACCOUNT",
        holder: "TEST HOLDER",
      },
    },
    a.cookie,
  );
  row = await db
    .prepare("SELECT amount FROM orders WHERE id=?")
    .bind(id)
    .first();
  assert.equal(row.amount, 100000);
  checks++;
  assert.equal(
    (await db.prepare("SELECT status FROM orders WHERE id=?").bind(id).first())
      .status,
    "draft",
  );
  checks++;
  await request({ action: "bank", id, depositor: "Customer" }, c.cookie, 400);
  await request({ action: "approve", id }, c.cookie, 403);
  await request({ action: "approve", id }, a.cookie, 400);
  await request({ action: "confirmPayment", id }, a.cookie, 400);
  const form = {
    institution: "기관",
    job: "직무",
    education: "학력",
    career: "없음",
    experience: "경험",
    questions: "문항 / 1000자",
    deadline: "2099-12-01",
    notes: "",
  };
  await request({ action: "save", id, form }, c.cookie);
  await request({ action: "submit", id, form, consent: true }, c.cookie, 400);
  async function upload(cookie, kind, expected = 200) {
    const f = new FormData();
    f.append("id", id);
    f.append("kind", kind);
    f.append(
      "file",
      new File(["test document"], "document.txt", { type: "text/plain" }),
    );
    const r = await mf.dispatchFetch("https://adviser.test/api/files", {
      method: "POST",
      headers: { cookie, origin: "https://adviser.test" },
      body: f,
    });
    assert.equal(r.status, expected, await r.text());
    checks++;
  }
  await upload(c.cookie, "source");
  await upload(other.cookie, "source", 404);
  await upload(a.cookie, "result", 400);
  await request(
    { action: "chat", id, body: "결제 전 참고 자료입니다." },
    c.cookie,
  );
  await request({ action: "submit", id, form, consent: true }, c.cookie);
  assert.equal(
    (await db.prepare("SELECT status FROM orders WHERE id=?").bind(id).first())
      .status,
    "approval",
  );
  checks++;
  await request({ action: "status", id, status: "working" }, a.cookie, 400);
  await request({ action: "bank", id }, c.cookie, 400);
  await request({ action: "requestSupplement", id }, c.cookie, 403);
  await request({ action: "requestSupplement", id }, a.cookie);
  await request({ action: "approve", id }, a.cookie, 400);
  await request(
    { action: "save", id, form: { ...form, notes: "보완 내용" } },
    c.cookie,
  );
  await request(
    {
      action: "submit",
      id,
      form: { ...form, notes: "보완 내용" },
      consent: true,
    },
    c.cookie,
  );
  await request({ action: "approve", id }, a.cookie);
  await request({ action: "approve", id }, a.cookie, 400);
  await request({ action: "save", id, form }, c.cookie, 400);
  await request({ action: "bank", id }, a.cookie, 403);
  await request({ action: "bank", id, depositor: "Customer" }, c.cookie);
  await request({ action: "confirmPayment", id }, a.cookie);
  assert.equal(
    (await db.prepare("SELECT status FROM orders WHERE id=?").bind(id).first())
      .status,
    "received",
  );
  checks++;
  await request({ action: "confirmPayment", id }, a.cookie, 400);
  await request({ action: "status", id, status: "working" }, a.cookie);
  await request({ action: "status", id, status: "complete" }, a.cookie, 400);
  await request({ action: "chat", id, body: "Feedback" }, c.cookie);
  await upload(a.cookie, "result");
  await request({ action: "status", id, status: "review" }, a.cookie);
  await request({ action: "revision", id, body: "수정해주세요" }, c.cookie);
  await request({ action: "status", id, status: "complete" }, a.cookie);
  const file = await db
    .prepare("SELECT id FROM files WHERE order_id=? LIMIT 1")
    .bind(id)
    .first();
  r = await mf.dispatchFetch("https://adviser.test/api/files/" + file.id, {
    headers: { cookie: other.cookie },
  });
  assert.equal(r.status, 404);
  checks++;
  r = await mf.dispatchFetch("https://adviser.test/api/files/" + file.id, {
    headers: { cookie: c.cookie },
  });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "test document");
  checks++;
  r = await mf.dispatchFetch("https://adviser.test/api/workspace", {
    method: "POST",
    headers: {
      cookie: c.cookie,
      origin: "https://evil.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "create", service: "edit" }),
  });
  assert.equal(r.status, 403);
  checks++;
  await request({ action: "purgeFiles", id }, a.cookie);
  r = await mf.dispatchFetch("https://adviser.test/api/files/" + file.id, {
    headers: { cookie: c.cookie },
  });
  assert.equal(r.status, 404);
  checks++;
  // Both services use review-before-payment; writing does not require an existing file.
  const writing = (
    await request({ action: "create", service: "write" }, c.cookie)
  ).d.id;
  await request(
    { action: "submit", id: writing, form, consent: true },
    c.cookie,
  );
  await request({ action: "approve", id: writing }, a.cookie);
  // Old unfinished applications remain recoverable, including bank requests already recorded.
  const legacy = (
    await request({ action: "create", service: "write" }, c.cookie)
  ).d.id;
  await db
    .prepare(
      "UPDATE orders SET status='payment',payment='bank_requested' WHERE id=?",
    )
    .bind(legacy)
    .run();
  await request({ action: "confirmPayment", id: legacy }, a.cookie, 400);
  await request(
    { action: "submit", id: legacy, form, consent: true },
    c.cookie,
  );
  await request({ action: "approve", id: legacy }, a.cookie);
  await request({ action: "confirmPayment", id: legacy }, a.cookie);
  const paidLegacy = (
    await request({ action: "create", service: "write" }, c.cookie)
  ).d.id;
  await db
    .prepare("UPDATE orders SET status='draft',payment='paid' WHERE id=?")
    .bind(paidLegacy)
    .run();
  await request(
    { action: "submit", id: paidLegacy, form, consent: true },
    c.cookie,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM orders WHERE id=?")
        .bind(paidLegacy)
        .first()
    ).status,
    "received",
  );
  checks++;
  await request(
    { action: "status", id: paidLegacy, status: "working" },
    a.cookie,
  );
  await request(
    {
      action: "password",
      current: "test-customer-password",
      password: "new-customer-password",
    },
    c.cookie,
  );
  await request({ action: "create", service: "edit" }, c.cookie, 401);
  await request({
    action: "login",
    email: "customer@example.test",
    password: "new-customer-password",
  });
  console.log(
    `PASS: ${checks} authentication, ownership, payment, application, upload, chat and revision checks`,
  );
} finally {
  await mf.dispose();
}
