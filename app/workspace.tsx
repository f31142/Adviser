"use client";
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type FormEvent,
} from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  FileText,
  PenLine,
  MessageSquare,
  Check,
  LockKeyhole,
  Paperclip,
  Send,
  Bell,
  LogOut,
  Settings,
  Download,
  Clock,
  ShieldCheck,
  CreditCard,
  Landmark,
  UserRound,
  FolderOpen,
  ChevronRight,
  CheckCircle2,
  LoaderCircle,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { checkout, paymentApi } from "./payments";
const titles: Record<string, string> = {
  edit: "기존 서류 첨삭",
  write: "초안 작성 지원",
};
const statuses: Record<string, string> = {
  payment: "신청서 작성",
  draft: "신청서 작성",
  approval: "관리자 검토 중",
  application_supplement: "신청서 보완 요청",
  approved: "승인 완료 · 결제 대기",
  received: "접수 완료",
  supplement: "자료 보완 요청",
  working: "작업 중",
  review: "고객 검토",
  complete: "작업 완료",
  cancel_requested: "취소 요청",
  cancelled: "취소 완료",
  refunded: "취소 처리 완료",
  rejected: "신청 반려",
};
const won = (n: number) => new Intl.NumberFormat("ko-KR").format(n) + "원";
const date = (n: number) =>
  new Date(n).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" });
const emptyForm = {
  institution: "",
  job: "",
  education: "",
  career: "",
  experience: "",
  questions: "",
  deadline: "",
  notes: "",
};
const initial = {
  user: null,
  orders: [],
  notices: [],
  config: {
    editPrice: 100000,
    writePrice: 100000,
    revisionLimit: 0,
    bank: "",
    account: "",
    holder: "",
    policy: "",
    retention: "",
  },
};
async function api(body: any) {
  const r = await fetch("/api/workspace", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await r.json();
  if (!r.ok) throw new Error(data.error || "처리하지 못했습니다.");
  return data;
}
function Choice({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (s: string) => void;
  items: Record<string, string>;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="choice">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(items).map(([k, v]) => (
          <SelectItem key={k} value={k}>
            {v}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function Adviser() {
  const [data, setData] = useState<any>(initial),
    [view, setView] = useState("services"),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [detail, setDetail] = useState<any>(null),
    [oid, setOid] = useState(""),
    [authMode, setAuthMode] = useState("login"),
    [pending, setPending] = useState(""),
    [form, setForm] = useState<any>(emptyForm),
    [chat, setChat] = useState(""),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState(""),
    [cfg, setCfg] = useState<any>(null),
    [confirm, setConfirm] = useState<any>(null),
    [consent, setConsent] = useState(false);
  const admin = data.user?.role === "admin";
  const paymentHandled = useRef(false);
  useEffect(() => {
    if (loading || paymentHandled.current) return;
    const url = new URL(window.location.href);
    if (!url.pathname.startsWith("/payment/")) return;
    if (url.pathname === "/payment/success" && !data.user) {
      setView("auth");
      setAuthMode("login");
      return;
    }
    paymentHandled.current = true;
    history.replaceState(null, "", "/");
    if (url.pathname === "/payment/fail") {
      toast.error(
        "결제가 취소되었거나 완료되지 않았습니다. 마이페이지에서 다시 진행해 주세요.",
      );
      setView(data.user ? "orders" : "services");
      return;
    }
    run(async () => {
      const p = await paymentApi({
        action: "confirm",
        orderId: url.searchParams.get("orderId"),
        paymentKey: url.searchParams.get("paymentKey"),
        amount: Number(url.searchParams.get("amount")),
      });
      await refresh();
      await loadDetail(p.id, true);
      setOid(p.id);
      setView("detail");
      toast.success("결제가 확인되었습니다.");
    });
  }, [loading, data.user]);
  const refresh = useCallback(async () => {
    const r = await fetch("/api/workspace");
    const d: any = await r.json();
    if (!r.ok) throw new Error(d.error);
    setData(d);
    setError("");
    if (!d.user) {
      setOid("");
      setDetail(null);
      setView((v) =>
        ["detail", "orders", "notices", "account", "settings"].includes(v)
          ? "auth"
          : v,
      );
    }
    return d;
  }, []);
  const loadDetail = useCallback(async (id: string, reset = false) => {
    const r = await fetch("/api/workspace?order=" + encodeURIComponent(id));
    const d: any = await r.json();
    if (!r.ok) throw new Error(d.error);
    setDetail(d);
    if (reset) setForm({ ...emptyForm, ...JSON.parse(d.order.form) });
    return d;
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (!data.user) return;
    const timer = setInterval(() => {
      refresh().catch(() => {});
      if (oid) loadDetail(oid).catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [data.user?.id, oid, refresh, loadDetail]);
  async function run(fn: () => Promise<any>) {
    if (busy) return;
    setBusy(true);
    try {
      return await fn();
    } catch (e: any) {
      toast.error(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function openOrder(id: string) {
    await run(async () => {
      await loadDetail(id, true);
      setOid(id);
      setView("detail");
      setChat("");
      setConsent(false);
    });
  }
  async function start(service: string) {
    if (!data.user) {
      setPending(service);
      setAuthMode("register");
      setView("auth");
      return;
    }
    await run(async () => {
      const r = await api({ action: "create", service });
      await refresh();
      await loadDetail(r.id, true);
      setOid(r.id);
      setView("detail");
    });
  }
  function navigate(v: string) {
    setView(v);
    setOid("");
    setDetail(null);
    if (v === "settings") setCfg({ ...data.config });
  }
  async function act(action: string, extra: any = {}) {
    return run(async () => {
      await api({ action, id: oid, ...extra });
      await refresh();
      if (oid) await loadDetail(oid);
      toast.success("반영되었습니다.");
      return true;
    });
  }
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await run(async () => {
      await api({
        action: authMode === "register" ? "register" : "login",
        email: fd.get("email"),
        password: fd.get("password"),
        name: fd.get("name"),
      });
      const d = await refresh();
      if (pending && d.user.role !== "admin") {
        const r = await api({ action: "create", service: pending });
        await loadDetail(r.id, true);
        setOid(r.id);
        setView("detail");
        setPending("");
        await refresh();
      } else setView(d.user.role === "admin" ? "orders" : "services");
    });
  }
  async function upload(file: File | undefined, kind = "source") {
    if (!file) return;
    await run(async () => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("id", oid);
      fd.append("kind", kind);
      const r = await fetch("/api/files", { method: "POST", body: fd });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error);
      await loadDetail(oid);
      toast.success("파일을 첨부했습니다.");
    });
  }
  const unread = data.notices.filter((n: any) => !n.seen).length;
  const o = detail?.order;
  const steps = [
    "draft",
    "approval",
    "approved",
    "working",
    "review",
    "complete",
  ];
  const idx = o
    ? steps.indexOf(
        o.status === "payment"
          ? "draft"
          : o.status === "application_supplement"
            ? "approval"
            : ["received", "supplement"].includes(o.status)
              ? "working"
              : o.status,
      )
    : -1;
  return (
    <>
      <Toaster theme="light" richColors />
      <header className="topbar">
        <a href="/" className="brand">
          <span className="brand-mark">
            A<span />
          </span>
          Adviser<span className="brand-label">DOCUMENT STUDIO</span>
        </a>
        <nav aria-label="주 메뉴">
          <button
            className={view === "services" ? "active" : ""}
            onClick={() => navigate("services")}
          >
            서비스 신청
          </button>
          <button
            className={view === "orders" ? "active" : ""}
            onClick={() =>
              data.user
                ? navigate("orders")
                : (setView("auth"), setAuthMode("login"))
            }
          >
            {admin ? "전체 작업" : "마이페이지"}
          </button>
          {admin && (
            <button
              className={view === "settings" ? "active" : ""}
              onClick={() => navigate("settings")}
            >
              운영 설정
            </button>
          )}
        </nav>
        <div className="account">
          {data.user ? (
            <>
              <button
                aria-label={`알림 ${unread}개`}
                className="icon-button"
                onClick={() => navigate("notices")}
              >
                <Bell size={20} />
                {unread > 0 && (
                  <span className="notification-count">{unread}</span>
                )}
              </button>
              <button
                className="account-name"
                onClick={() => navigate("account")}
              >
                <span className="avatar">{data.user.name.slice(0, 1)}</span>
                {data.user.name}
              </button>
              <button
                className="icon-button"
                aria-label="로그아웃"
                onClick={() =>
                  run(async () => {
                    await api({ action: "logout" });
                    setPending("");
                    await refresh();
                    navigate("services");
                  })
                }
              >
                <LogOut size={18} />
                <span className="logout-label">로그아웃</span>
              </button>
            </>
          ) : (
            <button
              className="btn small"
              onClick={() => {
                setAuthMode("login");
                setView("auth");
              }}
            >
              로그인 <ArrowUpRight size={16} />
            </button>
          )}
        </div>
      </header>
      <main className="main">
        {error && (
          <div role="alert" className="warning">
            {error} <button onClick={() => run(refresh)}>다시 불러오기</button>
          </div>
        )}
        {view === "services" && (
          <>
            <div className="page-intro">
              <span className="eyebrow">YOUR NEXT CHAPTER</span>
              <h1>
                당신의 경험이,
                <br />
                <span>좋은 서류가 되는 곳.</span>
              </h1>
              <p>
                이미 쓴 글도, 아직 꺼내지 못한 이야기도.
                <br className="mobile-break" /> 지금 필요한 도움을 선택해
                주세요.
              </p>
            </div>
            <div className="service-layout">
              <div className="service-grid">
                <article className="service-card">
                  <div className="card-top">
                    <span className="service-icon">
                      <FileText size={27} />
                    </span>
                    <span className="number">01 / EDITING</span>
                  </div>
                  <span className="tag">작성한 서류가 있다면</span>
                  <h2>기존 서류 첨삭</h2>
                  <p className="card-desc">
                    담아둔 경험은 살리고,
                    <br />
                    전달력과 완성도를 높여요.
                  </p>
                  <ul className="checklist">
                    <li>
                      <Check />
                      문장·구조·논리 흐름 검토
                    </li>
                    <li>
                      <Check />
                      지원 기관과 직무에 맞춘 피드백
                    </li>
                    <li>
                      <Check />
                      전문가와 1:1 채팅 및 수정 협의
                    </li>
                  </ul>
                  <div className="price">
                    <strong>{won(data.config.editPrice)}</strong>
                    <span>서비스 1건 기준</span>
                  </div>
                  <button
                    className="btn full"
                    disabled={busy || loading || !!error}
                    onClick={() => start("edit")}
                  >
                    첨삭 신청하기 <ArrowRight size={18} />
                  </button>
                </article>
                <article className="service-card blue-card">
                  <div className="card-top">
                    <span className="service-icon">
                      <PenLine size={27} />
                    </span>
                    <span className="number">02 / WRITING</span>
                  </div>
                  <span className="tag">어디서부터 쓸지 막막하다면</span>
                  <h2>초안 작성 지원</h2>
                  <p className="card-desc">
                    경험을 함께 정리하고,
                    <br />첫 문장부터 완성해 나가요.
                  </p>
                  <ul className="checklist">
                    <li>
                      <Check />
                      설문으로 학력·경력·경험 정리
                    </li>
                    <li>
                      <Check />
                      상담을 바탕으로 전문가가 초안 작성
                    </li>
                    <li>
                      <Check />
                      고객 피드백을 반영한 공동 완성
                    </li>
                  </ul>
                  <div className="price">
                    <strong>{won(data.config.writePrice)}</strong>
                    <span>서비스 1건 기준</span>
                  </div>
                  <button
                    className="btn full"
                    disabled={busy || loading || !!error}
                    onClick={() => start("write")}
                  >
                    작성 지원 신청하기 <ArrowRight size={18} />
                  </button>
                </article>
              </div>
              <aside className="process-card">
                <span className="eyebrow">HOW IT WORKS</span>
                <h3>신청부터 완성까지</h3>
                <ol>
                  {[
                    ["서류 첨부·신청", "설문과 제출 서류를 보내 주세요."],
                    ["관리자 검토·승인", "필요하면 자료를 보완해요."],
                    ["승인 후 결제", "승인 알림을 받은 후 결제해요."],
                    ["작업·결과물 받기", "채팅으로 피드백을 나눠요."],
                  ].map(([a, b], i) => (
                    <li key={a}>
                      <span className="step-no">{i + 1}</span>
                      <div>
                        <strong>{a}</strong>
                        <p>{b}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="private-note">
                  <ShieldCheck size={23} />
                  <p>
                    나의 서류는
                    <br />
                    <strong>나와 담당 관리자만</strong> 확인해요.
                  </p>
                </div>
              </aside>
            </div>
            <div className="service-bottom">
              <div>
                <MessageSquare />
                <span>
                  신청 이후에는 전용 채팅에서
                  <br />
                  <strong>자료부터 피드백까지 한곳에서.</strong>
                </span>
              </div>
              <div>
                <Clock />
                <span>
                  제출 마감일을 알려 주세요.
                  <br />
                  <strong>작업 일정은 상담 후 확정해요.</strong>
                </span>
              </div>
            </div>
          </>
        )}
        {view === "auth" && (
          <div className="auth-layout">
            <div className="auth-copy">
              <span className="eyebrow">MY DOCUMENT STUDIO</span>
              <h1>
                다음 기회를 위한
                <br />
                나만의 작업실.
              </h1>
              <p>
                신청부터 마지막 피드백까지,
                <br />
                Adviser에서 한눈에 관리하세요.
              </p>
              <div className="auth-benefits">
                <span>
                  <FolderOpen />
                  신청 내역과 결과물 보관
                </span>
                <span>
                  <MessageSquare />
                  관리자와 1:1 피드백
                </span>
                <span>
                  <LockKeyhole />
                  나만 볼 수 있는 서류
                </span>
              </div>
            </div>
            <section className="panel auth-panel">
              <Tabs
                value={authMode === "admin" ? "login" : authMode}
                onValueChange={setAuthMode}
              >
                <TabsList className="auth-tabs">
                  <TabsTrigger value="login">로그인</TabsTrigger>
                  <TabsTrigger value="register">회원가입</TabsTrigger>
                </TabsList>
              </Tabs>
              <h2>
                {authMode === "register"
                  ? "작업실을 만들어 보세요"
                  : authMode === "admin"
                    ? "관리자 로그인"
                    : "다시 만나 반가워요"}
              </h2>
              <p className="muted">
                {authMode === "register"
                  ? "이메일과 비밀번호로 간편하게 시작하세요."
                  : "계정 정보를 입력해 주세요."}
              </p>
              <form onSubmit={login}>
                {authMode === "register" && (
                  <label>
                    이름
                    <input
                      name="name"
                      required
                      maxLength={60}
                      autoComplete="name"
                      placeholder="이름을 입력해 주세요"
                    />
                  </label>
                )}
                <label>
                  {authMode === "admin" ? "관리자 아이디" : "이메일"}
                  <input
                    name="email"
                    type={authMode === "admin" ? "text" : "email"}
                    required
                    maxLength={254}
                    autoComplete="username"
                    placeholder={
                      authMode === "admin" ? "ADMIN" : "name@example.com"
                    }
                  />
                </label>
                <label>
                  비밀번호
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={authMode === "register" ? 10 : 1}
                    maxLength={128}
                    autoComplete={
                      authMode === "register"
                        ? "new-password"
                        : "current-password"
                    }
                    placeholder={
                      authMode === "register"
                        ? "10자 이상 입력해 주세요"
                        : "비밀번호를 입력해 주세요"
                    }
                  />
                </label>
                {authMode === "register" && (
                  <p className="fine">
                    자주 사용하는 이메일로 가입해 주세요. 비밀번호를 잊었다면
                    담당 관리자에게 문의해 주세요.
                  </p>
                )}
                <button className="btn full" disabled={busy || !!error}>
                  {busy ? <LoaderCircle className="spin" size={18} /> : null}
                  {authMode === "register" ? "회원가입" : "로그인"}
                  <ArrowRight size={17} />
                </button>
              </form>
              <button
                className="text-button admin-link"
                onClick={() =>
                  setAuthMode(authMode === "admin" ? "login" : "admin")
                }
              >
                {authMode === "admin"
                  ? "고객 로그인으로 돌아가기"
                  : "관리자 로그인"}
              </button>
            </section>
          </div>
        )}
        {view === "orders" && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {admin ? "WORKSPACE" : "MY WORKSPACE"}
                </span>
                <h1>{admin ? "전체 작업 관리" : "나의 작업실"}</h1>
                <p>서류의 시작부터 완성까지, 진행 상황을 확인하세요.</p>
              </div>
              <button className="btn" onClick={() => navigate("services")}>
                새 신청 <ArrowUpRight size={17} />
              </button>
            </div>
            <div className="stats">
              {[
                ["전체 신청", data.orders.length],
                [
                  "진행 중",
                  data.orders.filter((o: any) =>
                    ["received", "working", "supplement", "review"].includes(
                      o.status,
                    ),
                  ).length,
                ],
                [
                  "신청·검토·결제 대기",
                  data.orders.filter((o: any) =>
                    [
                      "payment",
                      "draft",
                      "approval",
                      "application_supplement",
                      "approved",
                    ].includes(o.status),
                  ).length,
                ],
                [
                  "작업 완료",
                  data.orders.filter((o: any) => o.status === "complete")
                    .length,
                ],
              ].map(([t, n]) => (
                <div key={t}>
                  <span>{t}</span>
                  <strong>
                    {n}
                    <small>건</small>
                  </strong>
                </div>
              ))}
            </div>
            <div className="list-toolbar">
              <Choice
                value={filter}
                onChange={setFilter}
                items={{ all: "전체 상태", ...statuses }}
              />
              <input
                aria-label="신청 검색"
                placeholder="제출 기관 또는 고객 검색"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="order-list">
              {data.orders
                .filter(
                  (o: any) =>
                    (filter === "all" || filter === o.status) &&
                    JSON.stringify([
                      JSON.parse(o.form).institution,
                      o.customer,
                      o.email,
                      titles[o.service],
                    ])
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                )
                .map((o: any) => (
                  <button
                    key={o.id}
                    className="order-row"
                    onClick={() => openOrder(o.id)}
                  >
                    <span className="service-icon">
                      {o.service === "edit" ? <FileText /> : <PenLine />}
                    </span>
                    <div className="order-title">
                      <span className="muted">
                        {titles[o.service]} · {date(o.created)} 신청
                      </span>
                      <strong>
                        {JSON.parse(o.form).institution ||
                          "신청 정보를 작성해 주세요"}
                      </strong>
                      {admin && (
                        <small>
                          {o.customer} · {o.email}
                        </small>
                      )}
                    </div>
                    <span className={"badge " + o.status}>
                      {statuses[o.status]}
                    </span>
                    <span className="order-price">{won(o.amount)}</span>
                    <ChevronRight size={19} />
                  </button>
                ))}
            </div>
            {!data.orders.length && (
              <Empty className="empty-block">
                <EmptyHeader>
                  <FolderOpen size={36} />
                  <EmptyTitle>아직 신청한 작업이 없어요</EmptyTitle>
                  <EmptyDescription>
                    필요한 서비스를 선택하고 첫 서류 작업을 시작해 보세요.
                  </EmptyDescription>
                </EmptyHeader>
                <button className="btn" onClick={() => navigate("services")}>
                  서비스 둘러보기
                </button>
              </Empty>
            )}
          </>
        )}
        {view === "detail" && o && data.user && (
          <>
            <button className="text-button" onClick={() => navigate("orders")}>
              <ArrowLeft size={16} />
              작업 목록
            </button>
            <div className="section-heading">
              <div>
                <span className="eyebrow">{titles[o.service]}</span>
                <h1>{JSON.parse(o.form).institution || "새로운 서류 작업"}</h1>
                <p>
                  {date(o.created)} 신청 · {won(o.amount)} · 수정 {o.revisions}
                  회 /{" "}
                  {o.revision_limit ? o.revision_limit + "회" : "채팅으로 협의"}
                </p>
              </div>
              <span className={"badge " + o.status}>{statuses[o.status]}</span>
            </div>
            <div className="progress-steps">
              {steps.map((s, i) => (
                <div className={i <= idx ? "passed" : ""} key={s}>
                  <span>{i < idx ? <Check size={15} /> : i + 1}</span>
                  {statuses[s]}
                </div>
              ))}
            </div>
            <div className="detail-layout">
              <div>
                {o.status === "approved" && (
                  <section className="panel">
                    <span className="eyebrow">STEP 03</span>
                    <h2>승인 완료 · 결제 안내</h2>
                    <div className="total">
                      <span>{titles[o.service]}</span>
                      <strong>{won(o.amount)}</strong>
                    </div>
                    {o.payment === "bank_requested" ? (
                      <div className="notice">
                        <Clock />
                        <div>
                          <strong>입금 확인을 기다리고 있어요</strong>
                          <p>관리자가 입금을 확인하면 작업이 시작됩니다.</p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="payment-method">
                          <Landmark />
                          <div>
                            <strong>계좌이체</strong>
                            <p>
                              {data.config.bank &&
                              data.config.account &&
                              data.config.holder
                                ? `${data.config.bank} ${data.config.account} · ${data.config.holder}`
                                : "관리자가 입금 계좌를 준비하고 있습니다."}
                            </p>
                          </div>
                        </div>
                        <div className="payment-method">
                          <CreditCard />
                          <div>
                            <strong>
                              카드·간편결제{" "}
                              {data.config.testPayment && (
                                <span className="badge">테스트 결제</span>
                              )}
                            </strong>
                            <p>
                              {data.config.onlinePayment
                                ? "결제 창에서 카드 또는 간편결제를 선택하세요."
                                : "결제업체 연결 후 이용할 수 있어요."}
                            </p>
                            {data.config.onlinePayment && !admin && (
                              <button
                                className="btn small"
                                disabled={busy}
                                onClick={() => run(() => checkout(oid))}
                              >
                                {data.config.testPayment
                                  ? "테스트 결제하기"
                                  : "카드·간편결제하기"}
                              </button>
                            )}
                          </div>
                        </div>
                        {!admin && (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const fd = new FormData(e.currentTarget);
                              act("bank", { depositor: fd.get("depositor") });
                            }}
                          >
                            <label>
                              입금자명
                              <input
                                name="depositor"
                                defaultValue={data.user.name}
                                required
                                maxLength={60}
                              />
                            </label>
                            <button
                              className="btn full"
                              disabled={
                                busy ||
                                !data.config.bank ||
                                !data.config.account ||
                                !data.config.holder
                              }
                            >
                              입금 확인 요청
                            </button>
                            <p className="fine">
                              계좌로 직접 이체한 후 요청해 주세요. 자동 출금되지
                              않습니다.
                            </p>
                          </form>
                        )}
                      </>
                    )}
                    {admin && o.payment === "bank_requested" && (
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            title: "입금 내역을 확인했나요?",
                            description:
                              "실제 계좌에 주문 금액이 입금되었는지 확인해 주세요. 확인하면 해당 신청이 작업 대기 상태로 변경됩니다.",
                            action: "confirmPayment",
                          })
                        }
                      >
                        입금 확인 완료
                      </button>
                    )}
                  </section>
                )}
                {data.config.onlinePayment && (
                  <div className="payment-check">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await paymentApi({ action: "sync", id: oid });
                          await refresh();
                          await loadDetail(oid);
                          toast.success("결제 상태를 확인했습니다.");
                        })
                      }
                    >
                      온라인 결제 상태 확인
                    </button>
                  </div>
                )}
                {["draft", "payment", "application_supplement"].includes(
                  o.status,
                ) &&
                  !admin && (
                    <section className="panel">
                      <span className="eyebrow">STEP 01</span>
                      <h2>경험과 목표를 알려 주세요</h2>
                      <p className="muted">
                        해당 사항이 없다면 ‘없음’으로 작성해 주세요. 별표 항목은
                        필수입니다. 관리자 승인 후 결제가 진행됩니다.
                      </p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!consent) {
                            toast.error("서류 열람 동의를 확인해 주세요.");
                            return;
                          }
                          act("submit", { form, consent });
                        }}
                      >
                        <div className="field-grid">
                          {[
                            ["institution", "제출 기관", "예: 한국전력공사"],
                            ["job", "지원 직무", "예: 사무·기획"],
                          ].map(([key, label, placeholder]) => (
                            <label key={key}>
                              {label} *
                              <input
                                required
                                value={form[key]}
                                maxLength={200}
                                placeholder={placeholder}
                                onChange={(e) =>
                                  setForm({ ...form, [key]: e.target.value })
                                }
                              />
                            </label>
                          ))}
                        </div>
                        {[
                          [
                            "education",
                            "학력",
                            "학교·전공·재학 또는 졸업 여부",
                          ],
                          ["career", "경력", "근무 기관, 기간, 담당 업무"],
                          [
                            "experience",
                            "주요 경험",
                            "프로젝트, 활동, 성과와 본인의 역할",
                          ],
                          [
                            "questions",
                            "작성 문항과 글자 수",
                            "문항별 질문과 제한 글자 수를 함께 적어 주세요.",
                          ],
                        ].map(([key, label, placeholder]) => (
                          <label key={key}>
                            {label} *
                            <textarea
                              required
                              maxLength={20000}
                              rows={key === "questions" ? 5 : 3}
                              value={form[key]}
                              placeholder={placeholder}
                              onChange={(e) =>
                                setForm({ ...form, [key]: e.target.value })
                              }
                            />
                          </label>
                        ))}
                        <label>
                          희망 마감일 *
                          <input
                            type="date"
                            required
                            min={new Date().toLocaleDateString("sv-SE", {
                              timeZone: "Asia/Seoul",
                            })}
                            value={form.deadline}
                            onChange={(e) =>
                              setForm({ ...form, deadline: e.target.value })
                            }
                          />
                        </label>
                        <p className="fine">
                          실제 작업 일정은 관리자와 채팅으로 확정해 주세요.
                        </p>
                        <label>
                          비고사항
                          <textarea
                            rows={3}
                            maxLength={20000}
                            value={form.notes}
                            onChange={(e) =>
                              setForm({ ...form, notes: e.target.value })
                            }
                            placeholder="원하는 방향이나 특히 고민되는 부분을 알려 주세요."
                          />
                        </label>
                        <div className="notice">
                          <Paperclip />
                          <p>
                            {o.service === "edit"
                              ? "기존 서류 첨부가 필수예요. 아래 파일 영역에 첨부해 주세요."
                              : "참고 자료가 있다면 아래 파일 영역에 첨부해 주세요."}
                          </p>
                        </div>
                        <label className="check-label">
                          <Checkbox
                            checked={consent}
                            onCheckedChange={(v) => setConsent(v === true)}
                          />
                          신청 처리와 첨삭을 위한 담당 관리자의 서류 열람에
                          동의합니다.
                        </label>
                        <div className="button-row">
                          <button
                            type="button"
                            className="btn secondary"
                            disabled={busy}
                            onClick={() => act("save", { form })}
                          >
                            임시 저장
                          </button>
                          <button className="btn" disabled={busy}>
                            {o.status === "application_supplement"
                              ? "보완 후 다시 제출"
                              : "검토 신청하기"}{" "}
                            <ArrowRight size={16} />
                          </button>
                        </div>
                      </form>
                    </section>
                  )}
                {!["draft", "payment"].includes(o.status) &&
                  (admin || o.status !== "application_supplement") && (
                    <section className="panel">
                      <h2>신청 정보</h2>
                      <dl className="details">
                        {Object.entries({
                          institution: "제출 기관",
                          job: "지원 직무",
                          education: "학력",
                          career: "경력",
                          experience: "주요 경험",
                          questions: "문항·글자 수",
                          deadline: "희망 마감일",
                          notes: "비고사항",
                        }).map(([key, label]) => (
                          <div key={key}>
                            <dt>{label}</dt>
                            <dd>{JSON.parse(o.form)[key] || "—"}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  )}
                {admin && ["draft", "payment"].includes(o.status) && (
                  <div className="panel">
                    <h2>고객이 신청서를 작성 중이에요</h2>
                    <p className="muted">
                      신청 완료 후 설문 정보를 확인할 수 있습니다.
                    </p>
                  </div>
                )}
                {o.status === "approval" && (
                  <section className="panel">
                    <span className="eyebrow">STEP 02</span>
                    <h2>
                      {admin
                        ? "신청 서류 검토"
                        : "관리자가 신청서를 검토하고 있어요"}
                    </h2>
                    <p className="muted">
                      {admin
                        ? "설문과 첨부 서류를 확인한 후 승인해 주세요. 추가 정보가 필요하면 채팅으로 안내하고 보완을 요청할 수 있습니다."
                        : "승인 알림을 받으면 이 화면에서 결제할 수 있어요. 추가 자료는 첨부하거나 채팅으로 전달해 주세요."}
                    </p>
                    {admin && (
                      <div className="button-row wrap">
                        <button
                          className="btn secondary"
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              title: "신청을 반려할까요?",
                              description:
                                "고객에게 전달할 반려 사유를 입력해 주세요.",
                              action: "reject",
                              reason: "",
                            })
                          }
                        >
                          신청 반려
                        </button>
                        <button
                          className="btn secondary"
                          disabled={busy}
                          onClick={() => act("requestSupplement")}
                        >
                          신청서 보완 요청
                        </button>
                        <button
                          className="btn"
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              title: "신청을 승인할까요?",
                              description:
                                "설문과 첨부 서류를 검토했는지 확인해 주세요. 승인 후 고객이 결제를 진행할 수 있습니다.",
                              action: "approve",
                            })
                          }
                        >
                          검토 완료 · 승인
                        </button>
                      </div>
                    )}
                  </section>
                )}
                {o.status === "application_supplement" && (
                  <div className="notice">
                    <MessageSquare />
                    <p>
                      신청서 보완이 필요합니다. 채팅에서 요청 사항을 확인하고
                      설문·첨부 자료를 보완한 뒤 다시 제출해 주세요.
                    </p>
                  </div>
                )}
                {admin &&
                  [
                    "received",
                    "supplement",
                    "working",
                    "review",
                    "complete",
                  ].includes(o.status) && (
                    <section className="panel">
                      <h2>진행 상태 관리</h2>
                      <div className="button-row wrap">
                        {(
                          (
                            {
                              received: ["supplement", "working"],
                              supplement: ["working"],
                              working: ["supplement", "review", "complete"],
                              review: ["working", "complete"],
                              complete: ["working"],
                            } as Record<string, string[]>
                          )[o.status] || []
                        ).map((s: string) => (
                          <button
                            className="btn secondary"
                            key={s}
                            disabled={busy}
                            onClick={() => act("status", { status: s })}
                          >
                            {statuses[s]}
                          </button>
                        ))}
                      </div>
                      <p className="fine">
                        고객 검토·작업 완료로 변경하기 전에 초안 또는 결과물을
                        첨부해 주세요.
                      </p>
                    </section>
                  )}
                <section className="panel">
                  <div className="panel-heading">
                    <h2>서류·결과물</h2>
                    <span className="muted">{detail.files.length}개</span>
                  </div>
                  {detail.files.length ? (
                    detail.files.map((f: any) => (
                      <a
                        className="file-row"
                        key={f.id}
                        href={"/api/files/" + f.id}
                      >
                        <FileText size={21} />
                        <div>
                          <strong>{f.name}</strong>
                          <small>
                            {f.kind === "result" ? "초안·결과물" : "참고 자료"}{" "}
                            · {(f.size / 1024).toFixed(0)} KB
                          </small>
                        </div>
                        <Download size={18} />
                      </a>
                    ))
                  ) : (
                    <p className="muted">아직 첨부된 파일이 없습니다.</p>
                  )}
                  {![
                    "cancelled",
                    "refunded",
                    "cancel_requested",
                    "rejected",
                  ].includes(o.status) && (
                    <div className="uploads">
                      <label className="upload">
                        <Paperclip size={19} />
                        {admin ? "참고 자료 첨부" : "서류 첨부"}
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.hwp,.hwpx,.txt"
                          disabled={busy}
                          onChange={(e) => {
                            upload(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {admin && o.payment === "paid" && (
                        <label className="upload result">
                          <Download size={18} />
                          초안·결과물 등록
                          <input
                            type="file"
                            accept=".pdf,.doc,.docx,.hwp,.hwpx,.txt"
                            disabled={busy}
                            onChange={(e) => {
                              upload(e.target.files?.[0], "result");
                              e.target.value = "";
                            }}
                          />
                        </label>
                      )}
                      <p className="fine">
                        PDF, Word, 한글, TXT · 파일당 최대 15MB
                      </p>
                    </div>
                  )}
                </section>
                {!admin && ["review", "complete"].includes(o.status) && (
                  <section className="panel">
                    <h2>수정 요청</h2>
                    <p className="muted">
                      검토한 초안이나 결과물에서 바꾸고 싶은 부분을 알려 주세요.
                    </p>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const el = e.currentTarget;
                        act("revision", {
                          body: new FormData(el).get("body"),
                        }).then((r) => {
                          if (r) el.reset();
                        });
                      }}
                    >
                      <textarea
                        name="body"
                        required
                        maxLength={5000}
                        rows={3}
                        placeholder="문항과 수정할 내용을 구체적으로 적어 주세요."
                      />
                      <button className="btn" disabled={busy}>
                        수정 요청 보내기
                      </button>
                    </form>
                  </section>
                )}
                {![
                  "cancelled",
                  "refunded",
                  "cancel_requested",
                  "rejected",
                ].includes(o.status) && (
                  <button
                    className="text-button danger"
                    onClick={() =>
                      setConfirm({
                        title: "이 작업을 취소할까요?",
                        description:
                          o.payment === "unpaid"
                            ? "결제 전 신청을 취소합니다."
                            : "관리자에게 취소 요청을 전달합니다. 환불 여부와 금액은 작업 진행 정도 및 협의 내용에 따라 확인됩니다.",
                        action: "cancel",
                      })
                    }
                  >
                    신청 취소 요청
                  </button>
                )}
                {admin &&
                  ["complete", "cancelled", "refunded", "rejected"].includes(
                    o.status,
                  ) &&
                  detail.files.length > 0 && (
                    <button
                      className="text-button danger"
                      onClick={() =>
                        setConfirm({
                          title: "첨부 자료를 모두 삭제할까요?",
                          description:
                            "이 작업의 원본과 결과물 파일을 영구 삭제합니다. 고객에게 안내한 보관 기간과 삭제 요청을 먼저 확인해 주세요. 신청 내역과 채팅은 남습니다.",
                          action: "purgeFiles",
                        })
                      }
                    >
                      첨부 자료 영구 삭제
                    </button>
                  )}
                {admin && o.status === "cancel_requested" && (
                  <button
                    className="btn"
                    onClick={() =>
                      setConfirm({
                        title: "취소 정산을 완료했나요?",
                        description:
                          "실제 입금 내역을 확인하고, 환불이 필요한 경우 계좌 환불을 먼저 완료해 주세요. 이 버튼은 실제 송금을 실행하지 않습니다.",
                        action: "refund",
                      })
                    }
                  >
                    취소 정산 완료
                  </button>
                )}
              </div>
              <aside className="chat-panel">
                <div className="chat-heading">
                  <span className="avatar">
                    <MessageSquare size={20} />
                  </span>
                  <div>
                    <h2>{admin ? "고객과 대화" : "담당 관리자와 대화"}</h2>
                    <p>이 작업의 자료와 피드백을 나눠요</p>
                  </div>
                </div>
                <div
                  className="chat-messages"
                  role="log"
                  aria-label="채팅 메시지"
                >
                  {!detail.messages.length && (
                    <div className="chat-empty">
                      <MessageSquare size={30} />
                      <p>
                        궁금한 점을 남겨 주세요.
                        <br />
                        담당 관리자가 확인 후 답변드려요.
                      </p>
                    </div>
                  )}
                  {detail.messages.map((m: any) =>
                    m.role === "system" ? (
                      <div className="system-message" key={m.id}>
                        {m.body}
                      </div>
                    ) : (
                      <div
                        key={m.id}
                        className={
                          "message " +
                          (m.user_id === data.user.id ? "mine" : "")
                        }
                      >
                        <small>
                          {m.name} ·{" "}
                          {new Date(m.created).toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                        <p>{m.body}</p>
                      </div>
                    ),
                  )}
                </div>
                <form
                  className="chat-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    act("chat", { body: chat }).then((r) => {
                      if (r) setChat("");
                    });
                  }}
                >
                  <textarea
                    aria-label="메시지"
                    rows={2}
                    maxLength={5000}
                    placeholder="메시지를 입력해 주세요"
                    value={chat}
                    onChange={(e) => setChat(e.target.value)}
                    disabled={["cancelled", "refunded", "rejected"].includes(
                      o.status,
                    )}
                  />
                  <button
                    className="btn"
                    disabled={
                      busy ||
                      !chat.trim() ||
                      ["cancelled", "refunded", "rejected"].includes(o.status)
                    }
                    aria-label="메시지 보내기"
                  >
                    <Send size={18} />
                  </button>
                </form>
                <p className="fine chat-fine">
                  새 메시지는 자동으로 갱신됩니다.
                </p>
              </aside>
            </div>
          </>
        )}
        {view === "settings" && admin && cfg && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">STUDIO SETTINGS</span>
                <h1>운영 설정</h1>
                <p>변경한 가격과 수정 횟수는 새로운 신청부터 적용됩니다.</p>
              </div>
            </div>
            <form
              className="settings-form"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api({ action: "settings", config: cfg });
                  await refresh();
                  toast.success("운영 설정을 저장했습니다.");
                });
              }}
            >
              <section className="panel">
                <h2>서비스 가격</h2>
                <div className="field-grid">
                  {[
                    ["editPrice", "기존 서류 첨삭"],
                    ["writePrice", "초안 작성 지원"],
                  ].map(([k, l]) => (
                    <label key={k}>
                      {l} · 원
                      <input
                        type="number"
                        min={1000}
                        max={10000000}
                        required
                        value={cfg[k]}
                        onChange={(e) =>
                          setCfg({ ...cfg, [k]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label>
                  기본 수정 가능 횟수
                  <input
                    type="number"
                    min={0}
                    max={100}
                    required
                    value={cfg.revisionLimit}
                    onChange={(e) =>
                      setCfg({ ...cfg, revisionLimit: Number(e.target.value) })
                    }
                  />
                </label>
                <p className="fine">
                  0은 횟수 제한 없이 상담으로 협의하는 설정입니다.
                </p>
              </section>
              <section className="panel">
                <h2>계좌이체 정보</h2>
                <p className="muted">
                  세 항목을 모두 등록하면 고객이 입금 확인을 요청할 수 있어요.
                </p>
                {[
                  ["bank", "은행"],
                  ["account", "계좌번호"],
                  ["holder", "예금주"],
                ].map(([k, l]) => (
                  <label key={k}>
                    {l}
                    <input
                      maxLength={k === "account" ? 80 : 50}
                      value={cfg[k]}
                      onChange={(e) => setCfg({ ...cfg, [k]: e.target.value })}
                    />
                  </label>
                ))}
                <div className="notice">
                  <CreditCard />
                  <p>
                    {data.config.onlinePayment
                      ? data.config.testPayment
                        ? "온라인 결제가 테스트 모드로 연결되어 있습니다."
                        : "온라인 결제가 연결되어 있습니다."
                      : "카드·간편결제는 결제업체 연결 후 사용할 수 있습니다."}
                  </p>
                </div>
              </section>
              <section className="panel">
                <h2>고객 안내</h2>
                <label>
                  취소·환불 안내
                  <textarea
                    rows={5}
                    maxLength={5000}
                    placeholder="확정한 운영 정책을 입력해 주세요."
                    value={cfg.policy}
                    onChange={(e) => setCfg({ ...cfg, policy: e.target.value })}
                  />
                </label>
                <label>
                  자료 보관·삭제 안내
                  <textarea
                    rows={4}
                    maxLength={2000}
                    placeholder="실제로 운영할 보관 기간과 삭제 요청 방법을 입력해 주세요."
                    value={cfg.retention}
                    onChange={(e) =>
                      setCfg({ ...cfg, retention: e.target.value })
                    }
                  />
                </label>
                <p className="fine">
                  안내 문구 저장만으로 파일이 자동 삭제되지는 않습니다.
                </p>
              </section>
              <button className="btn" disabled={busy}>
                설정 저장 <Check size={18} />
              </button>
            </form>
          </>
        )}
        {view === "notices" && (
          <>
            <div className="section-heading">
              <div>
                <span className="eyebrow">NOTIFICATIONS</span>
                <h1>알림</h1>
                <p>작업과 관련된 새로운 소식을 확인하세요.</p>
              </div>
              <button className="btn secondary" onClick={() => act("read")}>
                모두 읽음
              </button>
            </div>
            {data.notices.length ? (
              data.notices.map((n: any) => (
                <button
                  className={"notice-row " + (!n.seen ? "unread" : "")}
                  key={n.id}
                  onClick={() => openOrder(n.order_id)}
                >
                  <Bell size={20} />
                  <span>
                    {n.body}
                    <small>{date(n.created)}</small>
                  </span>
                  <ChevronRight size={18} />
                </button>
              ))
            ) : (
              <Empty>
                <EmptyHeader>
                  <Bell size={32} />
                  <EmptyTitle>새로운 알림이 없어요</EmptyTitle>
                  <EmptyDescription>
                    신청, 채팅, 작업 상태 변경 소식이 여기에 표시됩니다.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </>
        )}
        {view === "account" && (
          <section className="panel account-panel">
            <h1>계정 관리</h1>
            <p>
              {data.user?.name} · {data.user?.email}
            </p>
            <h2>비밀번호 변경</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await api({
                    action: "password",
                    current: f.get("current"),
                    password: f.get("password"),
                  });
                  await refresh();
                  setView("auth");
                  setAuthMode("login");
                  toast.success(
                    "비밀번호가 변경되었습니다. 다시 로그인해 주세요.",
                  );
                });
              }}
            >
              <label>
                현재 비밀번호
                <input
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label>
                새 비밀번호
                <input
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={128}
                />
              </label>
              <button className="btn" disabled={busy}>
                비밀번호 변경
              </button>
            </form>
          </section>
        )}
        {view === "policies" && (
          <section className="panel policy-panel">
            <h2>취소·환불 안내</h2>
            <p>
              {data.config.policy ||
                "운영 정책을 준비 중입니다. 결제 전 관리자와 취소·환불 조건을 확인해 주세요."}
            </p>
            <h2>자료 보관·삭제 안내</h2>
            <p>
              {data.config.retention ||
                "자료 보관 기간과 삭제 절차를 준비 중입니다. 제출 서류는 해당 고객과 관리자만 열람할 수 있습니다."}
            </p>
            <button
              className="btn secondary"
              onClick={() => navigate("services")}
            >
              돌아가기
            </button>
          </section>
        )}
      </main>
      <footer>
        <div>
          <strong>Adviser</strong>
          <span>당신의 다음 기회를 함께 씁니다.</span>
        </div>
        <div>
          <button onClick={() => navigate("services")}>서비스</button>
          <button onClick={() => setView("policies")}>이용·자료 안내</button>
          <span>© {new Date().getFullYear()} Adviser</span>
        </div>
      </footer>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(v) => {
          if (!v) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm?.action === "reject" && (
            <label>
              반려 사유
              <textarea
                aria-label="반려 사유"
                maxLength={1000}
                value={confirm.reason}
                onChange={(e) =>
                  setConfirm({ ...confirm, reason: e.target.value })
                }
              />
            </label>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>돌아가기</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                busy ||
                (confirm?.action === "reject" && !confirm.reason?.trim())
              }
              onClick={() => {
                if (confirm)
                  act(
                    confirm.action,
                    confirm.action === "reject"
                      ? { reason: confirm.reason }
                      : {},
                  );
                setConfirm(null);
              }}
            >
              확인
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
