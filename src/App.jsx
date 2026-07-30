import { useState, useEffect, useRef } from "react";
import { Trash2, Plus, RotateCcw, Pencil, Check } from "lucide-react";

/* ── 원장(passbook) 토큰 ───────────────────────────── */
const C = {
  paper: "#EFF2EC",
  card: "#FBFCFA",
  ink: "#1C2420",
  sub: "#5E6B62",
  line: "#D9DFD3",
  green: "#2E5C46",
  red: "#B3402F",
  blue: "#4C6580",
};

const ROLES = {
  hub:    { label: "허브", dot: "#6B7280" },
  spend:  { label: "쓸돈", dot: C.green },
  save:   { label: "모음", dot: C.blue },
  invest: { label: "투자", dot: C.ink },
};
const ROLE_ORDER = ["hub", "spend", "save", "invest"];
/* 어떤 역할 계좌가 어떤 출처의 지출을 떠안는지 */
const ROLE_SRC = { spend: "week", save: "box" };

const KEY = "minjun-money-v1";

const SEED = {
  v: 6,
  unit: "won",
  payday: 25,
  autoBudget: true,
  budget: null, // 이번 주 확정된 자동 예산 { week, amount, weeks, days, balance }
  weeklyBudget: 100000, // 수동 모드에서 쓰는 값
  accounts: [
    { id: "a1", name: "주계좌", note: "수입이 들어오는 곳 · 고정비 대기", baseAmount: 0, baseTs: 0, role: "hub" },
    { id: "a2", name: "세이프박스", note: "일정 없이 꺼내 쓰는 자유 풀", baseAmount: 0, baseTs: 0, role: "save" },
    { id: "a3", name: "생활비 통장", note: "주간 예산이 나가는 곳", baseAmount: 0, baseTs: 0, role: "spend" },
    { id: "a4", name: "투자 계좌", note: "원금 기록 — 자주 안 보기", baseAmount: 0, baseTs: 0, role: "invest" },
  ],
  expenses: [],
  planned: [],
  goal: { monthly: 0 },
  routine:
    "월급일: 수입 입금 확인\n다음날: 투자 계좌 자동이체\n매주 월요일: 생활비 통장으로 주간 예산 이체\n점검은 월 1회, 10분",
};

/* ── 헬퍼 ─────────────────────────────────────────── */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/* 모든 금액은 원 단위 정수 */
const parseWon = (s) => {
  const n = parseFloat(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.round(n) : null;
};
const fmt = (n) => (n == null ? "" : Math.round(n).toLocaleString("ko-KR"));
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromISO = (s) => {
  const [y, m, dd] = s.split("-").map(Number);
  return new Date(y, m - 1, dd);
};
/* 주는 일요일 시작 */
const sundayOf = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
};
const md = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const dayLabel = (iso) => {
  const d = fromISO(iso);
  return `${md(d)} (${WD[d.getDay()]})`;
};
function paydayInfo(payday) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const next = new Date(now.getFullYear(), now.getMonth(), payday);
  if (now.getDate() >= payday) next.setMonth(next.getMonth() + 1);
  const days = Math.max(1, Math.round((next - today) / 86400000));
  return { days, label: `${next.getMonth() + 1}월 ${next.getDate()}일 (${WD[next.getDay()]})` };
}
/* 어떤 버전의 저장본이 와도 v4 형태로 맞춰줌 */
const normalize = (p) => {
  const now = Date.now();
  const src = Array.isArray(p.expenses) ? p.expenses : [];
  // unit 플래그가 없으면 만원 단위 저장본 → 한 번만 ×10000 (플래그가 중복 변환을 막는다)
  const cv = (v) => Math.round((Number(v) || 0) * (p.unit === "won" ? 1 : 10000));
  return {
    v: 6,
    unit: "won",
    payday: Number.isFinite(p.payday) ? p.payday : SEED.payday,
    autoBudget: typeof p.autoBudget === "boolean" ? p.autoBudget : true,
    budget:
      p.budget && typeof p.budget.week === "string"
        ? { week: p.budget.week, amount: cv(p.budget.amount), balance: cv(p.budget.balance), weeks: Number(p.budget.weeks) || 1, days: Number(p.budget.days) || 7 }
        : null,
    weeklyBudget: Number.isFinite(p.weeklyBudget) ? cv(p.weeklyBudget) : SEED.weeklyBudget,
    accounts: Array.isArray(p.accounts)
      ? p.accounts.map((a) => ({
          id: a.id ?? uid(),
          name: a.name ?? "계좌",
          note: a.note ?? "",
          role: ROLES[a.role] ? a.role : "hub",
          // 구버전(가감식) 저장본의 amount는 이미 지출이 빠진 값 → 그대로 기준값으로 삼고
          // 기준시각을 '지금'으로 둬서 과거 지출이 다시 빠지지 않게 한다
          baseAmount: cv(Number.isFinite(a.baseAmount) ? a.baseAmount : Number.isFinite(a.amount) ? a.amount : 0),
          baseTs: Number.isFinite(a.baseTs) ? a.baseTs : now,
        }))
      : structuredClone(SEED.accounts),
    expenses: src.map((e) => ({
      ...e,
      amount: cv(e.amount),
      // ts 없는 구버전 기록은 날짜로 보정하되, 마이그레이션 시각보다는 반드시 앞에 둔다
      ts: Number.isFinite(e.ts) ? e.ts : Math.min(fromISO(e.date).getTime(), now - 1),
    })),
    // 구버전 백업의 todos·roadmap은 조용히 버린다
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

/* 지출만 셀 때 — 수입·이체는 지출 합계에 들어가지 않는다 */
const isExpense = (e) => e.kind == null;

/* 표시 잔액 = 기준값 − 기준시각 이후의 해당 역할 지출 + 수입 ± 계좌 간 이체 */
const balanceOf = (d, a) => {
  const src = ROLE_SRC[a.role];
  let v = a.baseAmount;
  for (const e of d.expenses) {
    if (e.ts <= a.baseTs) continue;
    if (e.kind === "income") {
      if (e.acct === a.id) v += e.amount;
    } else if (e.kind === "transfer") {
      if (e.to === a.id) v += e.amount;
      if (e.from === a.id) v -= e.amount;
    } else if (src && e.src === src) v -= e.amount;
  }
  return Math.round(v);
};

/* 자동 예산 근거: 오늘부터 월말까지 남은 주수로 쓸돈 잔액을 나눈다 */
const budgetBasis = (spendBal) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const days = Math.max(1, Math.round((nextMonth - today) / 86400000)); // 오늘 포함 월말까지
  const weeks = Math.max(1, Math.ceil(days / 7));
  return { weeks, days, balance: spendBal, amount: Math.max(0, Math.floor(spendBal / weeks / 1000) * 1000) };
};

/* ── 소형 컴포넌트 ─────────────────────────────────── */
function Amount({ value, onCommit, big = false, color = C.ink }) {
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
        className={`font-mono tabular-nums text-right rounded px-1 outline-none ${big ? "text-3xl w-40" : "text-base w-28"}`}
        style={{ background: "#fff", border: `1px solid ${C.green}`, color: C.ink }}
      />
    );
  return (
    <button
      onClick={() => { setV(String(value)); setEditing(true); }}
      className={`font-mono tabular-nums text-right ${big ? "text-3xl" : "text-base"}`}
      style={{ color, borderBottom: `1px dotted ${C.line}`, minHeight: 28 }}
      title="눌러서 수정"
    >
      {fmt(value)}
    </button>
  );
}

function Card({ title, right, children }) {
  return (
    <section className="rounded-xl px-4 py-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
      {title && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs tracking-widest font-semibold" style={{ color: C.sub }}>{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function EditToggle({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] px-2 py-1 rounded"
      style={{ color: on ? "#fff" : C.sub, background: on ? C.green : "transparent", border: `1px solid ${on ? C.green : C.line}` }}
    >
      {on ? <Check size={12} /> : <Pencil size={12} />} {on ? "완료" : "편집"}
    </button>
  );
}

/* ── 메인 ─────────────────────────────────────────── */
export default function MoneyBoard() {
  const [data, setData] = useState(null);
  const [editAcc, setEditAcc] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [importText, setImportText] = useState("");
  const [bkMsg, setBkMsg] = useState("");
  const [eAmt, setEAmt] = useState("");
  const [eText, setEText] = useState("");
  const [eDate, setEDate] = useState(toISO(new Date()));
  const [eSrc, setESrc] = useState("week");
  const [expEdit, setExpEdit] = useState(null); // { id, date, amt, text, src }
  const [editPay, setEditPay] = useState(false);
  const [payInput, setPayInput] = useState("");
  const [eKind, setEKind] = useState("expense"); // expense | income
  const [eAcct, setEAcct] = useState("");
  const [showPull, setShowPull] = useState(false);
  const [pullAmt, setPullAmt] = useState("");
  const [pMonth, setPMonth] = useState("");
  const [pAmt, setPAmt] = useState("");
  const [pMemo, setPMemo] = useState("");
  const loaded = useRef(false);
  const timer = useRef(null);

  useEffect(() => {
    (async () => {
      let d = SEED;
      try {
        const r = localStorage.getItem(KEY);
        if (r) d = normalize(JSON.parse(r));
      } catch { /* 저장본 없으면 시드로 시작 */ }
      setData(d);
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current || !data) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        localStorage.setItem(KEY, JSON.stringify(data));
        const d = new Date();
        setSaveState(`저장됨 ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`);
      } catch {
        setSaveState("저장 실패 — 잠시 후 아무 항목이나 다시 수정하면 재시도돼요");
      }
    }, 600);
    return () => clearTimeout(timer.current);
  }, [data]);

  /* 주가 바뀌면(또는 아직 산정 전이면) 그 주의 예산을 한 번 확정하고, 주중에는 건드리지 않는다 */
  useEffect(() => {
    if (!loaded.current || !data || !data.autoBudget) return;
    const wk = toISO(sundayOf(new Date()));
    if (data.budget && data.budget.week === wk) return;
    setData((prev) => {
      const d = structuredClone(prev);
      const spend = d.accounts.find((a) => a.role === "spend");
      d.budget = { week: wk, ...budgetBasis(spend ? balanceOf(d, spend) : 0) };
      return d;
    });
  }, [data]);

  if (!data)
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper, color: C.sub }}>
        원장 펼치는 중…
      </div>
    );

  /* 파생값 */
  const todayISO = toISO(new Date());
  const thisWeekKey = toISO(sundayOf(new Date()));
  const inThisWeek = (iso) => toISO(sundayOf(fromISO(iso))) === thisWeekKey;

  const budget = data.autoBudget ? data.budget?.amount ?? 0 : data.weeklyBudget;
  const weekSpent = data.expenses.filter((e) => e.src === "week" && inThisWeek(e.date)).reduce((s, e) => s + e.amount, 0);
  const remaining = Math.round(budget - weekSpent);
  const daysLeftWeek = 7 - new Date().getDay();
  const perDay = Math.max(remaining, 0) / daysLeftWeek;
  const todaySpent = data.expenses.filter((e) => e.date === todayISO && isExpense(e)).reduce((s, e) => s + e.amount, 0);

  const bal = (a) => balanceOf(data, a);
  const boxTotal = data.accounts.filter((a) => a.role === "save").reduce((s, a) => s + bal(a), 0);
  const boxUsed = data.expenses.filter((e) => e.src === "box").reduce((s, e) => s + e.amount, 0);
  const boxThisWeek = data.expenses.filter((e) => e.src === "box" && inThisWeek(e.date)).reduce((s, e) => s + e.amount, 0);

  /* 급여 사이클: 직전 급여일 ~ 다음 급여일 전날 */
  const nowD = new Date();
  const cycleStart = new Date(nowD.getFullYear(), nowD.getMonth() - (nowD.getDate() < data.payday ? 1 : 0), data.payday);
  const cycleEnd = new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, data.payday);
  const cycleLast = new Date(cycleEnd); cycleLast.setDate(cycleLast.getDate() - 1);
  const cycleStartISO = toISO(cycleStart), cycleEndISO = toISO(cycleEnd);
  const inCycle = (iso) => iso >= cycleStartISO && iso < cycleEndISO;
  const cycleWeek = data.expenses.filter((e) => e.src === "week" && inCycle(e.date)).reduce((s, e) => s + e.amount, 0);
  const cycleBox = data.expenses.filter((e) => e.src === "box" && inCycle(e.date)).reduce((s, e) => s + e.amount, 0);

  const cashTotal = data.accounts.filter((a) => a.role !== "invest").reduce((s, a) => s + bal(a), 0);
  const investTotal = data.accounts.filter((a) => a.role === "invest").reduce((s, a) => s + bal(a), 0);

  /* 역할 계좌가 없거나 중복이면 지출이 엉뚱하게 반영된다 */
  const roleWarn = ["spend", "save"]
    .map((r) => {
      const n = data.accounts.filter((a) => a.role === r).length;
      if (n === 1) return null;
      return `'${ROLES[r].label}' 계좌가 ${n === 0 ? "없어요" : `${n}개예요`}`;
    })
    .filter(Boolean)
    .join(" · ");

  const pay = paydayInfo(data.payday);
  const over = remaining < 0;

  /* 모이는 돈 — 올해 12월 말까지 (이번 달 적립분부터 센다) */
  const curY = nowD.getFullYear(), curM = nowD.getMonth();
  const monthsToDec = 12 - curM;
  const plannedUpTo = (m) => data.planned.filter((p) => p.month <= m).reduce((s, p) => s + p.amount, 0);
  const goalRows = Array.from({ length: monthsToDec }, (_, i) => {
    const m = curM + 1 + i;
    return { key: m, label: `${m}월`, total: investTotal + data.goal.monthly * (i + 1) + plannedUpTo(m) };
  });
  const plannedTotal = data.planned.reduce((s, p) => s + p.amount, 0);
  const goalTotal = investTotal + data.goal.monthly * monthsToDec + plannedUpTo(12);

  const up = (fn) => setData((d) => fn(structuredClone(d)));

  const commitPayday = () => {
    const n = Math.round(parseFloat(payInput));
    if (Number.isFinite(n)) {
      const v = Math.min(31, Math.max(1, n));
      up((d) => { d.payday = v; return d; });
    }
    setEditPay(false);
  };

  const acctId = eAcct || data.accounts[0]?.id;
  const acctName = (id) => data.accounts.find((a) => a.id === id)?.name ?? "삭제된 계좌";

  const addExpense = () => {
    const n = parseWon(eAmt);
    if (!n || n <= 0) return;
    const base = { id: uid(), date: eDate || todayISO, amount: n, ts: Date.now() };
    const entry =
      eKind === "income"
        ? { ...base, text: eText.trim() || "수입", kind: "income", acct: acctId }
        : { ...base, text: eText.trim() || "지출", src: eSrc };
    up((d) => {
      d.expenses.unshift(entry);
      d.expenses = d.expenses.slice(0, 400);
      return d;
    });
    setEAmt(""); setEText("");
    setEKind("expense"); // 수입 모드가 남아 다음 지출까지 수입으로 잡히는 걸 막는다
  };

  /* 박스 → 쓸돈 계좌 이체 (지출이 아니라 계좌 간 이동) */
  const pullFromBox = () => {
    const n = parseWon(pullAmt);
    const from = data.accounts.find((a) => a.role === "save");
    const to = data.accounts.find((a) => a.role === "spend");
    if (!n || n <= 0 || !from || !to) return;
    up((d) => {
      d.expenses.unshift({
        id: uid(), date: todayISO, text: `${from.name} → ${to.name}`,
        amount: n, kind: "transfer", from: from.id, to: to.id, ts: Date.now(),
      });
      d.expenses = d.expenses.slice(0, 400);
      if (d.autoBudget) {
        // 쓸돈이 늘었으니 이번 주 예산을 바로 다시 확정한다
        const acc = d.accounts.find((a) => a.id === to.id);
        d.budget = { week: toISO(sundayOf(new Date())), ...budgetBasis(balanceOf(d, acc)) };
      }
      return d;
    });
    setPullAmt(""); setShowPull(false);
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

  const removeExpense = (id) => {
    up((d) => {
      d.expenses = d.expenses.filter((x) => x.id !== id);
      return d;
    });
  };

  const startExpEdit = (e) =>
    setExpEdit({
      id: e.id, date: e.date, amt: String(e.amount), text: e.text,
      src: e.src ?? "week", kind: e.kind === "income" ? "income" : "expense", acct: e.acct ?? acctId,
    });

  const saveExpEdit = () => {
    const n = parseWon(expEdit.amt);
    if (!n || n <= 0) return;
    up((d) => {
      const e = d.expenses.find((x) => x.id === expEdit.id);
      if (!e) return d;
      e.date = expEdit.date || e.date;
      e.amount = n;
      if (expEdit.kind === "income") {
        e.text = expEdit.text.trim() || "수입";
        e.acct = expEdit.acct;
      } else {
        e.text = expEdit.text.trim() || "지출";
        e.src = expEdit.src;
      }
      return d; // 잔액은 기준값에서 다시 계산되므로 따로 가감하지 않는다
    });
    setExpEdit(null);
  };

  /* 가계부 그룹핑: 주 → 일 */
  const byWeek = {};
  for (const e of data.expenses) {
    const wk = toISO(sundayOf(fromISO(e.date)));
    (byWeek[wk] ??= []).push(e);
  }
  const weekKeys = Object.keys(byWeek).sort().reverse().slice(0, 6);

  return (
    <div className="min-h-screen pb-16" style={{ background: C.paper, color: C.ink }}>
      <div className="max-w-md mx-auto px-4 pt-8 flex flex-col gap-4">

        {/* 표지 */}
        <header className="flex items-end justify-between px-1">
          <div>
            <div className="text-[10px] tracking-[0.3em] font-semibold" style={{ color: C.sub }}>개인 원장 · 단위: 원</div>
            <h1 className="font-serif text-3xl mt-1">민준의 돈</h1>
            <div className="text-[11px] mt-1" style={{ color: C.sub }}>
              쓴 날 바로 적는다 — 통제는 숫자가 보이는 데서 시작
            </div>
          </div>
          <div
            className="text-center rounded-md px-3 py-2 select-none"
            style={{ border: `2px dashed ${C.red}`, color: C.red, transform: "rotate(-4deg)", background: "rgba(179,64,47,0.04)" }}
          >
            <div className="text-[9px] tracking-widest">다음 입금</div>
            {editPay ? (
              <>
                <input
                  autoFocus
                  type="number"
                  min={1}
                  max={31}
                  inputMode="numeric"
                  defaultValue={data.payday}
                  onChange={(e) => setPayInput(e.target.value)}
                  onBlur={commitPayday}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitPayday();
                    if (e.key === "Escape") setEditPay(false);
                  }}
                  className="font-mono text-2xl leading-none font-bold tabular-nums w-14 text-center rounded outline-none"
                  style={{ background: "#fff", border: `1px solid ${C.red}`, color: C.red }}
                />
                <div className="text-[10px] mt-0.5">며칠에 들어와요?</div>
              </>
            ) : (
              <button onClick={() => { setPayInput(String(data.payday)); setEditPay(true); }} title="눌러서 급여일 변경">
                <div className="font-mono text-2xl leading-none font-bold tabular-nums">D-{pay.days}</div>
                <div className="text-[10px] mt-0.5">{pay.label}</div>
              </button>
            )}
          </div>
        </header>

        {/* 이번 주 — 통제의 중심 */}
        <Card
          title="이번 주 (일요일 시작)"
          right={
            <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
              {[[true, "자동"], [false, "수동"]].map(([k, label]) => (
                <button key={label} onClick={() => up((d) => { d.autoBudget = k; if (k) d.budget = null; return d; })}
                  className="text-[10px] px-2 py-0.5"
                  style={{ background: data.autoBudget === k ? C.green : "#fff", color: data.autoBudget === k ? "#fff" : C.sub }}>
                  {label}
                </button>
              ))}
            </div>
          }
        >
          <div className="flex items-baseline justify-between">
            <div>
              <div className="text-[11px]" style={{ color: C.sub }}>남은 돈</div>
              <div className="font-mono tabular-nums text-4xl font-semibold" style={{ color: over ? C.red : C.green }}>
                {fmt(remaining)}
              </div>
            </div>
            <div className="text-right text-[12px] leading-5" style={{ color: C.sub }}>
              이번 주 씀 <span className="font-mono tabular-nums" style={{ color: C.ink }}>{fmt(weekSpent)}</span>
              <br />
              오늘 씀 <span className="font-mono tabular-nums" style={{ color: C.ink }}>{fmt(todaySpent)}</span>
              <br />
              {over
                ? <span style={{ color: C.red }}>{fmt(-remaining)} 초과</span>
                : <>남은 {daysLeftWeek}일 · 하루 <span className="font-mono tabular-nums" style={{ color: C.ink }}>{fmt(perDay)}</span>꼴</>}
            </div>
          </div>
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-2 text-[11px]" style={{ color: C.sub }}>
            <span>주간 예산</span>
            {data.autoBudget ? (
              <span className="font-mono tabular-nums" style={{ color: C.ink }}>{fmt(budget)}</span>
            ) : (
              <Amount value={data.weeklyBudget} onCommit={(n) => up((d) => { d.weeklyBudget = n; return d; })} />
            )}
            {data.autoBudget && data.budget && (
              <span className="font-mono tabular-nums">· {fmt(data.budget.balance)} ÷ {data.budget.weeks}주</span>
            )}
          </div>
          <div className="h-1 rounded-full mt-3 overflow-hidden" style={{ background: C.line }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, (weekSpent / Math.max(budget, 1)) * 100))}%`,
                background: over ? C.red : C.green,
              }}
            />
          </div>

          {/* 지출 / 수입 입력 */}
          <div className="flex rounded overflow-hidden w-fit mt-4" style={{ border: `1px solid ${C.line}` }}>
            {[["expense", "지출"], ["income", "수입"]].map(([k, label]) => (
              <button key={k} onClick={() => setEKind(k)} className="text-[11px] px-3 py-1"
                style={{ background: eKind === k ? (k === "income" ? C.green : C.ink) : "#fff", color: eKind === k ? "#fff" : C.sub }}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-2 rounded"
            style={eKind === "income" ? { background: "rgba(46,92,70,0.08)", padding: 8, margin: "8px -8px 0" } : undefined}>
            <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)}
              className="text-[11px] rounded px-1.5 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub }} />
            <input value={eAmt} onChange={(e) => setEAmt(e.target.value)} placeholder="금액(원)" inputMode="decimal"
              onKeyDown={(e) => e.key === "Enter" && addExpense()}
              className="w-24 text-sm font-mono rounded px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff" }} />
            <input value={eText} onChange={(e) => setEText(e.target.value)} placeholder={eKind === "income" ? "내용 (예: 월급)" : "내용 (예: 점심)"}
              onKeyDown={(e) => e.key === "Enter" && addExpense()}
              className="flex-1 min-w-[90px] text-sm rounded px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff" }} />
            {eKind === "income" ? (
              <select value={acctId} onChange={(e) => setEAcct(e.target.value)}
                className="text-[11px] rounded px-1.5 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.ink }}>
                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            ) : (
              <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                {[["week", "쓸돈"], ["box", "박스"]].map(([k, label]) => (
                  <button key={k} onClick={() => setESrc(k)}
                    className="text-[11px] px-2.5"
                    style={{
                      background: eSrc === k ? (k === "week" ? C.green : C.blue) : "#fff",
                      color: eSrc === k ? "#fff" : C.sub,
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <button onClick={addExpense} className="text-xs px-3 py-1.5 rounded text-white whitespace-nowrap" style={{ background: eKind === "income" ? C.green : C.ink }}>
              {eKind === "income" ? "수입 적기" : "적기"}
            </button>
          </div>
          <div className="text-[10px] mt-2" style={{ color: C.sub }}>
            {eKind === "income"
              ? "수입은 고른 계좌 잔액에 더해져요. 주간 '쓸돈' 합계에는 안 들어가요."
              : "'쓸돈'은 주간 예산에서 차감, '박스'는 세이프박스에서 차감 — 예산은 안 건드려요. 계좌 잔액은 자동으로 따라 움직여요."}
          </div>
        </Card>

        {/* 세이프박스 자유 풀 */}
        <Card title="세이프박스 — 자유 풀">
          <div className="flex items-baseline justify-between">
            <div className="font-mono tabular-nums text-3xl" style={{ color: C.blue }}>{fmt(boxTotal)}</div>
            <div className="text-[11px] text-right" style={{ color: C.sub }}>
              지금까지 씀 <span className="font-mono tabular-nums" style={{ color: C.ink }}>{fmt(boxUsed)}</span>
              {boxThisWeek > 0 && <><br />이번 주 <span className="font-mono tabular-nums" style={{ color: C.ink }}>{fmt(boxThisWeek)}</span></>}
            </div>
          </div>
          {showPull ? (
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <input value={pullAmt} onChange={(e) => setPullAmt(e.target.value)} placeholder="금액(원)" inputMode="decimal" autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") pullFromBox(); if (e.key === "Escape") { setShowPull(false); setPullAmt(""); } }}
                className="w-24 text-sm font-mono rounded px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.blue}`, background: "#fff" }} />
              <button onClick={pullFromBox} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: C.blue }}>옮기기</button>
              <button onClick={() => { setShowPull(false); setPullAmt(""); }} className="text-xs px-2 py-1.5 rounded" style={{ border: `1px solid ${C.line}`, color: C.sub }}>취소</button>
            </div>
          ) : (
            <button onClick={() => setShowPull(true)} className="mt-3 text-xs px-3 py-1.5 rounded w-full"
              style={{ border: `1px dashed ${C.blue}`, color: C.blue }}>
              박스에서 끌어오기
            </button>
          )}
          <div className="text-[10px] mt-2" style={{ color: C.sub }}>
            일정 없이 꺼내 쓰는 돈. 농구든 공연이든 위 입력에서 '박스'로 적으면 여기서 빠져나가요.
            {" "}끌어오면 쓸돈 계좌로 옮겨지고 이번 주 예산이 바로 다시 잡혀요.
          </div>
        </Card>

        {/* 가계부 */}
        <Card title="가계부">
          <div className="flex items-baseline justify-between pb-2 mb-1 text-[11px]" style={{ borderBottom: `1px solid ${C.line}`, color: C.sub }}>
            <span>이번 사이클 {md(cycleStart)} – {md(cycleLast)}</span>
            <span className="font-mono tabular-nums">
              쓸돈 <span style={{ color: C.ink }}>{fmt(cycleWeek)}</span> · 박스 <span style={{ color: C.blue }}>{fmt(cycleBox)}</span>
            </span>
          </div>
          {weekKeys.length === 0 && (
            <div className="text-xs py-2" style={{ color: C.sub }}>
              아직 기록이 없어요. 첫 지출부터 적으면 주 단위로 자동 정리돼요.
            </div>
          )}
          {weekKeys.map((wk) => {
            const wkStart = fromISO(wk);
            const wkEnd = new Date(wkStart); wkEnd.setDate(wkEnd.getDate() + 6);
            const list = byWeek[wk];
            const wWeek = list.filter((e) => e.src === "week").reduce((s, e) => s + e.amount, 0);
            const wBox = list.filter((e) => e.src === "box").reduce((s, e) => s + e.amount, 0);
            const dates = [...new Set(list.map((e) => e.date))].sort().reverse();
            return (
              <div key={wk} className="mb-3">
                <div className="flex items-baseline justify-between py-1.5" style={{ borderBottom: `1.5px solid ${C.ink}` }}>
                  <span className="text-[11px] font-semibold tracking-wide">{md(wkStart)} – {md(wkEnd)}</span>
                  <span className="text-[11px] font-mono tabular-nums" style={{ color: C.sub }}>
                    쓸돈 <span style={{ color: wk === thisWeekKey && over ? C.red : C.ink }}>{fmt(wWeek)}</span> / {fmt(budget)}
                    {wBox > 0 && <span style={{ color: C.blue }}> · 박스 {fmt(wBox)}</span>}
                  </span>
                </div>
                {dates.map((dt) => {
                  const dayList = list.filter((e) => e.date === dt);
                  const dSum = dayList.filter(isExpense).reduce((s, e) => s + e.amount, 0);
                  return (
                    <div key={dt}>
                      <div className="flex justify-between pt-2 pb-1 text-[10px]" style={{ color: C.sub }}>
                        <span>{dayLabel(dt)}</span>
                        <span className="font-mono tabular-nums">{fmt(dSum)}</span>
                      </div>
                      {dayList.map((e) =>
                        expEdit && expEdit.id === e.id ? (
                          <div key={e.id} className="flex flex-wrap items-center gap-2 py-2" style={{ borderTop: `1px dotted ${C.line}` }}>
                            <input type="date" value={expEdit.date} onChange={(ev) => setExpEdit({ ...expEdit, date: ev.target.value })}
                              className="text-[11px] rounded px-1.5 py-1 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub }} />
                            <input value={expEdit.amt} onChange={(ev) => setExpEdit({ ...expEdit, amt: ev.target.value })} placeholder="금액(원)" inputMode="decimal" autoFocus
                              onKeyDown={(ev) => { if (ev.key === "Enter") saveExpEdit(); if (ev.key === "Escape") setExpEdit(null); }}
                              className="w-24 text-sm font-mono rounded px-2 py-1 outline-none" style={{ border: `1px solid ${C.green}`, background: "#fff" }} />
                            <input value={expEdit.text} onChange={(ev) => setExpEdit({ ...expEdit, text: ev.target.value })}
                              onKeyDown={(ev) => { if (ev.key === "Enter") saveExpEdit(); if (ev.key === "Escape") setExpEdit(null); }}
                              className="flex-1 min-w-[80px] text-sm rounded px-2 py-1 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff" }} />
                            {expEdit.kind === "income" ? (
                              <select value={expEdit.acct} onChange={(ev) => setExpEdit({ ...expEdit, acct: ev.target.value })}
                                className="text-[11px] rounded px-1.5 py-1 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.ink }}>
                                {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </select>
                            ) : (
                              <div className="flex rounded overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                                {[["week", "쓸돈"], ["box", "박스"]].map(([k, label]) => (
                                  <button key={k} onClick={() => setExpEdit({ ...expEdit, src: k })}
                                    className="text-[11px] px-2 py-1"
                                    style={{ background: expEdit.src === k ? (k === "week" ? C.green : C.blue) : "#fff", color: expEdit.src === k ? "#fff" : C.sub }}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button onClick={saveExpEdit} className="text-xs px-2.5 py-1 rounded text-white" style={{ background: C.green }}>저장</button>
                            <button onClick={() => setExpEdit(null)} className="text-xs px-2 py-1 rounded" style={{ border: `1px solid ${C.line}`, color: C.sub }}>취소</button>
                          </div>
                        ) : (
                          <div key={e.id} onClick={() => e.kind !== "transfer" && startExpEdit(e)}
                            title={e.kind === "transfer" ? "계좌 간 이체" : "눌러서 수정"}
                            className={`flex items-center gap-2 py-1.5 text-sm ${e.kind === "transfer" ? "" : "cursor-pointer"}`}
                            style={{ borderTop: `1px dotted ${C.line}` }}>
                            <span className="flex-1 min-w-0 truncate" style={{ color: e.kind === "transfer" ? C.sub : C.ink }}>{e.text}</span>
                            {e.kind === "income" ? (
                              <span className="text-[9px] px-1 rounded" style={{ background: "rgba(46,92,70,0.12)", color: C.green }}>{acctName(e.acct)}</span>
                            ) : e.kind === "transfer" ? (
                              <span className="text-[9px] px-1 rounded" style={{ background: "rgba(94,107,98,0.12)", color: C.sub }}>이체</span>
                            ) : e.src === "box" ? (
                              <span className="text-[9px] px-1 rounded" style={{ background: "rgba(76,101,128,0.12)", color: C.blue }}>박스</span>
                            ) : null}
                            <span className="font-mono tabular-nums"
                              style={{ color: e.kind === "income" ? C.green : e.kind === "transfer" ? C.sub : e.src === "box" ? C.blue : C.ink }}>
                              {e.kind === "income" ? "+" : e.kind === "transfer" ? "→" : "−"}{fmt(e.amount)}
                            </span>
                            <button onClick={(ev) => { ev.stopPropagation(); removeExpense(e.id); }} style={{ color: C.sub }}>×</button>
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </Card>

        {/* 모이는 돈 */}
        <Card title="모이는 돈">
          <div className="text-[11px]" style={{ color: C.sub }}>{curY}년 12월 말 예상 투자 원금</div>
          <div className="font-mono tabular-nums text-4xl font-semibold" style={{ color: C.green }}>{fmt(goalTotal)}</div>
          <div className="text-[10px] mt-1" style={{ color: C.sub }}>
            지금 투자 {fmt(investTotal)} + 월 적립 {fmt(data.goal.monthly)} × {monthsToDec}개월
            {plannedTotal > 0 && <> + 예정 수입 {fmt(plannedTotal)}</>}
          </div>

          <div className="flex items-center gap-1 mt-3 pt-3 text-[11px]" style={{ borderTop: `1px solid ${C.line}`, color: C.sub }}>
            월 적립액 <Amount value={data.goal.monthly} onCommit={(n) => up((d) => { d.goal.monthly = n; return d; })} />
          </div>

          <div className="mt-3">
            <div className="flex justify-between text-[10px] pb-1" style={{ color: C.sub, borderBottom: `1px solid ${C.ink}` }}>
              <span>월</span><span>누적</span>
            </div>
            {goalRows.map((r) => (
              <div key={r.key} className="flex justify-between py-1 text-[12px]" style={{ borderBottom: `1px dotted ${C.line}` }}>
                <span className="font-mono" style={{ color: C.sub }}>{r.label}</span>
                <span className="font-mono tabular-nums">{fmt(r.total)}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <div className="text-[11px] mb-1" style={{ color: C.sub }}>
              예정 수입{plannedTotal > 0 && <span className="font-mono tabular-nums"> · 합계 {fmt(plannedTotal)}</span>}
            </div>
            {data.planned.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1.5 text-sm" style={{ borderTop: `1px dotted ${C.line}` }}>
                <span className="flex-1 min-w-0 truncate">{p.memo}</span>
                <span className="font-mono tabular-nums" style={{ color: C.green }}>+{fmt(p.amount)}</span>
                <button onClick={() => up((d) => { d.planned = d.planned.filter((x) => x.id !== p.id); return d; })}
                  style={{ color: C.sub }}>×</button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 mt-2">
              <select value={pMonth} onChange={(e) => setPMonth(e.target.value)}
                className="text-[11px] rounded px-1.5 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff", color: pMonth ? C.ink : C.sub }}>
                <option value="">월</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
              </select>
              <input value={pAmt} onChange={(e) => setPAmt(e.target.value)} placeholder="금액(원)" inputMode="decimal"
                onKeyDown={(e) => e.key === "Enter" && addPlanned()}
                className="w-24 text-sm font-mono rounded px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff" }} />
              <input value={pMemo} onChange={(e) => setPMemo(e.target.value)} placeholder="메모"
                onKeyDown={(e) => e.key === "Enter" && addPlanned()}
                className="flex-1 min-w-[80px] text-sm rounded px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff" }} />
              <button onClick={addPlanned} className="text-xs px-3 py-1.5 rounded flex items-center gap-1"
                style={{ border: `1px dashed ${C.sub}`, color: C.sub }}>
                <Plus size={12} /> 추가
              </button>
            </div>
            <div className="text-[10px] mt-2" style={{ color: C.sub }}>
              실제로 들어오면 위 입력에서 '수입'으로 적고, 여기서는 지우세요.
            </div>
          </div>
        </Card>

        {/* 계좌 */}
        <Card
          title="계좌"
          right={<EditToggle on={editAcc} onClick={() => setEditAcc(!editAcc)} />}
        >
          {roleWarn && (
            <div className="text-[11px] mb-2 px-2 py-1.5 rounded leading-4" style={{ background: "rgba(179,64,47,0.07)", color: C.red }}>
              {roleWarn} — 지출이 잔액에 제대로 반영되려면 '쓸돈'·'모음' 역할이 하나씩 있어야 해요.
            </div>
          )}
          <div>
            {data.accounts.map((a, i) => (
              <div key={a.id} className="flex items-center gap-2 py-2.5" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
                <button
                  onClick={() => editAcc && up((d) => {
                    const t = d.accounts.find((x) => x.id === a.id);
                    t.role = ROLE_ORDER[(ROLE_ORDER.indexOf(t.role) + 1) % ROLE_ORDER.length];
                    return d;
                  })}
                  className="flex items-center gap-1 shrink-0 w-12"
                  title={editAcc ? "눌러서 역할 변경" : ROLES[a.role].label}
                >
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: ROLES[a.role].dot }} />
                  <span className="text-[10px]" style={{ color: C.sub }}>{ROLES[a.role].label}</span>
                </button>
                <div className="flex-1 min-w-0">
                  {editAcc ? (
                    <>
                      <input value={a.name} onChange={(e) => up((d) => { d.accounts.find((x) => x.id === a.id).name = e.target.value; return d; })}
                        className="w-full text-sm outline-none bg-transparent" style={{ borderBottom: `1px dotted ${C.sub}` }} />
                      <input value={a.note} placeholder="메모" onChange={(e) => up((d) => { d.accounts.find((x) => x.id === a.id).note = e.target.value; return d; })}
                        className="w-full text-[11px] outline-none bg-transparent mt-0.5" style={{ color: C.sub, borderBottom: `1px dotted ${C.line}` }} />
                    </>
                  ) : (
                    <>
                      <div className="text-sm truncate">{a.name}</div>
                      {a.note && <div className="text-[11px] truncate" style={{ color: C.sub }}>{a.note}</div>}
                    </>
                  )}
                </div>
                <Amount
                  value={bal(a)}
                  onCommit={(n) => up((d) => {
                    const t = d.accounts.find((x) => x.id === a.id);
                    t.baseAmount = n;
                    t.baseTs = Date.now(); // 여기서부터 다시 세기 시작
                    return d;
                  })}
                />
                {editAcc && (
                  <button onClick={() => up((d) => { d.accounts = d.accounts.filter((x) => x.id !== a.id); return d; })}
                    style={{ color: C.red }}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
          </div>
          {editAcc && (
            <button
              onClick={() => up((d) => { d.accounts.push({ id: uid(), name: "새 계좌", note: "", baseAmount: 0, baseTs: Date.now(), role: "hub" }); return d; })}
              className="w-full mt-1 py-2 rounded text-xs flex items-center justify-center gap-1"
              style={{ border: `1px dashed ${C.sub}`, color: C.sub }}
            >
              <Plus size={13} /> 계좌 추가
            </button>
          )}
          <div className="mt-3 pt-3 grid grid-cols-3 text-center" style={{ borderTop: `1.5px solid ${C.ink}` }}>
            {[["현금", cashTotal], ["투자 원금", investTotal], ["전체", cashTotal + investTotal]].map(([t, v]) => (
              <div key={t}>
                <div className="text-[10px]" style={{ color: C.sub }}>{t}</div>
                <div className="font-mono tabular-nums text-lg">{fmt(v)}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* 루틴 */}
        <Card title="이번 달 루틴">
          <textarea
            value={data.routine}
            onChange={(e) => up((d) => { d.routine = e.target.value; return d; })}
            rows={5}
            className="w-full text-sm leading-6 outline-none resize-none bg-transparent font-mono"
            style={{ color: C.ink }}
          />
        </Card>

        {/* 백업 / 이사 */}
        {showBackup && (
          <Card title="백업 / 이사">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={7}
              spellCheck={false}
              className="w-full text-[11px] leading-4 font-mono rounded p-2 outline-none resize-y"
              style={{ background: "#fff", border: `1px solid ${C.line}`, color: C.ink }}
            />
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setImportText(JSON.stringify(data, null, 2)); setBkMsg("현재 상태를 담았어요 — 전체 선택해서 복사해 보관하세요."); }}
                className="text-xs px-3 py-1.5 rounded" style={{ border: `1px solid ${C.line}`, color: C.ink }}>
                현재 상태 담기
              </button>
              <button
                onClick={() => {
                  try {
                    setData(normalize(JSON.parse(importText)));
                    setBkMsg("복원 완료 — 아래 데이터가 이 내용으로 바뀌었어요.");
                  } catch {
                    setBkMsg("JSON 형식이 아니에요. 백업 텍스트 전체를 그대로 붙여넣어 주세요.");
                  }
                }}
                className="text-xs px-3 py-1.5 rounded text-white" style={{ background: C.blue }}>
                이 내용으로 복원
              </button>
            </div>
            {bkMsg && <div className="text-[11px] mt-2" style={{ color: C.sub }}>{bkMsg}</div>}
            <div className="text-[10px] mt-2" style={{ color: C.sub }}>
              나만의 웹페이지로 이사할 때: 여기서 복사한 텍스트를 새 페이지의 '이 내용으로 복원'에 붙여넣으면 데이터가 그대로 넘어가요.
            </div>
          </Card>
        )}

        {/* 푸터 */}
        <footer className="flex items-center justify-between px-1 text-[11px]" style={{ color: C.sub }}>
          <span>{saveState || "적으면 자동 저장"}</span>
          <span className="flex items-center gap-3">
            <button onClick={() => { setShowBackup(!showBackup); if (!showBackup) { setImportText(JSON.stringify(data, null, 2)); setBkMsg(""); } }}>
              백업/이사
            </button>
            {confirmReset ? (
              <span className="flex gap-2">
                <button onClick={() => { setData(structuredClone(SEED)); setConfirmReset(false); }} style={{ color: C.red }}>정말 초기화</button>
                <button onClick={() => setConfirmReset(false)}>취소</button>
              </span>
            ) : (
              <button onClick={() => setConfirmReset(true)} className="flex items-center gap-1">
                <RotateCcw size={11} /> 초기화
              </button>
            )}
          </span>
        </footer>
      </div>
    </div>
  );
}
