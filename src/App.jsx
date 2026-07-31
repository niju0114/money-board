import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, RotateCcw, Check, Pencil } from "lucide-react";

/* ── 디자인 토큰 (다크 모드는 index.css의 CSS 변수가 처리) ── */
const C = {
  bg: "var(--bg)",
  card: "var(--card)",
  text: "var(--text)",
  sub: "var(--sub)",
  line: "var(--line)",
  fill: "var(--fill)",
  field: "var(--field)",
  accent: "var(--accent)",
  danger: "var(--danger)",
};

const ROLES = {
  hub: { label: "허브" },
  spend: { label: "쓸돈" },
  save: { label: "모음" },
  invest: { label: "투자" },
};
const ROLE_ORDER = ["hub", "spend", "save", "invest"];

const KEY = "minjun-money-v1";

/* 공개 저장소에 올라가므로 시드에는 개인 금액·항목을 두지 않는다 */
const SEED = {
  v: 10,
  unit: "won",
  payday: 25,
  weekStart: 0, // 주 시작 요일 — 가계부 묶음에만 쓴다 (0=일, 1=월)
  accounts: [
    { id: "a1", name: "주계좌", note: "수입이 들어오는 곳", baseAmount: 0, baseTs: 0, role: "hub" },
    { id: "a2", name: "세이프박스", note: "일정 없이 꺼내 쓰는 돈", baseAmount: 0, baseTs: 0, role: "save" },
    { id: "a3", name: "생활비 통장", note: "주간 예산이 나가는 곳", baseAmount: 0, baseTs: 0, role: "spend" },
    { id: "a4", name: "투자 계좌", note: "원금 기록", baseAmount: 0, baseTs: 0, role: "invest" },
  ],
  entries: [],
  rules: [],
  autoRunDate: null,
  lastAuto: null, // { date, count } — 마지막 자동 반영 결과
  planned: [],
  goal: { monthly: 0 },
  routine: "",
};

/* ── 헬퍼 ─────────────────────────────────────────── */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const parseWon = (s) => {
  const n = parseFloat(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.round(n) : null;
};
const fmt = (n) => (n == null ? "" : Math.round(n).toLocaleString("ko-KR"));
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromISO = (s) => {
  const [y, m, dd] = String(s).split("-").map(Number);
  return new Date(y, m - 1, dd);
};
const startOfWeek = (d, weekStart) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() - weekStart + 7) % 7));
  return x;
};
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const dayLabel = (iso) => {
  const d = fromISO(iso);
  return `${md(d)} (${WD[d.getDay()]})`;
};
const lastDayOf = (y, m) => new Date(y, m + 1, 0).getDate();

function paydayInfo(payday) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(now.getFullYear(), now.getMonth(), payday);
  if (now.getDate() >= payday) next.setMonth(next.getMonth() + 1);
  const days = Math.max(1, Math.round((next - today) / 86400000));
  return { days, label: `${next.getMonth() + 1}월 ${next.getDate()}일 (${WD[next.getDay()]})` };
}

/* ── 고정 항목(규칙) ───────────────────────────────── */
const freqLabel = (f) =>
  f.kind === "weekly" ? `매주 ${WD[f.dow]}요일` : f.kind === "monthEnd" ? "매월 말일" : `매월 ${f.day}일`;

/* 그 날짜에 규칙이 도래하는지 — 매월 29·30·31일 규칙은 그 달에 없으면 말일로 당겨진다 */
const ruleHitsOn = (rule, d) => {
  if (rule.startDate && toISO(d) < rule.startDate) return false;
  const last = lastDayOf(d.getFullYear(), d.getMonth());
  if (rule.freq.kind === "weekly") return d.getDay() === rule.freq.dow;
  if (rule.freq.kind === "monthEnd") return d.getDate() === last;
  return d.getDate() === Math.min(rule.freq.day, last);
};

/* 하루 예산 분모의 하한 — 사이클 막바지에 하루 예산이 폭등하지 않게 한다 */
const MIN_SPREAD_DAYS = 5;

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* 규칙이 [from, to] 사이에 도래하는 날짜 중 아직 기록되지 않은 것 (오늘까지만) */
const pendingDates = (d, rule, from, to) => {
  if (!rule.active) return [];
  const seen = new Set(d.entries.filter((e) => e.ruleId === rule.id).map((e) => e.date));
  const out = [];
  const day = startOfDay(from);
  const end = startOfDay(to);
  for (let g = 0; g < 400 && day <= end; g++, day.setDate(day.getDate() + 1)) {
    const iso = toISO(day);
    if (ruleHitsOn(rule, day) && !seen.has(iso)) out.push(iso);
  }
  return out;
};

/* from(포함)부터 오늘까지 도래한 규칙을 기록으로 만든다 — 미래 생성 없음, 중복 없음 */
const applyRules = (d, from) => {
  const today = startOfDay(new Date());
  const ts = Date.now();
  let made = 0;
  for (const r of d.rules) {
    for (const iso of pendingDates(d, r, from, today)) {
      d.entries.unshift({
        id: uid(),
        ts: ts + made, // 기록 시점 기준 — 직접 입력한 기록과 같은 규칙으로 잔액에 반영된다
        date: iso,
        type: r.type,
        amount: r.amount,
        text: r.name,
        from: r.type === "income" ? null : r.from ?? null,
        to: r.type === "expense" ? null : r.to ?? null,
        auto: true,
        ruleId: r.id,
      });
      made++;
    }
  }
  if (made) {
    d.entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.ts - a.ts));
    d.entries = d.entries.slice(0, 500);
    d.lastAuto = { date: toISO(today), count: made };
  }
  d.autoRunDate = toISO(today);
  return made;
};

/* 앱을 열 때 — 마지막 실행일부터. 첫 실행이면 오늘 하루만 본다(과거 소급 없음) */
const runRules = (d) => applyRules(d, d.autoRunDate ? fromISO(d.autoRunDate) : startOfDay(new Date()));

/* 수동 '지금 반영' — 최근 31일까지 거슬러 빠진 것을 채운다 */
const catchUpWindow = () => addDays(startOfDay(new Date()), -31);

/* ── 저장본 정규화 ─────────────────────────────────── */
const normalize = (p) => {
  const now = Date.now();
  // unit 플래그가 없으면 만원 단위 저장본 → 한 번만 ×10000 (플래그가 중복 변환을 막는다)
  const cv = (v) => Math.round((Number(v) || 0) * (p.unit === "won" ? 1 : 10000));

  const accounts = Array.isArray(p.accounts)
    ? p.accounts.map((a) => ({
        id: a.id ?? uid(),
        name: a.name ?? "계좌",
        note: a.note ?? "",
        role: ROLES[a.role] ? a.role : "hub",
        baseAmount: cv(Number.isFinite(a.baseAmount) ? a.baseAmount : Number.isFinite(a.amount) ? a.amount : 0),
        baseTs: Number.isFinite(a.baseTs) ? a.baseTs : now,
      }))
    : structuredClone(SEED.accounts);

  const spendId = accounts.find((a) => a.role === "spend")?.id ?? null;
  const saveId = accounts.find((a) => a.role === "save")?.id ?? null;
  const firstId = accounts[0]?.id ?? null;
  const hubId = accounts.find((a) => a.role === "hub")?.id ?? firstId;
  // 비었거나 지워진 계좌를 가리키는 기록은 잔액에 반영되지 않으므로 실재하는 계좌로 붙여준다
  const live = (id, fb) => (id != null && accounts.some((a) => a.id === id) ? id : fb);

  /* 지출의 출처는 이제 출금 계좌 하나로만 나타낸다.
     구버전 src는 week → 쓸돈계좌, box → 모음계좌로 옮긴다 */
  const rawEntries = Array.isArray(p.entries) ? p.entries : Array.isArray(p.expenses) ? p.expenses : [];
  const entries = rawEntries.map((e) => {
    const type = e.type ?? (e.kind === "income" ? "income" : e.kind === "transfer" ? "transfer" : "expense");
    let from = e.from ?? null;
    let to = e.to ?? null;
    if (type === "expense" && from == null) from = e.src === "box" ? saveId : spendId;
    if (type === "income" && to == null) to = e.acct ?? null;
    // 어느 계좌에도 걸리지 않는 기록이 남지 않게 한다
    if (type !== "income") from = live(from, spendId ?? firstId);
    if (type !== "expense") to = live(to, hubId);
    return {
      id: e.id ?? uid(),
      ts: Number.isFinite(e.ts) ? e.ts : Math.min(fromISO(e.date).getTime(), now - 1),
      date: e.date ?? toISO(new Date()),
      type,
      amount: cv(e.amount),
      text: e.text ?? "",
      from: type === "income" ? null : from,
      to: type === "expense" ? null : to,
      auto: e.auto === true,
      ruleId: e.ruleId ?? null,
      savedFrom: e.savedFrom === true, // '아낀 돈 → 투자'로 보낸 이체 표시
    };
  });

  return {
    // v10: 주간 예산 배분 레이어 제거 — cycleMode·autoBudget·budget·weeklyBudget은 버린다
    v: 10,
    unit: "won",
    payday: Number.isFinite(p.payday) ? p.payday : SEED.payday,
    weekStart: p.weekStart === 1 ? 1 : 0,
    accounts,
    entries,
    rules: Array.isArray(p.rules)
      ? p.rules.map((r) => ({
          id: r.id ?? uid(),
          name: r.name ?? "고정 항목",
          amount: cv(r.amount),
          type: r.type === "income" || r.type === "transfer" ? r.type : "expense",
          // 규칙이 비었거나 지워진 계좌를 가리키면 자동 생성분이 잔액에 안 붙는다 → 실재 계좌로 보정
          from: r.type === "income" ? null : live(r.from, spendId ?? firstId),
          to: r.type === "expense" ? null : live(r.to, hubId),
          freq:
            r.freq?.kind === "weekly"
              ? { kind: "weekly", dow: Math.min(6, Math.max(0, Number(r.freq.dow) || 0)) }
              : r.freq?.kind === "monthEnd"
              ? { kind: "monthEnd" }
              : { kind: "monthly", day: Math.min(31, Math.max(1, Number(r.freq?.day) || 1)) },
          startDate: typeof r.startDate === "string" ? r.startDate : toISO(new Date()),
          active: r.active !== false,
        }))
      : [],
    autoRunDate: typeof p.autoRunDate === "string" ? p.autoRunDate : null,
    lastAuto:
      p.lastAuto && typeof p.lastAuto.date === "string"
        ? { date: p.lastAuto.date, count: Number(p.lastAuto.count) || 0 }
        : null,
    planned: Array.isArray(p.planned)
      ? p.planned.map((x) => ({
          id: x.id ?? uid(),
          month: Number.isFinite(x.month)
            ? Math.min(12, Math.max(1, Math.round(x.month)))
            : Number(String(x.date ?? "").slice(5, 7)) || 1,
          amount: cv(x.amount),
          memo: x.memo ?? "",
        }))
      : [],
    goal: { monthly: Number.isFinite(p.goal?.monthly) ? cv(p.goal.monthly) : 0 },
    routine: typeof p.routine === "string" ? p.routine : SEED.routine,
  };
};

/* 잔액 = 기준값 + (기준시각 이후 들어온 돈) − (나간 돈).
   아직 오지 않은 날짜의 기록은 실제로 빠져나간 돈이 아니므로 세지 않는다 */
const balanceOf = (d, a) => {
  const today = toISO(new Date());
  let v = a.baseAmount;
  for (const e of d.entries) {
    if (e.ts <= a.baseTs || e.date > today) continue;
    if (e.to === a.id) v += e.amount;
    if (e.from === a.id) v -= e.amount;
  }
  return Math.round(v);
};

/* 하루 예산 = 쓸돈 잔액 ÷ 다음 급여일까지 남은 일수(오늘 포함).
   분모에 하한을 둬서 사이클 막바지에 하루 예산이 폭등하지 않게 한다 —
   남은 잔액은 자연스럽게 다음 사이클로 이월된다. 표시는 100원 단위 내림. */
const perDayFrom = (base, days) => Math.max(0, Math.floor(base / Math.max(MIN_SPREAD_DAYS, days) / 100) * 100);

/* ── 공용 컴포넌트 ─────────────────────────────────── */
function Card({ title, right, children }) {
  return (
    <section>
      {(title || right) && (
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-[13px]" style={{ color: C.sub }}>{title}</h2>
          {right}
        </div>
      )}
      <div className="rounded-2xl px-4 py-1" style={{ background: C.card }}>{children}</div>
    </section>
  );
}

function Row({ children, first, onClick, align = "items-center" }) {
  return (
    <div
      onClick={onClick}
      className={`flex ${align} gap-3 py-3 ${onClick ? "cursor-pointer" : ""}`}
      style={{ borderTop: first ? "none" : `1px solid ${C.line}` }}
    >
      {children}
    </div>
  );
}

function Seg({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-[9px] p-[2px] shrink-0" style={{ background: C.fill }}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <button
            key={String(k)}
            onClick={() => onChange(k)}
            className="px-2.5 py-[3px] rounded-[7px] text-[12px] whitespace-nowrap"
            style={on ? { background: C.card, color: C.text, fontWeight: 500 } : { color: C.sub }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

const fieldCls = "rounded-[10px] px-2.5 py-2 text-[15px] outline-none border-0";

function Field(props) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`${fieldCls} ${className}`} style={{ background: C.field }} />;
}

function Amount({ value, onCommit, className = "" }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const commit = () => {
    const n = parseWon(v);
    if (n != null) onCommit(n);
    setEditing(false);
  };
  if (editing)
    return (
      <input
        autoFocus
        inputMode="decimal"
        defaultValue={value}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className={`tabular-nums text-right rounded-[8px] px-2 py-1 w-32 outline-none border-0 ${className}`}
        style={{ background: C.fill, color: C.text }}
      />
    );
  return (
    <button
      onClick={() => { setV(String(value)); setEditing(true); }}
      className={`tabular-nums text-right ${className}`}
      title="눌러서 수정"
    >
      {fmt(value)}
    </button>
  );
}

function Tag({ children, tone = "sub" }) {
  return (
    <span
      className="text-[11px] px-1.5 py-[1px] rounded-md shrink-0"
      style={{ background: C.fill, color: tone === "accent" ? C.accent : C.sub }}
    >
      {children}
    </span>
  );
}

/* ── 메인 ─────────────────────────────────────────── */
export default function MoneyBoard() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("daily"); // daily=자주 보는 것 / manage=가끔 손보는 것
  const [saveState, setSaveState] = useState("");
  const [editAcc, setEditAcc] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [importText, setImportText] = useState("");
  const [bkMsg, setBkMsg] = useState("");
  const [editPay, setEditPay] = useState(false);
  const [payInput, setPayInput] = useState("");
  const [eAmt, setEAmt] = useState("");
  const [eText, setEText] = useState("");
  const [eDate, setEDate] = useState(toISO(new Date()));
  const [eKind, setEKind] = useState("expense"); // expense | income | transfer
  const [eFrom, setEFrom] = useState("");
  const [eTo, setETo] = useState("");
  const [entryEdit, setEntryEdit] = useState(null);
  const [ruleEdit, setRuleEdit] = useState(null);
  const [showSend, setShowSend] = useState(false);
  const [sendAmt, setSendAmt] = useState("");
  const [showFuture, setShowFuture] = useState(false);
  const [pMonth, setPMonth] = useState("");
  const [pAmt, setPAmt] = useState("");
  const [pMemo, setPMemo] = useState("");
  const loaded = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    let d = structuredClone(SEED);
    try {
      const r = localStorage.getItem(KEY);
      if (r) d = normalize(JSON.parse(r));
    } catch { /* 저장본이 없거나 깨졌으면 시드로 시작 */ }
    runRules(d); // 앱을 열 때 도래한 고정 항목을 기록으로 만든다
    setData(d);
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current || !data) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        const d = new Date();
        setSaveState(`저장됨 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
      } catch {
        setSaveState("저장 실패 — 잠시 후 다시 수정하면 재시도돼요");
      }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [data]);

  /* 디바운스(600ms)가 끝나기 전에 앱을 벗어나면 마지막 편집이 사라진다 → 그 자리에서 저장 */
  useEffect(() => {
    if (!data) return;
    const flush = () => {
      try {
        clearTimeout(timer.current);
        localStorage.setItem(KEY, JSON.stringify(data));
      } catch { /* 저장 실패는 디바운스 저장이 다시 시도한다 */ }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
    };
  }, [data]);

  if (!data)
    return (
      <div className="min-h-screen flex items-center justify-center text-[15px]" style={{ color: C.sub }}>
        불러오는 중…
      </div>
    );

  /* ── 파생값 ── */
  const up = (fn) => setData((d) => fn(structuredClone(d)));

  const upEntries = up; // 하루 예산은 잔액에서 바로 나오므로 따로 손볼 게 없다
  const todayISO = toISO(new Date());
  const nowD = new Date();
  const sow = (d) => startOfWeek(d, data.weekStart);
  const thisWeekKey = toISO(sow(new Date()));
  const inThisWeek = (iso) => toISO(sow(fromISO(iso))) === thisWeekKey;

  const bal = (a) => balanceOf(data, a);
  const acct = (id) => data.accounts.find((a) => a.id === id);
  const acctName = (id) => acct(id)?.name ?? "—";
  const spendAcc = data.accounts.find((a) => a.role === "spend");
  // 아직 오지 않은 날짜의 기록은 현재 집계에 넣지 않는다 (예정 기록)
  const isPast = (e) => e.date <= todayISO;
  // 하루 예산에서 빠지는 건 '쓸돈' 역할 계좌에서 나간 지출뿐
  const fromSpend = (e) => e.type === "expense" && spendAcc && e.from === spendAcc.id;
  const spentOn = (iso) => data.entries.filter((e) => fromSpend(e) && e.date === iso).reduce((s, e) => s + e.amount, 0);
  const weekSpent = data.entries
    .filter((e) => fromSpend(e) && isPast(e) && inThisWeek(e.date))
    .reduce((s, e) => s + e.amount, 0);

  const pay = paydayInfo(data.payday); // 오늘 포함, 다음 급여일까지 남은 일수
  const spendBal = spendAcc ? bal(spendAcc) : 0;
  const todaySpent = spentOn(todayISO);
  // 오늘 지출은 분자에서 되돌려 하루 시작 시점 값으로 고정한다 —
  // 오늘 쓸수록 오늘 예산 자체가 줄어드는 일을 막는다
  const dayBase = spendBal + todaySpent;
  const spreadDays = Math.max(MIN_SPREAD_DAYS, pay.days);
  const todayBudget = perDayFrom(dayBase, pay.days);
  const todayLeft = todayBudget - todaySpent;
  const overToday = todayLeft < 0;
  // 지금 멈추면 내일 예산 — 오늘 끝 잔액을 하루 줄어든 날수로 나눈다
  const tomorrowBudget = perDayFrom(spendBal, pay.days - 1);

  const cashTotal = data.accounts.filter((a) => a.role !== "invest").reduce((s, a) => s + bal(a), 0);
  const investTotal = data.accounts.filter((a) => a.role === "invest").reduce((s, a) => s + bal(a), 0);
  const investAcc = data.accounts.find((a) => a.role === "invest");

  const cycleStart = new Date(nowD.getFullYear(), nowD.getMonth() - (nowD.getDate() < data.payday ? 1 : 0), data.payday);
  const cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, data.payday);
  const cycleLast = new Date(cycleEnd);
  cycleLast.setDate(cycleLast.getDate() - 1);
  const inCycle = (iso) => iso >= toISO(cycleStart) && iso < toISO(cycleEnd);
  const cycleSpend = data.entries
    .filter((e) => fromSpend(e) && isPast(e) && inCycle(e.date))
    .reduce((s, e) => s + e.amount, 0);
  const cycleAll = data.entries
    .filter((e) => e.type === "expense" && isPast(e) && inCycle(e.date))
    .reduce((s, e) => s + e.amount, 0);

  /* 아낀 돈 — 저장하지 않고 매번 다시 구한다.
     지난 날들의 (그날 예산 − 그날 지출) 합이라 초과한 날은 음수로 상계된다 */
  const dailyRef = todayBudget;
  let savedRaw = 0;
  for (let day = startOfDay(cycleStart), g = 0; g < 45 && day < startOfDay(nowD); g++, day = addDays(day, 1)) {
    savedRaw += dailyRef - spentOn(toISO(day));
  }
  // 이미 투자로 보낸 몫은 빼고 남은 것만 보여준다
  const sentSaved = data.entries
    .filter((e) => e.type === "transfer" && e.savedFrom && isPast(e) && inCycle(e.date))
    .reduce((s, e) => s + e.amount, 0);
  const saved = Math.round(savedRaw) - sentSaved;

  /* 모이는 돈 — 올해 12월 말까지 */
  const curY = nowD.getFullYear(), curM = nowD.getMonth();
  const monthsToDec = 12 - curM;
  const plannedUpTo = (m) => data.planned.filter((p) => p.month <= m).reduce((s, p) => s + p.amount, 0);
  const goalRows = Array.from({ length: monthsToDec }, (_, i) => {
    const m = curM + 1 + i;
    return { key: m, label: `${m}월`, total: investTotal + data.goal.monthly * (i + 1) + plannedUpTo(m) };
  });
  const plannedTotal = data.planned.reduce((s, p) => s + p.amount, 0);
  const goalTotal = investTotal + data.goal.monthly * monthsToDec + plannedUpTo(12);

  /* 고정 항목별 상태 — 다음 실행일 / 마지막 반영일 / 밀린 건수 */
  const ruleInfo = (r) => {
    const done = data.entries.filter((e) => e.ruleId === r.id).map((e) => e.date).sort();
    const pending = pendingDates(data, r, catchUpWindow(), nowD);
    let next = null;
    for (let i = 0, day = startOfDay(nowD); i < 400; i++, day = addDays(day, 1)) {
      const iso = toISO(day);
      if (ruleHitsOn(r, day) && !done.includes(iso)) { next = iso; break; }
    }
    return { next, last: done.length ? done[done.length - 1] : null, pending: pending.length };
  };
  const pendingTotal = data.rules.reduce((s, r) => s + pendingDates(data, r, catchUpWindow(), nowD).length, 0);

  /* 다가오는 고정 항목 — 앞으로 14일 */
  const madeKeys = new Set(data.entries.filter((e) => e.ruleId).map((e) => `${e.ruleId}@${e.date}`));
  const upcoming = [];
  for (let i = 0; i <= 14; i++) {
    const day = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() + i);
    const iso = toISO(day);
    for (const r of data.rules) {
      if (!r.active || !ruleHitsOn(r, day) || madeKeys.has(`${r.id}@${iso}`)) continue;
      upcoming.push({ key: `${r.id}@${iso}`, iso, rule: r });
    }
  }

  const roleWarn = ["spend", "save"]
    .map((r) => {
      const n = data.accounts.filter((a) => a.role === r).length;
      return n === 1 ? null : `'${ROLES[r].label}' 계좌가 ${n === 0 ? "없어요" : `${n}개예요`}`;
    })
    .filter(Boolean)
    .join(" · ");

  /* ── 동작 ── */
  const commitPayday = () => {
    const n = Math.round(parseFloat(payInput));
    if (Number.isFinite(n)) up((d) => { d.payday = Math.min(31, Math.max(1, n)); return d; });
    setEditPay(false);
  };

  const fallbackId = data.accounts[0]?.id ?? null;
  const fromId = eFrom || spendAcc?.id || fallbackId;
  const toId = eTo || fallbackId;
  const kindLabel = { expense: "지출", income: "수입", transfer: "이체" };

  const addEntry = () => {
    const n = parseWon(eAmt);
    if (!n || n <= 0) return;
    const entry = {
      id: uid(), ts: Date.now(), date: eDate || todayISO,
      type: eKind,
      amount: n,
      text: eText.trim() || kindLabel[eKind],
      from: eKind === "income" ? null : fromId,
      to: eKind === "expense" ? null : toId,
      auto: false, ruleId: null,
    };
    upEntries((d) => { d.entries.unshift(entry); d.entries = d.entries.slice(0, 500); return d; });
    setEAmt(""); setEText("");
    setEKind("expense"); // 수입·이체 모드가 남아 다음 지출까지 잘못 잡히는 걸 막는다
  };

  const removeEntry = (id) => upEntries((d) => { d.entries = d.entries.filter((x) => x.id !== id); return d; });

  const startEntryEdit = (e) =>
    setEntryEdit({
      id: e.id, date: e.date, amt: String(e.amount), text: e.text, type: e.type,
      from: e.from ?? fromId, to: e.to ?? toId,
    });

  const saveEntryEdit = () => {
    const n = parseWon(entryEdit.amt);
    if (!n || n <= 0) return;
    upEntries((d) => {
      const e = d.entries.find((x) => x.id === entryEdit.id);
      if (!e) return d;
      e.date = entryEdit.date || e.date;
      e.amount = n;
      e.text = entryEdit.text.trim() || kindLabel[e.type];
      e.from = e.type === "income" ? null : entryEdit.from;
      e.to = e.type === "expense" ? null : entryEdit.to;
      return d;
    });
    setEntryEdit(null);
  };

  const newRule = () => ({
    id: uid(), name: "", amount: "", type: "expense",
    from: spendAcc?.id ?? fallbackId,
    to: fallbackId,
    freq: { kind: "monthly", day: 1 }, startDate: todayISO, active: true, isNew: true,
  });

  /* 고정 항목이 바뀌면 오늘 도래분을 그 자리에서 반영한다 */
  const upRules = (fn) =>
    setData((prev) => {
      const d = fn(structuredClone(prev));
      runRules(d); // 오늘 등록한 규칙이 오늘 도래분이면 새로고침 없이 바로 기록된다
      return d;
    });

  /* 아낀 돈을 투자 계좌로 보낸다 */
  const sendSaved = () => {
    const n = parseWon(sendAmt);
    if (!n || n <= 0 || !spendAcc || !investAcc) return;
    upEntries((d) => {
      d.entries.unshift({
        id: uid(), ts: Date.now(), date: todayISO, type: "transfer", amount: n,
        text: "아낀 돈 → 투자", from: spendAcc.id, to: investAcc.id,
        auto: false, ruleId: null, savedFrom: true,
      });
      d.entries = d.entries.slice(0, 500);
      return d;
    });
    setSendAmt(""); setShowSend(false);
  };

  /* 빠진 자동 반영분을 지금 채운다 (최근 31일) */
  const catchUp = () =>
    setData((prev) => {
      const d = structuredClone(prev);
      applyRules(d, catchUpWindow());
      return d;
    });

  const saveRule = () => {
    const n = parseWon(ruleEdit.amount);
    if (!n || n <= 0 || !ruleEdit.name.trim()) return;
    const r = {
      id: ruleEdit.id, name: ruleEdit.name.trim(), amount: n, type: ruleEdit.type,
      from: ruleEdit.type === "income" ? null : ruleEdit.from,
      to: ruleEdit.type === "expense" ? null : ruleEdit.to,
      freq: ruleEdit.freq, startDate: ruleEdit.startDate, active: ruleEdit.active,
    };
    upRules((d) => {
      const i = d.rules.findIndex((x) => x.id === r.id);
      if (i >= 0) d.rules[i] = r; else d.rules.push(r);
      return d;
    });
    setRuleEdit(null);
  };

  const addPlanned = () => {
    const n = parseWon(pAmt);
    const m = Number(pMonth);
    if (!n || n <= 0 || !m) return;
    up((d) => {
      d.planned.push({ id: uid(), month: m, amount: n, memo: pMemo.trim() || "예정 수입" });
      d.planned.sort((x, y) => x.month - y.month);
      return d;
    });
    setPMonth(""); setPAmt(""); setPMemo("");
  };

  /* 가계부 — 지난 기록은 날짜별로, 아직 오지 않은 기록은 '예정'으로 분리 */
  const pastEntries = data.entries.filter(isPast);
  const futureEntries = data.entries.filter((e) => !isPast(e)).sort((a, b) => a.date.localeCompare(b.date));
  const pastDates = [...new Set(pastEntries.map((e) => e.date))].sort().reverse().slice(0, 40);
  const acctLine = (e) =>
    e.type === "income" ? acctName(e.to) : e.type === "transfer" ? `${acctName(e.from)} → ${acctName(e.to)}` : acctName(e.from);

  const renderEntry = (e, first) =>
    entryEdit && entryEdit.id === e.id ? (
      <div key={e.id} className="py-3" style={{ borderTop: first ? "none" : `1px solid ${C.line}` }}>
        <div className="flex flex-wrap gap-2">
          <Field type="date" value={entryEdit.date}
            onChange={(ev) => setEntryEdit({ ...entryEdit, date: ev.target.value })} className="text-[13px]" />
          <Field autoFocus value={entryEdit.amt} inputMode="decimal"
            onChange={(ev) => setEntryEdit({ ...entryEdit, amt: ev.target.value })}
            onKeyDown={(ev) => { if (ev.key === "Enter") saveEntryEdit(); if (ev.key === "Escape") setEntryEdit(null); }}
            className="w-28 tabular-nums" />
          <Field value={entryEdit.text}
            onChange={(ev) => setEntryEdit({ ...entryEdit, text: ev.target.value })}
            onKeyDown={(ev) => { if (ev.key === "Enter") saveEntryEdit(); if (ev.key === "Escape") setEntryEdit(null); }}
            className="flex-1 min-w-[110px]" />
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          {entryEdit.type !== "income" && (
            <span className="flex items-center gap-1 text-[13px]" style={{ color: C.sub }}>
              출금 <AcctSelect value={entryEdit.from} onChange={(v) => setEntryEdit({ ...entryEdit, from: v })} />
            </span>
          )}
          {entryEdit.type !== "expense" && (
            <span className="flex items-center gap-1 text-[13px]" style={{ color: C.sub }}>
              입금 <AcctSelect value={entryEdit.to} onChange={(v) => setEntryEdit({ ...entryEdit, to: v })} />
            </span>
          )}
          <button onClick={() => setEntryEdit(null)} className="ml-auto text-[15px]" style={{ color: C.sub }}>취소</button>
          <button onClick={saveEntryEdit} className="text-[15px] px-4 py-2 rounded-[10px] font-medium"
            style={{ background: C.accent, color: "#fff" }}>저장</button>
        </div>
      </div>
    ) : (
      <Row key={e.id} first={first} onClick={() => startEntryEdit(e)}>
        <span className="text-[15px] flex-1 min-w-0 truncate"
          style={{ color: e.type === "transfer" ? C.sub : C.text }}>{e.text}</span>
        {e.auto && <Tag>자동</Tag>}
        <div className="text-right shrink-0">
          <div className="text-[15px] tabular-nums"
            style={{ color: e.type === "income" ? C.accent : e.type === "transfer" ? C.sub : C.text }}>
            {e.type === "income" ? "+" : e.type === "transfer" ? "→" : "−"}{fmt(e.amount)}
          </div>
          <div className="text-[13px] truncate max-w-[150px]" style={{ color: C.sub }}>{acctLine(e)}</div>
        </div>
        <button onClick={(ev) => { ev.stopPropagation(); removeEntry(e.id); }}
          style={{ color: C.sub }} title="삭제">×</button>
      </Row>
    );

  const AcctSelect = ({ value, onChange }) => (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)}
      className={`${fieldCls} text-[13px]`} style={{ background: C.field }}>
      {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </select>
  );

  return (
    <div className="min-h-screen pb-14" style={{ background: C.bg, color: C.text }}>
      <div className="max-w-md mx-auto px-4 pt-10 flex flex-col gap-7">

        {/* 헤더 */}
        <header className="flex items-start justify-between px-1">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight leading-tight">민준의 돈</h1>
            <div className="text-[13px] mt-0.5" style={{ color: C.sub }}>쓴 날 바로 적기</div>
          </div>
          {editPay ? (
            <input
              autoFocus type="number" min={1} max={31} inputMode="numeric" defaultValue={data.payday}
              onChange={(e) => setPayInput(e.target.value)}
              onBlur={commitPayday}
              onKeyDown={(e) => { if (e.key === "Enter") commitPayday(); if (e.key === "Escape") setEditPay(false); }}
              className="w-20 text-[15px] text-center rounded-[10px] px-2 py-1.5 outline-none border-0"
              style={{ background: C.fill }}
            />
          ) : (
            <button onClick={() => { setPayInput(String(data.payday)); setEditPay(true); }}
              className="text-right" title="눌러서 급여일 변경">
              <div className="text-[13px]" style={{ color: C.sub }}>다음 입금</div>
              <div className="text-[15px] tabular-nums">D-{pay.days} · {pay.label}</div>
            </button>
          )}
        </header>

        {/* 탭 — 매일 볼 것과 가끔 손볼 것을 나눈다 */}
        <div className="flex rounded-[9px] p-[2px]" style={{ background: C.fill }}>
          {[["daily", "매일"], ["manage", "관리"]].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className="flex-1 py-1.5 rounded-[7px] text-[14px]"
              style={tab === k ? { background: C.card, color: C.text, fontWeight: 500 } : { color: C.sub }}>
              {label}
            </button>
          ))}
        </div>

        {tab === "daily" && (<>

        {/* 오늘 */}
        <Card title="오늘">
          <div className="pt-3 pb-1">
            <div className="text-[13px]" style={{ color: C.sub }}>오늘 쓸 수 있는 돈</div>
            <div className="text-[40px] leading-none font-semibold tabular-nums tracking-tight mt-1"
              style={{ color: overToday ? C.danger : C.text }}>
              {fmt(todayLeft)}
            </div>
            <div className="text-[13px] mt-2" style={{ color: C.sub }}>
              {overToday
                ? `${fmt(-todayLeft)} 초과 · 내일 예산에 반영돼요`
                : todaySpent > 0
                ? `지금 그만두면 내일 ${fmt(tomorrowBudget)}원`
                : "오늘 안 쓴 만큼 내일 예산이 늘어나요"}
            </div>
            <div className="text-[13px] mt-1" style={{ color: C.sub }}>
              쓸돈 {fmt(spendBal)} · 급여일까지 {pay.days}일 · 하루 {fmt(todayBudget)}
            </div>
          </div>

          {/* 입력 — 한 줄 */}
          <div className="py-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <div className="flex flex-wrap items-center gap-2">
              <Seg options={[["expense", "지출"], ["income", "수입"], ["transfer", "이체"]]} value={eKind} onChange={setEKind} />
              <Field value={eAmt} onChange={(e) => setEAmt(e.target.value)} placeholder="금액" inputMode="decimal"
                onKeyDown={(e) => e.key === "Enter" && addEntry()} className="w-24 tabular-nums" />
              <Field value={eText} onChange={(e) => setEText(e.target.value)}
                placeholder={eKind === "income" ? "월급" : eKind === "transfer" ? "이체" : "점심"}
                onKeyDown={(e) => e.key === "Enter" && addEntry()} className="flex-1 min-w-[80px]" />
              <Field type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} className="text-[13px]" />
              {eKind !== "income" && <AcctSelect value={fromId} onChange={setEFrom} />}
              {eKind !== "expense" && <AcctSelect value={toId} onChange={setETo} />}
              <button onClick={addEntry}
                className="ml-auto text-[15px] px-4 py-2 rounded-[10px] font-medium"
                style={{ background: C.accent, color: "#fff" }}>
                적기
              </button>
            </div>
          </div>

          {/* 아낀 돈 */}
          <Row>
            <span className="text-[13px] flex-1" style={{ color: C.sub }}>
              이번 사이클 아낀 돈 <span className="tabular-nums" style={{ color: C.text }}>{fmt(saved)}</span>
            </span>
            {saved > 0 && investAcc && spendAcc && !showSend && (
              <button onClick={() => { setSendAmt(String(saved)); setShowSend(true); }}
                className="text-[13px]" style={{ color: C.accent }}>투자로 보내기</button>
            )}
          </Row>
          {showSend && (
            <Row>
              <Field autoFocus value={sendAmt} onChange={(e) => setSendAmt(e.target.value)} inputMode="decimal"
                onKeyDown={(e) => { if (e.key === "Enter") sendSaved(); if (e.key === "Escape") setShowSend(false); }}
                className="flex-1 tabular-nums" />
              <button onClick={sendSaved} className="text-[15px] px-3.5 py-2 rounded-[10px] font-medium"
                style={{ background: C.accent, color: "#fff" }}>보내기</button>
              <button onClick={() => setShowSend(false)} className="text-[15px]" style={{ color: C.sub }}>취소</button>
            </Row>
          )}
        </Card>

        </>)}

        {tab === "manage" && (<>

        {/* 예산 */}
        <Card title="하루 예산">
          <Row first>
            <span className="text-[15px] flex-1">오늘 예산</span>
            <span className="text-[15px] tabular-nums">{fmt(todayBudget)}</span>
          </Row>
          <Row align="items-start">
            <span className="text-[13px] shrink-0" style={{ color: C.sub }}>계산 근거</span>
            <span className="text-[13px] tabular-nums flex-1 text-right" style={{ color: C.sub }}>
              {fmt(dayBase)} ÷ {spreadDays}일 = 하루 {fmt(todayBudget)}
              {spreadDays !== pay.days && ` (최소 ${MIN_SPREAD_DAYS}일로 폄)`}
            </span>
          </Row>
          <Row>
            <span className="text-[13px] flex-1" style={{ color: C.sub }}>다음 입금</span>
            <span className="text-[13px]" style={{ color: C.sub }}>{pay.label} · {pay.days}일 남음</span>
          </Row>
          <Row>
            <span className="text-[15px] flex-1">주 시작</span>
            <Seg options={[[0, "일"], [1, "월"]]} value={data.weekStart}
              onChange={(k) => up((d) => { d.weekStart = k; return d; })} />
          </Row>
          <Row align="items-start">
            <span className="text-[13px] shrink-0" style={{ color: C.sub }}>
              이번 사이클 {md(cycleStart)} – {md(cycleLast)}
            </span>
            <span className="text-[13px] tabular-nums flex-1 text-right" style={{ color: C.sub }}>
              쓸돈 {fmt(cycleSpend)} · 전체 {fmt(cycleAll)}
            </span>
          </Row>
        </Card>

        {/* 계좌 */}
        <Card
          title="계좌"
          right={
            <button onClick={() => setEditAcc(!editAcc)} className="text-[13px] flex items-center gap-1" style={{ color: C.accent }}>
              {editAcc ? <><Check size={14} /> 완료</> : <><Pencil size={13} /> 편집</>}
            </button>
          }
        >
          {roleWarn && (
            <Row first>
              <span className="text-[13px]" style={{ color: C.danger }}>
                {roleWarn} — 자동 예산이 '쓸돈' 역할 계좌를 기준으로 잡혀요.
              </span>
            </Row>
          )}
          {data.accounts.map((a, i) => (
            <Row key={a.id} first={i === 0 && !roleWarn}>
              <button
                onClick={() => editAcc && up((d) => {
                  const t = d.accounts.find((x) => x.id === a.id);
                  t.role = ROLE_ORDER[(ROLE_ORDER.indexOf(t.role) + 1) % ROLE_ORDER.length];
                  return d;
                })}
                className="shrink-0 w-11 text-left text-[13px]"
                style={{ color: C.sub }}
                title={editAcc ? "눌러서 역할 변경" : ROLES[a.role].label}
              >
                {ROLES[a.role].label}
              </button>
              <div className="flex-1 min-w-0">
                {editAcc ? (
                  <Field value={a.name} className="w-full text-[15px]"
                    onChange={(e) => up((d) => { d.accounts.find((x) => x.id === a.id).name = e.target.value; return d; })} />
                ) : (
                  <>
                    <div className="text-[15px] truncate">{a.name}</div>
                    {a.note && <div className="text-[13px] truncate" style={{ color: C.sub }}>{a.note}</div>}
                  </>
                )}
              </div>
              <Amount value={bal(a)} className="text-[15px]"
                onCommit={(n) => up((d) => {
                  const t = d.accounts.find((x) => x.id === a.id);
                  t.baseAmount = n;
                  t.baseTs = Date.now(); // 여기서부터 다시 센다
                  return d;
                })} />
              {editAcc && (
                <button onClick={() => up((d) => { d.accounts = d.accounts.filter((x) => x.id !== a.id); return d; })}
                  style={{ color: C.danger }} title="삭제"><Trash2 size={17} /></button>
              )}
            </Row>
          ))}
          {editAcc && (
            <Row onClick={() => up((d) => { d.accounts.push({ id: uid(), name: "새 계좌", note: "", baseAmount: 0, baseTs: Date.now(), role: "hub" }); return d; })}>
              <span className="text-[15px] flex items-center gap-1.5" style={{ color: C.accent }}><Plus size={15} /> 계좌 추가</span>
            </Row>
          )}
          <Row>
            <div className="flex-1">
              <div className="text-[13px]" style={{ color: C.sub }}>전체</div>
              <div className="text-[22px] font-semibold tabular-nums tracking-tight">{fmt(cashTotal + investTotal)}</div>
            </div>
            <div className="text-right text-[13px] tabular-nums" style={{ color: C.sub }}>
              현금 {fmt(cashTotal)}<br />투자 {fmt(investTotal)}
            </div>
          </Row>
        </Card>

        {/* 고정 항목 */}
        <Card
          title="고정 항목"
          right={!ruleEdit && (
            <button onClick={() => setRuleEdit(newRule())} className="text-[13px] flex items-center gap-1" style={{ color: C.accent }}>
              <Plus size={14} /> 추가
            </button>
          )}
        >
          <Row first>
            <span className="text-[13px] flex-1" style={{ color: C.sub }}>
              {data.lastAuto
                ? `마지막 자동 반영: ${md(fromISO(data.lastAuto.date))} · ${data.lastAuto.count}건`
                : "아직 자동 반영된 기록이 없어요"}
            </span>
            {pendingTotal > 0 && (
              <button onClick={catchUp} className="text-[13px] px-2.5 py-1 rounded-[8px] font-medium"
                style={{ background: C.accent, color: "#fff" }}>
                지금 반영 {pendingTotal}건
              </button>
            )}
          </Row>
          {data.rules.length === 0 && !ruleEdit && (
            <Row><span className="text-[15px]" style={{ color: C.sub }}>자동이체·고정수입을 등록해 두면 날짜에 맞춰 기록돼요.</span></Row>
          )}
          {data.rules.map((r) => {
            const info = ruleInfo(r);
            return (
              <Row key={r.id} onClick={() => setRuleEdit({ ...r, amount: String(r.amount) })}>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] truncate" style={{ color: r.active ? C.text : C.sub }}>{r.name}</div>
                  <div className="text-[13px] truncate" style={{ color: C.sub }}>
                    {freqLabel(r.freq)} · {r.type === "income" ? `→ ${acctName(r.to)}` : r.type === "transfer" ? `${acctName(r.from)} → ${acctName(r.to)}` : acctName(r.from)}
                  </div>
                  <div className="text-[13px] truncate" style={{ color: C.sub }}>
                    다음 {info.next ? md(fromISO(info.next)) : "—"} · 마지막 {info.last ? md(fromISO(info.last)) : "—"}
                  </div>
                </div>
                {info.pending > 0 && <Tag>밀림 {info.pending}</Tag>}
                {!r.active && <Tag>중지</Tag>}
                <span className="text-[15px] tabular-nums" style={{ color: r.type === "income" ? C.accent : C.text }}>
                  {r.type === "income" ? "+" : r.type === "transfer" ? "→" : "−"}{fmt(r.amount)}
                </span>
              </Row>
            );
          })}

          {ruleEdit && (
            <div className="py-3" style={{ borderTop: data.rules.length ? `1px solid ${C.line}` : "none" }}>
              <div className="flex flex-wrap gap-2">
                <Field value={ruleEdit.name} onChange={(e) => setRuleEdit({ ...ruleEdit, name: e.target.value })}
                  placeholder="이름 (예: 월세)" className="flex-1 min-w-[120px]" autoFocus />
                <Field value={ruleEdit.amount} onChange={(e) => setRuleEdit({ ...ruleEdit, amount: e.target.value })}
                  placeholder="금액" inputMode="decimal" className="w-28 tabular-nums" />
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <Seg options={[["expense", "지출"], ["income", "수입"], ["transfer", "이체"]]}
                  value={ruleEdit.type} onChange={(k) => setRuleEdit({ ...ruleEdit, type: k })} />
                {ruleEdit.type !== "income" && (
                  <span className="flex items-center gap-1 text-[13px]" style={{ color: C.sub }}>
                    출금 <AcctSelect value={ruleEdit.from} onChange={(v) => setRuleEdit({ ...ruleEdit, from: v })} />
                  </span>
                )}
                {ruleEdit.type !== "expense" && (
                  <span className="flex items-center gap-1 text-[13px]" style={{ color: C.sub }}>
                    입금 <AcctSelect value={ruleEdit.to} onChange={(v) => setRuleEdit({ ...ruleEdit, to: v })} />
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <Seg options={[["monthly", "매월"], ["monthEnd", "말일"], ["weekly", "매주"]]} value={ruleEdit.freq.kind}
                  onChange={(k) => setRuleEdit({
                    ...ruleEdit,
                    freq: k === "weekly" ? { kind: "weekly", dow: 1 } : k === "monthEnd" ? { kind: "monthEnd" } : { kind: "monthly", day: 1 },
                  })} />
                {ruleEdit.freq.kind === "monthEnd" ? null : ruleEdit.freq.kind === "monthly" ? (
                  <span className="flex items-center gap-1 text-[13px]" style={{ color: C.sub }}>
                    <Field type="number" min={1} max={31} value={ruleEdit.freq.day}
                      onChange={(e) => setRuleEdit({ ...ruleEdit, freq: { kind: "monthly", day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) } })}
                      className="w-16 text-[13px] tabular-nums" />
                    일
                  </span>
                ) : (
                  <select value={ruleEdit.freq.dow}
                    onChange={(e) => setRuleEdit({ ...ruleEdit, freq: { kind: "weekly", dow: Number(e.target.value) } })}
                    className={`${fieldCls} text-[13px]`} style={{ background: C.field }}>
                    {WD.map((w, i) => <option key={w} value={i}>{w}요일</option>)}
                  </select>
                )}
                <span className="flex items-center gap-1 text-[13px]" style={{ color: C.sub }}>
                  시작 <Field type="date" value={ruleEdit.startDate}
                    onChange={(e) => setRuleEdit({ ...ruleEdit, startDate: e.target.value })} className="text-[13px]" />
                </span>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <Seg options={[[true, "사용"], [false, "중지"]]} value={ruleEdit.active}
                  onChange={(k) => setRuleEdit({ ...ruleEdit, active: k })} />
                {!ruleEdit.isNew && (
                  <button onClick={() => { upRules((d) => { d.rules = d.rules.filter((x) => x.id !== ruleEdit.id); return d; }); setRuleEdit(null); }}
                    style={{ color: C.danger }} title="삭제"><Trash2 size={17} /></button>
                )}
                <button onClick={() => setRuleEdit(null)} className="ml-auto text-[15px]" style={{ color: C.sub }}>취소</button>
                <button onClick={saveRule} className="text-[15px] px-4 py-2 rounded-[10px] font-medium"
                  style={{ background: C.accent, color: "#fff" }}>저장</button>
              </div>
            </div>
          )}
        </Card>

        {/* 다가오는 항목 */}
        {upcoming.length > 0 && (
          <Card title="다가오는 항목 · 14일">
            {upcoming.map((u, i) => (
              <Row key={u.key} first={i === 0}>
                <span className="text-[15px] tabular-nums w-16 shrink-0" style={{ color: C.sub }}>{dayLabel(u.iso)}</span>
                <span className="text-[15px] flex-1 min-w-0 truncate">{u.rule.name}</span>
                <span className="text-[15px] tabular-nums" style={{ color: u.rule.type === "income" ? C.accent : C.text }}>
                  {u.rule.type === "income" ? "+" : u.rule.type === "transfer" ? "→" : "−"}{fmt(u.rule.amount)}
                </span>
              </Row>
            ))}
          </Card>
        )}

        </>)}

        {tab === "daily" && (<>

        {/* 가계부 */}
        <Card title="가계부">
          <Row first>
            <span className="text-[13px] flex-1" style={{ color: C.sub }}>이번 주</span>
            <span className="text-[13px] tabular-nums" style={{ color: C.sub }}>{fmt(weekSpent)}</span>
          </Row>
          {pastDates.length === 0 && futureEntries.length === 0 && (
            <Row><span className="text-[15px]" style={{ color: C.sub }}>아직 기록이 없어요.</span></Row>
          )}
          {pastDates.map((dt, di) => {
            const list = pastEntries.filter((e) => e.date === dt);
            const dSum = list.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
            // 주가 바뀌는 자리에만 얇은 선을 둔다
            const newWeek = di > 0 && toISO(sow(fromISO(dt))) !== toISO(sow(fromISO(pastDates[di - 1])));
            return (
              <div key={dt} style={newWeek ? { borderTop: `1px solid ${C.line}`, marginTop: 10 } : undefined}>
                <div className="pt-3 pb-1 flex justify-between text-[13px]" style={{ color: C.sub }}>
                  <span>{dayLabel(dt)}</span>
                  <span className="tabular-nums">{fmt(dSum)}</span>
                </div>
                {list.map((e, i) => renderEntry(e, i === 0))}
              </div>
            );
          })}
          {futureEntries.length > 0 && (
            <>
              <Row onClick={() => setShowFuture(!showFuture)}>
                <span className="text-[15px] flex-1">예정 {futureEntries.length}건</span>
                <span className="text-[13px]" style={{ color: C.accent }}>{showFuture ? "접기" : "펼치기"}</span>
              </Row>
              {showFuture &&
                [...new Set(futureEntries.map((e) => e.date))].map((dt) => (
                  <div key={`f-${dt}`}>
                    <div className="pt-3 pb-1 text-[13px]" style={{ color: C.sub }}>{dayLabel(dt)}</div>
                    {futureEntries.filter((e) => e.date === dt).map((e, i) => renderEntry(e, i === 0))}
                  </div>
                ))}
            </>
          )}
        </Card>

        </>)}

        {tab === "manage" && (<>

        {/* 모이는 돈 */}
        <Card title="모이는 돈">
          <div className="pt-3 pb-1">
            <div className="text-[13px]" style={{ color: C.sub }}>{curY}년 12월 말 예상 투자 원금</div>
            <div className="text-[28px] leading-none font-semibold tabular-nums tracking-tight mt-1">{fmt(goalTotal)}</div>
            <div className="text-[13px] mt-2" style={{ color: C.sub }}>
              지금 {fmt(investTotal)} + 월 {fmt(data.goal.monthly)} × {monthsToDec}개월
              {plannedTotal > 0 && ` + 예정 ${fmt(plannedTotal)}`}
            </div>
          </div>
          <Row>
            <span className="text-[15px] flex-1">월 적립액</span>
            <Amount value={data.goal.monthly} className="text-[15px]"
              onCommit={(n) => up((d) => { d.goal.monthly = n; return d; })} />
          </Row>
          {goalRows.map((r) => (
            <Row key={r.key}>
              <span className="text-[15px] flex-1" style={{ color: C.sub }}>{r.label}</span>
              <span className="text-[15px] tabular-nums">{fmt(r.total)}</span>
            </Row>
          ))}
          <Row>
            <span className="text-[13px] flex-1" style={{ color: C.sub }}>
              예정 수입{plannedTotal > 0 && ` · 합계 ${fmt(plannedTotal)}`}
            </span>
          </Row>
          {data.planned.map((p) => (
            <Row key={p.id}>
              <span className="text-[15px] flex-1 min-w-0 truncate">{p.memo}</span>
              <span className="text-[15px] tabular-nums" style={{ color: C.accent }}>+{fmt(p.amount)}</span>
              <button onClick={() => up((d) => { d.planned = d.planned.filter((x) => x.id !== p.id); return d; })}
                style={{ color: C.sub }} title="삭제">×</button>
            </Row>
          ))}
          <div className="py-3 flex flex-wrap gap-2" style={{ borderTop: `1px solid ${C.line}` }}>
            <select value={pMonth} onChange={(e) => setPMonth(e.target.value)}
              className={`${fieldCls} text-[13px]`} style={{ background: C.field, color: pMonth ? C.text : C.sub }}>
              <option value="">월</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
            <Field value={pAmt} onChange={(e) => setPAmt(e.target.value)} placeholder="금액" inputMode="decimal"
              onKeyDown={(e) => e.key === "Enter" && addPlanned()} className="w-24 tabular-nums" />
            <Field value={pMemo} onChange={(e) => setPMemo(e.target.value)} placeholder="메모"
              onKeyDown={(e) => e.key === "Enter" && addPlanned()} className="flex-1 min-w-[80px]" />
            <button onClick={addPlanned} className="text-[15px] px-3.5 py-2 rounded-[10px]" style={{ color: C.accent }}>추가</button>
          </div>
        </Card>

        {/* 메모 */}
        <Card title="메모">
          <textarea
            value={data.routine}
            onChange={(e) => up((d) => { d.routine = e.target.value; return d; })}
            rows={4}
            placeholder="이번 달에 챙길 것"
            className="w-full text-[15px] leading-6 outline-none resize-none py-3 border-0"
            style={{ background: "transparent", color: C.text }}
          />
        </Card>

        {/* 백업 */}
        {showBackup && (
          <Card title="백업 / 이사">
            <textarea
              value={importText} onChange={(e) => setImportText(e.target.value)} rows={7} spellCheck={false}
              className="w-full text-[12px] leading-4 rounded-[10px] p-2.5 my-3 outline-none resize-y border-0"
              style={{ background: C.field, color: C.text }}
            />
            <Row>
              <button onClick={() => { setImportText(JSON.stringify(data, null, 2)); setBkMsg("현재 상태를 담았어요. 전체 선택해서 복사해 두세요."); }}
                className="text-[15px]" style={{ color: C.accent }}>현재 상태 담기</button>
              <button
                onClick={() => {
                  try {
                    const d = normalize(JSON.parse(importText));
                    runRules(d);
                    setData(d);
                    setBkMsg("복원 완료.");
                  } catch { setBkMsg("JSON 형식이 아니에요. 백업 텍스트 전체를 그대로 붙여넣어 주세요."); }
                }}
                className="ml-auto text-[15px]" style={{ color: C.accent }}>이 내용으로 복원</button>
            </Row>
            {bkMsg && <Row><span className="text-[13px]" style={{ color: C.sub }}>{bkMsg}</span></Row>}
          </Card>
        )}

        </>)}

        <footer className="flex items-center justify-between px-4 text-[13px]" style={{ color: C.sub }}>
          <span>{saveState || "적으면 자동 저장"}</span>
          {tab === "manage" && (
            <span className="flex items-center gap-4">
              <button onClick={() => { setShowBackup(!showBackup); if (!showBackup) { setImportText(JSON.stringify(data, null, 2)); setBkMsg(""); } }}>
                백업
              </button>
              {confirmReset ? (
                <>
                  <button onClick={() => { setData(structuredClone(SEED)); setConfirmReset(false); }} style={{ color: C.danger }}>정말 초기화</button>
                  <button onClick={() => setConfirmReset(false)}>취소</button>
                </>
              ) : (
                <button onClick={() => setConfirmReset(true)} className="flex items-center gap-1">
                  <RotateCcw size={12} /> 초기화
                </button>
              )}
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
