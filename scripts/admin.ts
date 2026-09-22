import { createRuntime, configureRuntime } from "../server/runtime.ts";
import { passwordHash } from "../server/password.ts";
import { readdirSync } from "node:fs";
import { validPassword, passwordRuleMessage } from "../lib/password-policy.ts";

const command = process.argv[2];
if (!["reset-password", "reset-customers"].includes(command)) {
  console.log(
    "npm run admin -- reset-password ADMIN\nnpm run admin -- reset-password user@example.com\nnpm run admin -- reset-customers --confirm=DELETE-ALL-CUSTOMERS",
  );
  process.exit(1);
}
const runtime = createRuntime(
  process.env.DATA_DIR || "./data",
  process.env.APP_URL || "http://localhost:3000",
);
configureRuntime(runtime);
try {
  if (command === "reset-password") {
    const email = (process.argv[3] || "ADMIN").trim().toLowerCase(),
      password = process.env.RESET_PASSWORD;
    if (!validPassword(password))
      throw new Error("RESET_PASSWORD: " + passwordRuleMessage);
    const user = await runtime.DB.prepare(
      "SELECT id FROM users WHERE email=? AND deleted_at IS NULL",
    )
      .bind(email)
      .first<{ id: string }>();
    if (!user)
      throw new Error(
        "해당 계정이 없습니다. 최초 관리자는 ADMIN_PASSWORD로 생성하세요.",
      );
    await runtime.DB.batch([
      runtime.DB.prepare("UPDATE users SET password=? WHERE id=?").bind(
        await passwordHash(password),
        user.id,
      ),
      runtime.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
    ]);
    delete process.env.RESET_PASSWORD;
    console.log("비밀번호를 변경하고 해당 계정의 모든 세션을 종료했습니다.");
  } else {
    // Offline maintenance only. Stop the web process and back up DATA_DIR first.
    if (!process.argv.includes("--confirm=DELETE-ALL-CUSTOMERS"))
      throw new Error(
        "서버 중지 및 백업 후 --confirm=DELETE-ALL-CUSTOMERS를 명시해야 실행됩니다.",
      );
    if (
      await runtime.DB.prepare(
        "SELECT id FROM payments WHERE status='CONFIRMING' LIMIT 1",
      ).first()
    )
      throw new Error(
        "결제 확인 중인 건이 있습니다. 결제를 정산한 후 초기화하세요.",
      );
    const statements = [
      "DELETE FROM notices",
      "DELETE FROM messages",
      "DELETE FROM files",
      "DELETE FROM payments",
      "DELETE FROM orders",
      "DELETE FROM sessions",
      "DELETE FROM limits",
      "DELETE FROM users WHERE role='customer'",
    ];
    await runtime.DB.batch(statements.map((s) => runtime.DB.prepare(s)));
    // Retry also removes orphans after a prior interrupted deletion.
    for (const id of readdirSync(runtime.BUCKET.directory))
      if (/^[a-f0-9-]{36}$/.test(id)) await runtime.BUCKET.delete(id);
    console.log(
      "고객 계정·신청·채팅·첨부·결제 기록과 모든 로그인 세션을 초기화했습니다. 관리자와 운영 설정은 유지됩니다.",
    );
  }
} finally {
  runtime.DB.close();
}
