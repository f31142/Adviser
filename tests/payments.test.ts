import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, configureRuntime } from "../server/runtime.ts";
import { passwordHash } from "../server/password.ts";
import { route } from "../server/router.ts";
const dir = mkdtempSync(join(tmpdir(), "adviser-payments-"));
const runtime = createRuntime(dir, "https://adviser.test");
configureRuntime(runtime);
runtime.ADMIN_PASSWORD_HASH = await passwordHash("test-admin-password");
after(() => {
  runtime.DB.close();
  rmSync(dir, { recursive: true, force: true });
});
async function post(body: any, cookie = "", payments = false) {
  const r = await route(
    new Request(
      "https://adviser.test/api/" + (payments ? "payments" : "workspace"),
      {
        method: "POST",
        headers: {
          cookie,
          origin: "https://adviser.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    ),
  );
  return {
    status: r.status,
    data: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0] || cookie,
  };
}
const admin = (
  await post({
    action: "login",
    email: "ADMIN",
    password: "test-admin-password",
  })
).cookie;
const customer = (
  await post({
    action: "register",
    name: "고객",
    email: "customer@example.test",
    password: "test-customer-password",
  })
).cookie;
const other = (
  await post({
    action: "register",
    name: "다른 고객",
    email: "other@example.test",
    password: "test-customer-password",
  })
).cookie;
const form = {
  institution: "기관",
  job: "기획",
  education: "졸업",
  career: "없음",
  experience: "경험",
  questions: "지원 동기 / 1000자",
  deadline: "2099-12-01",
  notes: "",
};
async function approved() {
  const id = (await post({ action: "create", service: "write" }, customer)).data
    .id;
  await post({ action: "submit", id, form, consent: true }, customer);
  await post({ action: "approve", id }, admin);
  return id;
}
test("payments remain disabled without merchant configuration", async () => {
  const id = await approved();
  assert.equal(
    (await post({ action: "checkout", id }, customer, true)).status,
    503,
  );
});
test("only owner of an approved order can open checkout; client price is ignored", async () => {
  runtime.TOSS_CLIENT_KEY = "test_ck_placeholder";
  runtime.TOSS_SECRET_KEY = "test_sk_placeholder";
  const id = (await post({ action: "create", service: "write" }, customer)).data
    .id;
  assert.equal(
    (await post({ action: "checkout", id }, customer, true)).status,
    400,
  );
  await post({ action: "submit", id, form, consent: true }, customer);
  await post({ action: "approve", id }, admin);
  assert.equal(
    (await post({ action: "checkout", id }, other, true)).status,
    404,
  );
  assert.equal(
    (await post({ action: "checkout", id }, admin, true)).status,
    403,
  );
  const p = await post({ action: "checkout", id, amount: 1 }, customer, true);
  assert.equal(p.status, 200);
  assert.equal(p.data.amount, 100000);
  assert.equal(p.data.secretKey, undefined);
});
test("confirmation validates amount and provider response, is idempotent and records full refunds", async () => {
  const id = await approved();
  const p = (await post({ action: "checkout", id }, customer, true)).data;
  let calls = 0,
    canceled = false;
  runtime.paymentFetch = async (input, init) => {
    calls++;
    assert.ok(
      String(input).startsWith("https://api.tosspayments.com/v1/payments"),
    );
    assert.ok(
      new Headers(init?.headers).get("Authorization")?.startsWith("Basic "),
    );
    if (init?.method === "POST")
      assert.equal(new Headers(init.headers).get("Idempotency-Key"), p.orderId);
    return Response.json({
      orderId: p.orderId,
      paymentKey: "payment_test_123",
      currency: "KRW",
      totalAmount: 100000,
      balanceAmount: canceled ? 0 : 100000,
      status: canceled ? "CANCELED" : "DONE",
    });
  };
  const body = {
    action: "confirm",
    orderId: p.orderId,
    paymentKey: "payment_test_123",
    amount: 100000,
  };
  assert.equal(
    (await post({ ...body, amount: 1 }, customer, true)).status,
    400,
  );
  assert.equal(calls, 0);
  assert.equal((await post(body, other, true)).status, 404);
  assert.equal(calls, 0);
  const results = await Promise.all([
    post(body, customer, true),
    post(body, customer, true),
  ]);
  assert.deepEqual(
    results.map((x) => x.status),
    [200, 200],
  );
  assert.equal(calls, 1);
  assert.equal(
    (
      await runtime.DB.prepare("SELECT payment FROM orders WHERE id=?")
        .bind(id)
        .first<any>()
    ).payment,
    "paid",
  );
  await post({ action: "cancel", id }, customer);
  assert.equal((await post({ action: "refund", id }, admin)).status, 400);
  canceled = true;
  assert.equal((await post({ action: "sync", id }, admin, true)).status, 200);
  assert.equal(
    (
      await runtime.DB.prepare("SELECT status FROM orders WHERE id=?")
        .bind(id)
        .first<any>()
    ).status,
    "refunded",
  );
});
test("mismatched response never marks paid; uncertain confirmation blocks another payment and can recover", async () => {
  const id = await approved();
  const p = (await post({ action: "checkout", id }, customer, true)).data;
  runtime.paymentFetch = async () =>
    Response.json({
      orderId: p.orderId,
      paymentKey: "payment_wrong_response",
      currency: "KRW",
      totalAmount: 1,
      status: "DONE",
    });
  assert.equal(
    (
      await post(
        {
          action: "confirm",
          orderId: p.orderId,
          paymentKey: "payment_wrong_response",
          amount: p.amount,
        },
        customer,
        true,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await runtime.DB.prepare("SELECT payment FROM orders WHERE id=?")
        .bind(id)
        .first<any>()
    ).payment,
    "unpaid",
  );
  assert.equal(
    (await post({ action: "checkout", id }, customer, true)).status,
    409,
  );
  assert.equal((await post({ action: "cancel", id }, customer)).status, 400);
  runtime.paymentFetch = async () =>
    Response.json({
      orderId: p.orderId,
      paymentKey: "payment_wrong_response",
      currency: "KRW",
      totalAmount: 100000,
      status: "DONE",
    });
  assert.equal(
    (await post({ action: "sync", id }, customer, true)).status,
    200,
  );
});
