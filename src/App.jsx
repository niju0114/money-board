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

const KEY = "minjun-money-v1";

const SEED = {
  v: 3,
  payday: 25,
  weeklyBudget: 10,
  accounts: [
    { id: "a1", name: "주계좌", note: "수입이 들어오는 곳 · 고정비 대기", amount: 0, role: "hub" },
    { id: "a2", name: "세이프박스", note: "일정 없이 꺼내 쓰는 자유 풀", amount: 0, role: "save" },
    { id: "a3", name: "생활비 통장", note: "주간 예산이 나가는 곳", amount: 0, role: "spend" },
    { id: "a4", name: "투자 계좌", note: "원금 기록 — 자주 안 보기", amount: 0, role: "invest" },
  ],
  expenses: [],
  todos: [
    { id: "t1", text: "계좌 역할 정하고 현재 잔액 입력", done: false },
    { id: "t2", text: "자동이체 등록: 매주 월요일 생활비 통장으로 주간 예산", done: false },
    { id: "t3", text: "자동이체 등록: 월급일 다음날 투자 계좌로 적립", done: false },
    { id: "t4", text: "월 1회 점검 날짜 정하기", done: false },
  ],
  roadmap: [
    { id: "r1", when: "1개월", text: "시스템 가동 — 계좌 역할 정리, 주간 예산 시작", done: false },
    { id: "r2", when: "3개월", text: "자동이체 안착 — 손대지 않아도 돌아가는지 점검", done: false },
    { id: "r3", when: "6개월", text: "예산·저축 비율 중간 점검", done: false },
    { id: "r4", when: "1년", text: "연 결산 — 다음 해 구조 새로 설계", done: false },
  ],
  routine:
    "월급일: 수입 입금 확인\n다음날: 투자 계좌 자동이체\n매주 월요일: 생활비 통장으로 주간 예산 이체\n점검은 월 1회, 10분",
};

/* ── 헬퍼 ─────────────────────────────────────────── */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const parseNum = (s) => {
  const n = parseFloat(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
};
const fmt = (n) => {
  if (n == null) return "";
  const r = Math.round(n * 10) / 10;
  return r.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
};
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const toISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fromISO = (s) => {
  const [y, m, dd] = s.split("-").map(Number);
  return new Date(y, m - 1, dd);
};
const mondayOf = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
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
/* 어떤 버전의 저장본이 와도 v3 형태로 맞춰줌 */
const normalize = (p) => ({
  v: 3,
  payday: p.payday ?? 24,
  weeklyBudget: p.weeklyBudget ?? 11,
  accounts: Array.isArray(p.accounts) ? p.accounts : structuredClone(SEED.accounts),
  expenses: Array.isArray(p.expenses) ? p.expenses : [],
  todos: Array.isArray(p.todos) ? p.todos : structuredClone(SEED.todos),
  roadmap: Array.isArray(p.roadmap) ? p.roadmap : structuredClone(SEED.roadmap),
  routine: typeof p.routine === "string" ? p.routine : SEED.routine,
});

/* ── 소형 컴포넌트 ─────────────────────────────────── */
function Amount({ value, onCommit, big = false, color = C.ink }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  const commit = () => {
    const n = parseNum(v);
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
        className={`font-mono tabular-nums text-right rounded px-1 outline-none ${big ? "text-3xl w-32" : "text-base w-20"}`}
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
  const [editTodo, setEditTodo] = useState(false);
  const [editRoad, setEditRoad] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [importText, setImportText] = useState("");
  const [bkMsg, setBkMsg] = useState("");
  const [eAmt, setEAmt] = useState("");
  const [eText, setEText] = useState("");
  const [eDate, setEDate] = useState(toISO(new Date()));
  const [eSrc, setESrc] = useState("week");
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

  if (!data)
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: C.paper, color: C.sub }}>
        원장 펼치는 중…
      </div>
    );

  /* 파생값 */
  const todayISO = toISO(new Date());
  const thisWeekKey = toISO(mondayOf(new Date()));
  const inThisWeek = (iso) => toISO(mondayOf(fromISO(iso))) === thisWeekKey;

  const weekSpent = data.expenses.filter((e) => e.src === "week" && inThisWeek(e.date)).reduce((s, e) => s + e.amount, 0);
  const remaining = Math.round((data.weeklyBudget - weekSpent) * 10) / 10;
  const daysLeftWeek = 7 - ((new Date().getDay() + 6) % 7);
  const perDay = Math.max(remaining, 0) / daysLeftWeek;
  const todaySpent = data.expenses.filter((e) => e.date === todayISO).reduce((s, e) => s + e.amount, 0);

  const boxTotal = data.accounts.filter((a) => a.role === "save").reduce((s, a) => s + a.amount, 0);
  const boxUsed = data.expenses.filter((e) => e.src === "box").reduce((s, e) => s + e.amount, 0);
  const boxThisWeek = data.expenses.filter((e) => e.src === "box" && inThisWeek(e.date)).reduce((s, e) => s + e.amount, 0);

  const cashTotal = data.accounts.filter((a) => a.role !== "invest").reduce((s, a) => s + a.amount, 0);
  const investTotal = data.accounts.filter((a) => a.role === "invest").reduce((s, a) => s + a.amount, 0);

  const pay = paydayInfo(data.payday);
  const over = remaining < 0;

  const up = (fn) => setData((d) => fn(structuredClone(d)));

  const shiftBalance = (d, src, delta) => {
    const role = src === "week" ? "spend" : "save";
    const acc = d.accounts.find((a) => a.role === role);
    if (acc) acc.amount = Math.round((acc.amount + delta) * 10) / 10;
  };

  const addExpense = () => {
    const n = parseNum(eAmt);
    if (!n || n <= 0) return;
    const entry = { id: uid(), date: eDate || todayISO, text: eText.trim() || "지출", amount: n, src: eSrc };
    up((d) => {
      d.expenses.unshift(entry);
      d.expenses = d.expenses.slice(0, 400);
      shiftBalance(d, entry.src, -n);
      return d;
    });
    setEAmt(""); setEText("");
  };

  const removeExpense = (id) => {
    up((d) => {
      const e = d.expenses.find((x) => x.id === id);
      if (e) shiftBalance(d, e.src, e.amount);
      d.expenses = d.expenses.filter((x) => x.id !== id);
      return d;
    });
  };

  /* 가계부 그룹핑: 주 → 일 */
  const byWeek = {};
  for (const e of data.expenses) {
    const wk = toISO(mondayOf(fromISO(e.date)));
    (byWeek[wk] ??= []).push(e);
  }
  const weekKeys = Object.keys(byWeek).sort().reverse().slice(0, 6);

  return (
    <div className="min-h-screen pb-16" style={{ background: C.paper, color: C.ink }}>
      <div className="max-w-md mx-auto px-4 pt-8 flex flex-col gap-4">

        {/* 표지 */}
        <header className="flex items-end justify-between px-1">
          <div>
            <div className="text-[10px] tracking-[0.3em] font-semibold" style={{ color: C.sub }}>개인 원장 · 단위: 만원</div>
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
            <div className="font-mono text-2xl leading-none font-bold tabular-nums">D-{pay.days}</div>
            <div className="text-[10px] mt-0.5">{pay.label}</div>
          </div>
        </header>

        {/* 이번 주 — 통제의 중심 */}
        <Card
          title="이번 주 (월요일 시작)"
          right={
            <div className="text-[11px] flex items-center gap-1" style={{ color: C.sub }}>
              예산 <Amount value={data.weeklyBudget} onCommit={(n) => up((d) => { d.weeklyBudget = n; return d; })} />
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
          <div className="h-1 rounded-full mt-3 overflow-hidden" style={{ background: C.line }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, (weekSpent / Math.max(data.weeklyBudget, 0.1)) * 100))}%`,
                background: over ? C.red : C.green,
              }}
            />
          </div>

          {/* 지출 입력 */}
          <div className="flex flex-wrap gap-2 mt-4">
            <input type="date" value={eDate} onChange={(e) => setEDate(e.target.value)}
              className="text-[11px] rounded px-1.5 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff", color: C.sub }} />
            <input value={eAmt} onChange={(e) => setEAmt(e.target.value)} placeholder="금액" inputMode="decimal"
              onKeyDown={(e) => e.key === "Enter" && addExpense()}
              className="w-16 text-sm font-mono rounded px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff" }} />
            <input value={eText} onChange={(e) => setEText(e.target.value)} placeholder="내용 (예: 점심)"
              onKeyDown={(e) => e.key === "Enter" && addExpense()}
              className="flex-1 min-w-[90px] text-sm rounded px-2 py-1.5 outline-none" style={{ border: `1px solid ${C.line}`, background: "#fff" }} />
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
            <button onClick={addExpense} className="text-xs px-3 py-1.5 rounded text-white" style={{ background: C.ink }}>
              적기
            </button>
          </div>
          <div className="text-[10px] mt-2" style={{ color: C.sub }}>
            '쓸돈'은 주간 예산에서 차감, '박스'는 세이프박스에서 차감 — 예산은 안 건드려요. 계좌 잔액은 자동으로 따라 움직여요.
          </div>
        </Card>

        {/* 해야 할 일 */}
        <Card title="해야 할 일" right={<EditToggle on={editTodo} onClick={() => setEditTodo(!editTodo)} />}>
          {data.todos.map((t, i) => (
            <div key={t.id} className="flex items-start gap-2.5 py-2" style={{ borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>
              <button
                onClick={() => up((d) => { const x = d.todos.find((y) => y.id === t.id); x.done = !x.done; return d; })}
                className="w-4 h-4 rounded-full mt-0.5 shrink-0 flex items-center justify-center"
                style={{ border: `1.5px solid ${t.done ? C.green : C.sub}`, background: t.done ? C.green : "transparent" }}
              >
                {t.done && <Check size={10} color="#fff" />}
              </button>
              {editTodo ? (
                <input value={t.text}
                  onChange={(e) => up((d) => { d.todos.find((y) => y.id === t.id).text = e.target.value; return d; })}
                  className="flex-1 text-sm outline-none bg-transparent" style={{ borderBottom: `1px dotted ${C.sub}` }} />
              ) : (
                <span className="flex-1 text-sm leading-5"
                  style={{ color: t.done ? C.sub : C.ink, textDecoration: t.done ? "line-through" : "none" }}>
                  {t.text}
                </span>
              )}
              {editTodo && (
                <button onClick={() => up((d) => { d.todos = d.todos.filter((y) => y.id !== t.id); return d; })}
                  style={{ color: C.red }}><Trash2 size={14} /></button>
              )}
            </div>
          ))}
          {editTodo && (
            <button
              onClick={() => up((d) => { d.todos.push({ id: uid(), text: "새 할 일", done: false }); return d; })}
              className="w-full mt-1 py-2 rounded text-xs flex items-center justify-center gap-1"
              style={{ border: `1px dashed ${C.sub}`, color: C.sub }}
            >
              <Plus size={13} /> 할 일 추가
            </button>
          )}
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
          <div className="text-[10px] mt-2" style={{ color: C.sub }}>
            일정 없이 꺼내 쓰는 돈. 농구든 공연이든 위 입력에서 '박스'로 적으면 여기서 빠져나가요.
          </div>
        </Card>

        {/* 가계부 */}
        <Card title="가계부">
          {weekKeys.length === 0 && (
            <div className="text-xs py-2" style={{ color: C.sub }}>
              아직 기록이 없어요. 첫 지출부터 적으면 주 단위로 자동 정리돼요.
            </div>
          )}
          {weekKeys.map((wk) => {
            const mon = fromISO(wk);
            const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
            const list = byWeek[wk];
            const wWeek = list.filter((e) => e.src === "week").reduce((s, e) => s + e.amount, 0);
            const wBox = list.filter((e) => e.src === "box").reduce((s, e) => s + e.amount, 0);
            const dates = [...new Set(list.map((e) => e.date))].sort().reverse();
            return (
              <div key={wk} className="mb-3">
                <div className="flex items-baseline justify-between py-1.5" style={{ borderBottom: `1.5px solid ${C.ink}` }}>
                  <span className="text-[11px] font-semibold tracking-wide">{md(mon)} – {md(sun)}</span>
                  <span className="text-[11px] font-mono tabular-nums" style={{ color: C.sub }}>
                    쓸돈 <span style={{ color: wk === thisWeekKey && over ? C.red : C.ink }}>{fmt(wWeek)}</span> / {fmt(data.weeklyBudget)}
                    {wBox > 0 && <span style={{ color: C.blue }}> · 박스 {fmt(wBox)}</span>}
                  </span>
                </div>
                {dates.map((dt) => {
                  const dayList = list.filter((e) => e.date === dt);
                  const dSum = dayList.reduce((s, e) => s + e.amount, 0);
                  return (
                    <div key={dt}>
                      <div className="flex justify-between pt-2 pb-1 text-[10px]" style={{ color: C.sub }}>
                        <span>{dayLabel(dt)}</span>
                        <span className="font-mono tabular-nums">{fmt(dSum)}</span>
                      </div>
                      {dayList.map((e) => (
                        <div key={e.id} className="flex items-center gap-2 py-1.5 text-sm" style={{ borderTop: `1px dotted ${C.line}` }}>
                          <span className="flex-1 min-w-0 truncate">{e.text}</span>
                          {e.src === "box" && (
                            <span className="text-[9px] px-1 rounded" style={{ background: "rgba(76,101,128,0.12)", color: C.blue }}>박스</span>
                          )}
                          <span className="font-mono tabular-nums" style={{ color: e.src === "box" ? C.blue : C.ink }}>−{fmt(e.amount)}</span>
                          <button onClick={() => removeExpense(e.id)} style={{ color: C.sub }}>×</button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </Card>

        {/* 로드맵 */}
        <Card title="로드맵" right={<EditToggle on={editRoad} onClick={() => setEditRoad(!editRoad)} />}>
          <div className="ml-1.5" style={{ borderLeft: `2px solid ${C.line}` }}>
            {data.roadmap.map((r) => (
              <div key={r.id} className="relative pl-4 pb-4">
                <button
                  onClick={() => up((d) => { const x = d.roadmap.find((y) => y.id === r.id); x.done = !x.done; return d; })}
                  className="rounded-full"
                  style={{
                    position: "absolute", left: -7, top: 3, width: 12, height: 12,
                    border: `2px solid ${r.done ? C.green : C.sub}`,
                    background: r.done ? C.green : C.card,
                  }}
                  title="누르면 완료 표시"
                />
                {editRoad ? (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <input value={r.when}
                        onChange={(e) => up((d) => { d.roadmap.find((y) => y.id === r.id).when = e.target.value; return d; })}
                        className="w-20 text-[11px] font-mono outline-none bg-transparent" style={{ borderBottom: `1px dotted ${C.sub}` }} />
                      <button onClick={() => up((d) => { d.roadmap = d.roadmap.filter((y) => y.id !== r.id); return d; })}
                        style={{ color: C.red }}><Trash2 size={13} /></button>
                    </div>
                    <input value={r.text}
                      onChange={(e) => up((d) => { d.roadmap.find((y) => y.id === r.id).text = e.target.value; return d; })}
                      className="w-full text-sm outline-none bg-transparent" style={{ borderBottom: `1px dotted ${C.line}` }} />
                  </div>
                ) : (
                  <>
                    <div className="text-[11px] font-mono font-semibold" style={{ color: r.done ? C.sub : C.green }}>{r.when}</div>
                    <div className="text-sm leading-5" style={{ color: r.done ? C.sub : C.ink }}>{r.text}</div>
                  </>
                )}
              </div>
            ))}
          </div>
          {editRoad && (
            <button
              onClick={() => up((d) => { d.roadmap.push({ id: uid(), when: "언제", text: "새 이정표", done: false }); return d; })}
              className="w-full mt-1 py-2 rounded text-xs flex items-center justify-center gap-1"
              style={{ border: `1px dashed ${C.sub}`, color: C.sub }}
            >
              <Plus size={13} /> 이정표 추가
            </button>
          )}
        </Card>

        {/* 계좌 */}
        <Card
          title="계좌"
          right={<EditToggle on={editAcc} onClick={() => setEditAcc(!editAcc)} />}
        >
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
                <Amount value={a.amount} onCommit={(n) => up((d) => { d.accounts.find((x) => x.id === a.id).amount = n; return d; })} />
                {editAcc && (
                  <button onClick={() => up((d) => { d.accounts = d.accounts.filter((x) => x.id !== a.id); return d; })}
                    style={{ color: C.red }}><Trash2 size={15} /></button>
                )}
              </div>
            ))}
          </div>
          {editAcc && (
            <button
              onClick={() => up((d) => { d.accounts.push({ id: uid(), name: "새 계좌", note: "", amount: 0, role: "hub" }); return d; })}
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
