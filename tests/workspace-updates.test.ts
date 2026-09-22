import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime, configureRuntime } from "../server/runtime.ts";
import { passwordHash } from "../server/password.ts";
import { route } from "../server/router.ts";
import { closeEventStreams } from "../server/events.ts";
import { readRoute, routeUrl } from "../app/navigation.ts";

const origin = "https://adviser.test";
const directory = mkdtempSync(join(tmpdir(), "adviser-updates-"));
const runtime = createRuntime(directory, origin);
configureRuntime(runtime);
runtime.ADMIN_PASSWORD_HASH = await passwordHash("Legacy!");
after(() => {
  closeEventStreams();
  runtime.DB.close();
  rmSync(directory, { recursive: true, force: true });
});
function post(body: unknown, cookie = "") {
  return route(
    new Request(origin + "/api/workspace", {
      method: "POST",
      headers: { origin, cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}
function session(response: Response) {
  return response.headers.get("set-cookie")!.split(";")[0];
}

test("registration and password changes enforce 8–16 characters with a special character", async () => {
  const invalid = [
    "123456!",
    "1234567890123456!",
    "abcdefgh",
    "abcdefg ",
    "가나다라마바사아",
    "abcdefgh12345678",
  ];
  for (const [index, password] of invalid.entries()) {
    const email = `invalid${index}@example.test`;
    const response = await post({
      action: "register",
      email,
      name: "테스트",
      password,
    });
    assert.equal(response.status, 400, password);
    assert.equal(
      await runtime.DB.prepare("SELECT id FROM users WHERE email=?")
        .bind(email)
        .first(),
      null,
    );
  }
  for (const [index, password] of [
    "1234567!",
    "123456789012345!",
    "가나다라마바사!",
  ].entries()) {
    const response = await post({
      action: "register",
      email: `valid${index}@example.test`,
      name: "테스트",
      password,
    });
    assert.equal(response.status, 200, password);
    const cookie = session(response);
    assert.equal(
      (
        await post(
          { action: "password", current: password, password: "nospecial" },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          { action: "password", current: password, password: "123456!" },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          {
            action: "password",
            current: password,
            password: "1234567890123456!",
          },
          cookie,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          { action: "password", current: password, password: "Changed!" },
          cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await post({ action: "create", service: "write" }, cookie)).status,
      401,
    );
  }
});

test("legacy admin credentials still use ordinary login; stream cancellation releases its resources", async () => {
  const login = await post({
    action: "login",
    email: "ADMIN",
    password: "Legacy!",
  });
  assert.equal(login.status, 200);
  const cookie = session(login);
  const me = await (
    await route(new Request(origin + "/api/workspace", { headers: { cookie } }))
  ).json();
  assert.equal(me.user.role, "admin");
  assert.equal(
    (await post({ action: "create", service: "write" }, cookie)).status,
    403,
  );
  const response = await route(
    new Request(origin + "/api/events", { headers: { cookie } }),
  );
  assert.equal(response.status, 200);
  await assert.doesNotReject(response.body!.cancel());
  assert.equal((await post({ action: "logout" }, cookie)).status, 200);
  assert.equal(
    (await route(new Request(origin + "/api/events", { headers: { cookie } })))
      .status,
    401,
  );
});

test("screen URLs retain details, admin pages and signup selection when reloaded", () => {
  for (const view of [
    "services",
    "orders",
    "detail",
    "members",
    "settings",
    "notices",
    "account",
    "policies",
  ]) {
    const screen = {
      view,
      order: view === "detail" ? "an-order-id" : "",
      mode: "login" as const,
      service: "",
    };
    assert.deepEqual(readRoute(origin + routeUrl(screen)), screen);
  }
  const signup = {
    view: "auth",
    order: "",
    mode: "register" as const,
    service: "edit",
  };
  assert.deepEqual(readRoute(routeUrl(signup)), signup);
  assert.equal(readRoute("/?view=detail").view, "orders");
  assert.equal(readRoute("/?view=unknown").view, "services");
  assert.equal(readRoute("/?view=auth&service=invalid").service, "");
  assert.equal(
    routeUrl(readRoute("/?view=orders&password=secret&token=secret")),
    "/?view=orders",
  );
});
