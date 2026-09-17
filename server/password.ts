import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((res, rej) =>
    scryptCallback(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (e, key) => (e ? rej(e) : res(key)),
    ),
  );
}
export async function passwordHash(
  password: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `scrypt$32768$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verify(password: string, stored: string) {
  const [, cost, salt, hex] = stored.split("$");
  const valid =
    stored.startsWith("scrypt$") &&
    cost === "32768" &&
    /^[a-f0-9]{32}$/.test(salt || "") &&
    /^[a-f0-9]{128}$/.test(hex || "");
  const got = await derive(
    password,
    valid ? salt : "00000000000000000000000000000000",
  );
  return (
    timingSafeEqual(got, Buffer.from(valid ? hex : "0".repeat(128), "hex")) &&
    valid
  );
}
