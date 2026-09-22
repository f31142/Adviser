import { db, fail, now, response, uuid, type User } from "./core.ts";

export async function listMembers(u: User | null) {
  if (!u) fail("로그인이 필요합니다.", 401);
  if (u.role !== "admin") fail("관리자 권한이 필요합니다.", 403);
  const rows = await db()
    .prepare(
      "SELECT u.id,u.email,u.name,u.created,(SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) order_count FROM users u WHERE u.role='customer' AND u.deleted_at IS NULL ORDER BY u.created DESC,u.id",
    )
    .all();
  return response({ members: rows.results });
}

export async function deleteMember(u: User, input: any) {
  if (u.role !== "admin") fail("관리자 권한이 필요합니다.", 403);
  if (typeof input.memberId !== "string" || !input.memberId)
    fail("삭제할 회원을 선택해 주세요.");
  const member = await db()
    .prepare(
      "SELECT id,email,role FROM users WHERE id=? AND deleted_at IS NULL",
    )
    .bind(input.memberId)
    .first<{ id: string; email: string; role: string }>();
  if (!member) fail("회원이 없거나 이미 삭제되었습니다.", 404);
  if (member.id === u.id || member.role !== "customer")
    fail("관리자 계정은 삭제할 수 없습니다.", 403);
  if (
    typeof input.confirmEmail !== "string" ||
    input.confirmEmail.trim().toLowerCase() !== member.email
  )
    fail("삭제할 회원의 이메일을 정확하게 입력해 주세요.");
  if (
    await db()
      .prepare(
        "SELECT p.id FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.user_id=? AND p.status='CONFIRMING' LIMIT 1",
      )
      .bind(member.id)
      .first()
  )
    fail(
      "확인 중인 온라인 결제가 있습니다. 결제 상태를 확인한 후 삭제해 주세요.",
      409,
    );

  // Keep the historical owner ID for order/payment reconciliation. Erase login
  // credentials and revoke every session in the same transaction; no undo path.
  await db().batch([
    db()
      .prepare(
        "UPDATE users SET email=?,name='삭제된 회원',password='',deleted_at=?,deleted_by=? WHERE id=? AND role='customer' AND deleted_at IS NULL",
      )
      .bind("deleted:" + uuid(), now(), u.id, member.id),
    db().prepare("DELETE FROM sessions WHERE user_id=?").bind(member.id),
    db().prepare("DELETE FROM notices WHERE user_id=?").bind(member.id),
    db()
      .prepare(
        "UPDATE messages SET name='삭제된 회원' WHERE user_id=? AND role='customer'",
      )
      .bind(member.id),
  ]);
  return response({ ok: true });
}
