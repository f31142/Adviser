import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
const directory = mkdtempSync(join(tmpdir(), "adviser-http-"));
const reserve = createServer();
await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
const port = (reserve.address() as any).port;
await new Promise<void>((r) => reserve.close(() => r()));
const origin = `http://localhost:${port}`;
let child: ReturnType<typeof spawn>;
async function start() {
  child = spawn(
    process.execPath,
    ["--experimental-strip-types", "server/index.ts"],
    {
      env: {
        ...process.env,
        PORT: String(port),
        APP_URL: origin,
        DATA_DIR: directory,
        ADMIN_PASSWORD: "initial-test-password",
        TRUST_PROXY: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    let logs = "";
    const timer = setTimeout(
      () => reject(new Error("Server start timed out")),
      10000,
    );
    child.on("exit", () => {
      clearTimeout(timer);
      reject(new Error("Server exited: " + logs));
    });
    child.stderr!.on("data", (d) => (logs += d));
    child.stdout!.on("data", (d) => {
      logs += d;
      if (logs.includes("Adviser listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}
async function stop() {
  if (child.exitCode !== null) return;
  await new Promise<void>((r) => {
    child.once("exit", () => r());
    child.kill("SIGTERM");
  });
}
await start();
after(async () => {
  await stop();
  rmSync(directory, { recursive: true, force: true });
});
async function post(body: unknown, cookie = "") {
  return fetch(origin + "/api/workspace", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}
test("production server serves the application and protects filesystem paths", async () => {
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.ok((await home.text()).includes('<html lang="ko">'));
  assert.ok(
    home.headers.get("Content-Security-Policy")?.includes("object-src 'none'"),
  );
  assert.equal((await fetch(origin + "/data/adviser.sqlite")).status, 404);
  assert.equal((await fetch(origin + "/.env")).status, 404);
  assert.equal((await fetch(origin + "/api/does-not-exist")).status, 404);
  const health = await fetch(origin + "/healthz");
  assert.deepEqual(await health.json(), { ok: true });
});
test("HTTP body limit applies even without Content-Length; malformed JSON is rejected", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(200001)));
      controller.close();
    },
  });
  const r = await fetch(origin + "/api/workspace", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  assert.equal(r.status, 413);
  const invalid = await fetch(origin + "/api/workspace", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: "{",
  });
  assert.equal(invalid.status, 400);
});
test("admin recovery and customer reset work against persistent storage without exposing secrets", async () => {
  const admin = await post({
    action: "login",
    email: "ADMIN",
    password: "initial-test-password",
  });
  assert.equal(admin.status, 200);
  const oldCookie = admin.headers.get("set-cookie")!.split(";")[0];
  assert.ok(!admin.headers.get("set-cookie")!.includes("Secure;"));
  const customer = await post({
    action: "register",
    email: "reset@example.test",
    name: "초기화 테스트",
    password: "customer-test-password",
  });
  assert.equal(customer.status, 200);
  await stop();
  const env = {
    ...process.env,
    DATA_DIR: directory,
    APP_URL: origin,
    RESET_PASSWORD: "replacement-test-password",
  };
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/admin.ts",
      "reset-password",
      "ADMIN",
    ],
    { env, stdio: "pipe" },
  );
  await start();
  assert.equal(
    (await post({ action: "create", service: "write" }, oldCookie)).status,
    401,
  );
  assert.equal(
    (
      await post({
        action: "login",
        email: "ADMIN",
        password: "initial-test-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post({
        action: "login",
        email: "ADMIN",
        password: "replacement-test-password",
      })
    ).status,
    200,
  );
  await stop();
  assert.throws(() =>
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "scripts/admin.ts", "reset-customers"],
      { env, stdio: "pipe" },
    ),
  );
  execFileSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "scripts/admin.ts",
      "reset-customers",
      "--confirm=DELETE-ALL-CUSTOMERS",
    ],
    { env, stdio: "pipe" },
  );
  await start();
  assert.equal(
    (
      await post({
        action: "login",
        email: "reset@example.test",
        password: "customer-test-password",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post({
        action: "login",
        email: "ADMIN",
        password: "replacement-test-password",
      })
    ).status,
    200,
  );
});
