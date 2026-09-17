import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, configureRuntime } from "../server/runtime.ts";
import { passwordHash, verify } from "../server/password.ts";
import { route } from "../server/router.ts";
const dir = mkdtempSync(join(tmpdir(), "adviser-security-"));
let runtime = createRuntime(dir, "https://adviser.test");
configureRuntime(runtime);
runtime.ADMIN_PASSWORD_HASH = await passwordHash("test-admin-password");
after(() => {
  runtime.DB.close();
  rmSync(dir, { recursive: true, force: true });
});
async function post(
  body: unknown,
  cookie = "",
  origin = "https://adviser.test",
) {
  return route(
    new Request("https://adviser.test/api/workspace", {
      method: "POST",
      headers: { cookie, origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
async function account(email: string) {
  const r = await post({
    action: "register",
    name: "고객",
    email,
    password: "test-customer-password",
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie")!.split(";")[0];
}
test("password hashes use random salts and reject incorrect credentials", async () => {
  const a = await passwordHash("test-customer-password"),
    b = await passwordHash("test-customer-password");
  assert.notEqual(a, b);
  assert.ok(a.startsWith("scrypt$32768$"));
  assert.equal(await verify("test-customer-password", a), true);
  assert.equal(await verify("wrong-password", a), false);
  assert.equal(await verify("test-customer-password", "corrupt"), false);
});
test("session secrets stay out of DB and response; logout revokes them", async () => {
  const r = await post({
    action: "register",
    name: "계정",
    email: "tokens@example.test",
    password: "test-customer-password",
    role: "admin",
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")!;
  for (const flag of ["HttpOnly", "Secure", "SameSite=Lax"])
    assert.ok(cookie.includes(flag));
  const token = cookie.split(";")[0],
    raw = token.split("=")[1];
  assert.equal(
    (
      await runtime.DB.prepare("SELECT role FROM users WHERE email=?")
        .bind("tokens@example.test")
        .first<any>()
    ).role,
    "customer",
  );
  assert.equal(
    await runtime.DB.prepare("SELECT token FROM sessions WHERE token=?")
      .bind(raw)
      .first(),
    null,
  );
  const response = await route(
    new Request("https://adviser.test/api/workspace", {
      headers: { cookie: token },
    }),
  );
  const data = await response.json();
  assert.equal(data.user.password, undefined);
  assert.equal(data.user.token, undefined);
  assert.ok(!JSON.stringify(data).includes(raw));
  assert.equal((await post({ action: "logout" }, token)).status, 200);
  assert.equal(
    (await post({ action: "create", service: "write" }, token)).status,
    401,
  );
  assert.equal((await post({ action: "logout" }, token)).status, 200);
});
test("missing and foreign origins are rejected, including form-style login", async () => {
  for (const origin of ["", "null", "https://evil.example"])
    assert.equal((await post({ action: "login" }, "", origin)).status, 403);
  const r = await route(
    new Request("https://adviser.test/api/workspace", {
      method: "POST",
      headers: { origin: "https://adviser.test", "Content-Type": "text/plain" },
      body: "{}",
    }),
  );
  assert.equal(r.status, 415);
});
test("expiry and durable rate limiting", async () => {
  const cookie = await account("expiry@example.test");
  await runtime.DB.prepare(
    "UPDATE sessions SET expires=0 WHERE user_id=(SELECT id FROM users WHERE email='expiry@example.test')",
  ).run();
  assert.equal(
    (await post({ action: "create", service: "write" }, cookie)).status,
    401,
  );
  for (let i = 0; i < 9; i++)
    await post({
      action: "login",
      email: "nobody@example.test",
      password: "bad",
    });
  await post({
    action: "login",
    email: "nobody@example.test",
    password: "bad",
  });
  assert.equal(
    (
      await post({
        action: "login",
        email: "nobody@example.test",
        password: "bad",
      })
    ).status,
    429,
  );
});
test("concurrent approval produces one transition and notification; rejected applications cannot pay", async () => {
  const cookie = await account("review@example.test");
  const admin = (
    await post({
      action: "login",
      email: "ADMIN",
      password: "test-admin-password",
    })
  ).headers
    .get("set-cookie")!
    .split(";")[0];
  const id = (
    await (await post({ action: "create", service: "write" }, cookie)).json()
  ).id;
  const form = {
    institution: "기관",
    job: "기획",
    education: "졸업",
    career: "없음",
    experience: "경험",
    questions: "질문: 지원 동기 / 1000자",
    deadline: "2099-12-01",
    notes: "",
  };
  assert.equal(
    (
      await post(
        {
          action: "submit",
          id,
          form: { ...form, deadline: "2099-02-31" },
          consent: true,
        },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await post({ action: "submit", id, form, consent: true }, cookie)).status,
    200,
  );
  const results = await Promise.all([
    post({ action: "approve", id }, admin),
    post({ action: "approve", id }, admin),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 400]);
  assert.equal(
    (
      await runtime.DB.prepare(
        "SELECT COUNT(*) n FROM messages WHERE order_id=? AND body LIKE '서류 검토가 완료%'",
      )
        .bind(id)
        .first<any>()
    ).n,
    1,
  );
  const rejected = (
    await (await post({ action: "create", service: "write" }, cookie)).json()
  ).id;
  await post({ action: "submit", id: rejected, form, consent: true }, cookie);
  assert.equal(
    (
      await post(
        { action: "reject", id: rejected, reason: "일정 조율이 필요합니다." },
        cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        { action: "reject", id: rejected, reason: "일정 조율이 필요합니다." },
        admin,
      )
    ).status,
    200,
  );
  assert.equal(
    (await post({ action: "bank", id: rejected }, cookie)).status,
    400,
  );
});
test("database and private files survive restart and migrations are repeatable", async () => {
  const id = crypto.randomUUID();
  await runtime.BUCKET.put(
    id,
    new TextEncoder().encode("persistent document").buffer,
  );
  const count = (
    await runtime.DB.prepare("SELECT COUNT(*) n FROM users").first<any>()
  ).n;
  runtime.DB.close();
  runtime = createRuntime(dir, "https://adviser.test");
  configureRuntime(runtime);
  assert.equal(
    (await runtime.DB.prepare("SELECT COUNT(*) n FROM users").first<any>()).n,
    count,
  );
  assert.equal(
    new TextDecoder().decode((await runtime.BUCKET.get(id))!.body),
    "persistent document",
  );
  assert.throws(() => runtime.BUCKET.path("../../etc/passwd"));
  assert.ok(
    !readFileSync(join(dir, "adviser.sqlite")).includes(
      Buffer.from("test-customer-password"),
    ),
  );
});
