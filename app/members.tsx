import { useCallback, useEffect, useState } from "react";
import { Trash2, UsersRound } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

type Member = {
  id: string;
  name: string;
  email: string;
  created: number;
  order_count: number;
};

export default function Members({
  onDelete,
}: {
  onDelete: (id: string, email: string) => Promise<boolean | null>;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Member | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/workspace?members=1");
    const data = await r.json();
    if (!r.ok)
      throw new Error(data.error || "회원 목록을 불러오지 못했습니다.");
    setMembers(data.members);
    setError("");
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    const timer = setInterval(
      () => refresh().catch((e) => setError(e.message)),
      10000,
    );
    return () => clearInterval(timer);
  }, [refresh]);
  const shown = members.filter((m) =>
    (m.name + " " + m.email)
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  async function remove() {
    if (!selected || deleting) return;
    setDeleting(true);
    try {
      if (await onDelete(selected.id, confirmEmail)) {
        setMembers((rows) => rows.filter((m) => m.id !== selected.id));
        setSelected(null);
        setConfirmEmail("");
      }
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">MEMBER MANAGEMENT</span>
          <h1>회원 관리</h1>
          <p>가입한 고객을 확인하고 계정을 관리하세요.</p>
        </div>
        <span className="badge">
          <UsersRound size={16} /> 고객 {members.length}명
        </span>
      </div>
      <label className="member-search">
        회원 검색
        <input
          type="search"
          placeholder="이름 또는 이메일로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      {error && (
        <p className="member-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="muted">회원 목록을 불러오고 있어요.</p>
      ) : (
        <div className="member-list" role="list" aria-label="고객 회원 목록">
          {shown.map((m) => (
            <div className="member-row" role="listitem" key={m.id}>
              <div className="member-identity">
                <strong>{m.name}</strong>
                <span>{m.email}</span>
              </div>
              <div className="member-meta">
                <span>신청 {m.order_count}건</span>
                <span>
                  {new Date(m.created).toLocaleDateString("ko-KR")} 가입
                </span>
              </div>
              <button
                className="btn secondary member-delete"
                aria-label={m.email + " 계정 삭제"}
                onClick={() => {
                  setSelected(m);
                  setConfirmEmail("");
                }}
              >
                <Trash2 size={16} /> 계정 삭제
              </button>
            </div>
          ))}
          {!shown.length && !error && (
            <div className="panel member-empty">
              <h2>{search ? "검색 결과가 없어요" : "가입한 고객이 없어요"}</h2>
              <p className="muted">
                관리자 계정은 삭제 대상에 표시되지 않습니다.
              </p>
            </div>
          )}
        </div>
      )}
      <p className="fine member-help">
        계정을 삭제하면 로그인 정보가 삭제되고 모든 접속이 종료됩니다. 기존
        작업·대화·첨부·결제 기록은 관리자에게 남습니다.
      </p>
      <AlertDialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !deleting) setSelected(null);
        }}
      >
        <AlertDialogContent className="member-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>이 회원의 계정을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              이름·이메일·비밀번호와 로그인 세션을 삭제합니다. 이 계정으로 �