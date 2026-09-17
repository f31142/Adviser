import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync, chmodSync } from "node:fs";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// One Node process owns one SQLite database and its private upload directory.
export class Statement {
  sql: DatabaseSync;
  text: string;
  values: (string | number | null)[];
  constructor(
    sql: DatabaseSync,
    text: string,
    values: (string | number | null)[] = [],
  ) {
    this.sql = sql;
    this.text = text;
    this.values = values;
  }
  bind(...values: (string | number | null)[]) {
    return new Statement(this.sql, this.text, values);
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sql.prepare(this.text).get(...this.values) as T) || null;
  }
  async all<T = Record<string, unknown>>() {
    return { results: this.sql.prepare(this.text).all(...this.values) as T[] };
  }
  async run() {
    return this.sql.prepare(this.text).run(...this.values);
  }
}
export class Database {
  sql: DatabaseSync;
  constructor(path: string) {
    this.sql = new DatabaseSync(path);
    this.sql.exec(
      "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS migrations(name TEXT PRIMARY KEY)",
    );
    const dir = new URL("../db/migrations/", import.meta.url);
    for (const name of readdirSync(dir)
      .filter((x) => x.endsWith(".sql"))
      .sort()) {
      if (
        this.sql.prepare("SELECT name FROM migrations WHERE name=?").get(name)
      )
        continue;
      this.sql.exec("BEGIN IMMEDIATE");
      try {
        this.sql.exec(readFileSync(new URL(name, dir), "utf8"));
        this.sql.prepare("INSERT INTO migrations VALUES(?)").run(name);
        this.sql.exec("COMMIT");
      } catch (e) {
        this.sql.exec("ROLLBACK");
        throw e;
      }
    }
  }
  prepare(text: string) {
    return new Statement(this.sql, text);
  }
  async batch(statements: Statement[]) {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      // No await inside the transaction: other requests cannot observe half a batch.
      const out = statements.map((s) => s.sql.prepare(s.text).run(...s.values));
      this.sql.exec("COMMIT");
      return out;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.sql.close();
  }
}
export class PrivateFiles {
  directory: string;
  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid file identifier");
    return join(this.directory, id);
  }
  async put(id: string, bytes: ArrayBuffer, _options?: unknown) {
    const path = this.path(id),
      tmp = path + "." + randomUUID() + ".tmp";
    await writeFile(tmp, new Uint8Array(bytes), { mode: 0o600, flag: "wx" });
    await rename(tmp, path);
  }
  async get(id: string) {
    try {
      return { body: new Uint8Array(await readFile(this.path(id))) };
    } catch (e: any) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async delete(id: string) {
    try {
      await unlink(this.path(id));
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}
export type Runtime = {
  DB: Database;
  BUCKET: PrivateFiles;
  ADMIN_PASSWORD_HASH?: string;
  APP_URL: string;
  TOSS_CLIENT_KEY?: string;
  TOSS_SECRET_KEY?: string;
  paymentFetch: typeof fetch;
};
let current: Runtime | undefined;
export function configureRuntime(runtime: Runtime) {
  current = runtime;
}
export function bindings(): Runtime {
  if (!current) throw new Error("Runtime not initialized");
  return current;
}
export function createRuntime(directory: string, appUrl: string): Runtime {
  const dir = resolve(directory);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "adviser.sqlite");
  const DB = new Database(path);
  chmodSync(path, 0o600);
  return {
    DB,
    BUCKET: new PrivateFiles(join(dir, "files")),
    APP_URL: new URL(appUrl).origin,
    TOSS_CLIENT_KEY: process.env.TOSS_CLIENT_KEY,
    TOSS_SECRET_KEY: process.env.TOSS_SECRET_KEY,
    paymentFetch: fetch,
  };
}

// Serializes state-changing requests, including file IO and payment confirmation.
// Persistent conditional updates and provider idempotency also protect restarts.
let tail: Promise<unknown> = Promise.resolve(),
  pending = 0;
export async function mutate<T>(fn: () => Promise<T>): Promise<T> {
  if (pending >= 100)
    throw Object.assign(
      new Error("요청이 많습니다. 잠시 후 다시 시도해 주세요."),
      { status: 503 },
    );
  pending++;
  const result = tail.then(fn);
  tail = result.catch(() => {});
  try {
    return await result;
  } finally {
    pending--;
  }
}
