export const passwordRuleMessage =
  "비밀번호는 8~16자이며 특수문자를 1개 이상 포함해야 합니다.";
export function validPassword(password: unknown): password is string {
  return (
    typeof password === "string" &&
    password.length >= 8 &&
    password.length <= 16 &&
    /[^\p{L}\p{N}\s]/u.test(password)
  );
}
