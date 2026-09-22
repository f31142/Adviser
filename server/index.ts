import { createServer } from "node:http";
import { Readable } from "node:stream";
import { closeEventStreams } from "./events.ts";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { createRuntime, configureRuntime } from "./runtime.ts";
import { passwordHash } from "./password.ts";
import { route } from "./router.ts";
import { error, fail } from "../app/api/workspace/core.ts";

const dev = process.argv.includes("--dev");
const appUrl =
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "http://localhost:3000";
const origin = new URL(appUrl).origin;
if (
  !dev &&
  new URL(origin).protocol !== "https:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname)
)
  throw new Error("Production APP_URL must use HTTPS");
const runtime = createRuntime(process.env.DATA_DIR || "./data", origin);
configureRuntime(runtime);
if (process.env.ADMIN_PASSWORD) {
  if (
    process.env.ADMIN_PASSWORD.length < 7 ||
    process.env.ADMIN_PASSWORD.length > 128
  )
    throw new Error("ADMIN_PASSWORD must contain 7–128 characters");
  const hash = await passwordHash(process.env.ADMIN_PASSWORD);
  await runtime.DB.prepare(
    "INSERT OR IGNORE INTO users(id,email,name,password,role,created) VALUES('administrator','admin','관리자',?,'admin',?)",
  )
    .bind(hash, Date.now())
    .run();
  delete process.env.ADMIN_PASSWORD;
}
if (
  !(await runtime.DB.prepare("SELECT id FROM users WHERE role='admin'").first())
)
  console.warn(
    "관리자 계정이 없습니다. ADMIN_PASSWORD를 설정하고 다시 시작하세요.",
  );
const clean = () => {
  runtime.DB.sql
    .prepare("DELETE FROM sessions WHERE expires<?")
    .run(Date.now());
  runtime.DB.sql.prepare("DELETE FROM limits WHERE expires<?").run(Date.now());
};
clean();
const cleanup = setInterval(clean, 60 * 60 * 1000);
cleanup.unref();
const vite = dev
  ? await (
      await import("vite")
    ).createServer({
      server: {
        middlewareMode: true,
        allowedHosts: [new URL(origin).hostname],
      },
      appType: "spa",
    })
  : null;
const dist = resolve("dist");
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (!dev) {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://js.tosspayments.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tosspayments.com; connect-src 'self' https://*.tosspayments.com; frame-src https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    if (origin.startsWith("https:"))
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
  try {
    const url = new URL(req.url || "/", origin);
    if (url.origin !== origin) fail("허용되지 않은 요청입니다.", 400);
    if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
      }
      // Never trust a caller-supplied client address. Only the final proxy hop is used.
      const forwarded =
        process.env.TRUST_PROXY === "true"
          ? String(req.headers["x-forwarded-for"] || "")
              .split(",")
              .pop()
              ?.trim()
          : "";
      headers.set(
        "x-adviser-client-ip",
        forwarded || req.socket.remoteAddress || "unknown",
      );
      const limit = url.pathname === "/api/files" ? 16 * 1024 * 1024 : 200000;
      if (Number(req.headers["content-length"] || 0) > limit)
        fail("요청 크기가 너무 큽니다.", 413);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) fail("요청 크기가 너무 큽니다.", 413);
        chunks.push(chunk);
      }
      const abort = new AbortController();
      res.once("close", () => abort.abort());
      const response = await route(
        new Request(url, {
          method: req.method,
          headers,
          signal: abort.signal,
          body: ["GET", "HEAD"].includes(req.method || "GET")
            ? undefined
            : Buffer.concat(chunks),
        }),
      );
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (
        response.body &&
        response.headers.get("Content-Type")?.startsWith("text/event-stream")
      ) {
        res.flushHeaders();
        const stream = Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream,
        );
        res.once("close", () => stream.destroy());
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      } else res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (vite) {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end("Not found");
      });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method || ""))
      fail("허용되지 않은 요청입니다.", 405);
    let file = resolve(dist, "." + decodeURIComponent(url.pathname));
    if (file !== dist && !file.startsWith(dist + sep))
      fail("찾을 수 없습니다.", 404);
    if (
      url.pathname === "/" ||
      url.pathname === "/payment/success" ||
      url.pathname === "/payment/fail"
    )
      file = resolve(dist, "index.html");
    if (!(await stat(file).catch(() => null))?.isFile())
      fail("찾을 수 없습니다.", 404);
    res.setHeader(
      "Content-Type",
      mime[extname(file)] || "application/octet-stream",
    );
    res.setHeader(
      "Cache-Control",
      url.pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    res.end(req.method === "HEAD" ? undefined : await readFile(file));
  } catch (e) {
    const response = error(e);
    res.statusCode = response.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(await response.text());
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(`Adviser listening on port ${process.env.PORT || 3000}`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(cleanup);
  closeEventStreams();
  await vite?.close();
  server.close(() => {
    runtime.DB.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
