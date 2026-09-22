import { bindings } from "../../../server/runtime.ts";
export { bindings };
export { passwordHash, verify } from "../../../server/password.ts";
export const db = () => bindings().DB;
export const now = () => Date.now();
export const uuid = () => crypto.randomUUID();
export const defaults = {
  editPrice: 100000,
  writePrice: 100000,
  revisionLimit: 0,
  bank: "",
  account: "",
  holder: "",
  policy: "",
  retention: "",
};
export async function config() {
  const r = await db()
    .prepare("SELECT value FROM settings WHERE key=?")
    .bind("config")
    .first<{ value: string }>();
  return { ...defaults, ...(r ? JSON.parse(r.value) : {}) };
}
const hex = (a: ArrayBuffer) =>
  Array.from(new Uint8Array(a), (v) => v.toString(16).padStart(2, "0")).join(
    "",
  );
export async function digest(s: string) {
  return hex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
  );
}
export type User = { id: string; email: string; name: string; role: string };
export async function user(req: Request): Promise<User | null> {
  const token = req.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)adviser_session=([^;]+)/)?.[1];
  if (!token) return null;
  return db()
    .prepare(
      "SELECT u.id,u.email,u.name,u.role FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.deleted_at IS NULL",
    )
    .bind(await digest(token), now())
    .first<User>();
}
export function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
export async function own(id: string, u: User) {
  const row = await db()
    .prepare("SELECT * FROM orders WHERE id=?")
    .bind(id)
    .first<any>();
  if (!row || (u.role !== "admin" && row.user_id !== u.id))
    fail("작업을 찾을 수 없습니다.", 404);
  return row;
}
export function safe(req: Request) {
  const origin = req.headers.get("origin");
  if (origin !== bindings().APP_URL) fail("허용되지 않은 요청입니다.", 403);
  if (req.headers.get("sec-fetch-site") === "cross-site")
    fail("허용되지 않은 요청입니다.", 403);
}
export function response(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
export function error(e: any) {
  if (e instanceof SyntaxError)
    return response({ error: "요청 형식을 확인해 주세요." }, 400);
  if (!e.status) console.error("Workspace request failed", e?.name);
  return response(
    {
      error: e.status
        ? e.message
        : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    },
    e.status || 503,
  );
}
export async function limited(key: string, max = 10) {
  const t = now();
  const k = await digest(key + ":" + Math.floor(t / 900000));
  const r = await db()
    .prepare(
      "INSERT INTO limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    )
    .bind(k, t + 900000)
    .first<{ count: number }>();
  if ((r?.count || 0) > max)
    fail("시도가 너무 많습니다. 15분 후 다시 시도해 주세요.", 429);
}
export function n