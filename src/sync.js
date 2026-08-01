import { supabase } from "./supabase";

/* ── 로컬 구조 ↔ 테이블 행 매핑 ─────────────────────────
   from/to 는 SQL 예약어라 서버에서는 from_account/to_account 를 쓴다.
   updated_at 은 절대 보내지 않는다 — 트리거의 now() 만 기준으로 삼는다. */

const accToRow = (a, uid) => ({
  id: a.id, user_id: uid, name: a.name, note: a.note ?? "", role: a.role,
  base_amount: Math.round(a.baseAmount) || 0, base_ts: Math.round(a.baseTs) || 0,
});
const rowToAcc = (r) => ({
  id: r.id, name: r.name ?? "계좌", note: r.note ?? "", role: r.role ?? "hub",
  baseAmount: Number(r.base_amount) || 0, baseTs: Number(r.base_ts) || 0,
});

const entToRow = (e, uid) => ({
  id: e.id, user_id: uid, ts: Math.round(e.ts) || 0, date: e.date, type: e.type,
  amount: Math.round(e.amount) || 0, text: e.text ?? "",
  from_account: e.from ?? null, to_account: e.to ?? null,
  auto: !!e.auto, rule_id: e.ruleId ?? null, saved_from: !!e.savedFrom,
});
const rowToEnt = (r) => ({
  id: r.id, ts: Number(r.ts) || 0, date: r.date, type: r.type,
  amount: Number(r.amount) || 0, text: r.text ?? "",
  from: r.from_account ?? null, to: r.to_account ?? null,
  auto: !!r.auto, ruleId: r.rule_id ?? null, savedFrom: !!r.saved_from,
});

const ruleToRow = (r, uid) => ({
  id: r.id, user_id: uid, name: r.name, amount: Math.round(r.amount) || 0, type: r.type,
  from_account: r.from ?? null, to_account: r.to ?? null,
  freq: r.freq, start_date: r.startDate, active: !!r.active,
});
const rowToRule = (r) => ({
  id: r.id, name: r.name ?? "고정 항목", amount: Number(r.amount) || 0, type: r.type ?? "expense",
  from: r.from_account ?? null, to: r.to_account ?? null,
  freq: r.freq ?? { kind: "monthly", day: 1 }, startDate: r.start_date, active: r.active !== false,
});

const setToRow = (d, uid) => ({
  user_id: uid, payday: d.payday, week_start: d.weekStart,
  save_goal: Math.round(d.saveGoal) || 0, goal_monthly: Math.round(d.goal?.monthly) || 0,
  auto_run_date: d.autoRunDate || null, last_auto: d.lastAuto ?? null,
  menus: d.menus ?? [], planned: d.planned ?? [], routine: d.routine ?? "",
});

const TABLES = [
  { key: "accounts", table: "accounts", toRow: accToRow, toLocal: rowToAcc },
  { key: "entries", table: "entries", toRow: entToRow, toLocal: rowToEnt },
  { key: "rules", table: "rules", toRow: ruleToRow, toLocal: rowToRule },
];

/* ── 마지막으로 서버와 맞춘 상태 — 무엇이 바뀌었는지 알아내는 기준 ── */
const SNAP_KEY = "minjun-money-synced";
const loadSnap = () => {
  try {
    return JSON.parse(localStorage.getItem(SNAP_KEY)) ?? null;
  } catch {
    return null;
  }
};
export const saveSnap = (d) => {
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(d));
  } catch { /* 저장 실패해도 다음 동기화 때 다시 계산된다 */ }
};
export const clearSnap = () => localStorage.removeItem(SNAP_KEY);

const byId = (arr) => new Map((arr ?? []).map((x) => [x.id, x]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* 스냅샷과 견줘 올릴 것(변경·추가)과 지울 것을 뽑는다 */
export function computeChanges(cur) {
  const snap = loadSnap();
  const out = { settings: false };
  for (const { key } of TABLES) {
    const now = byId(cur[key]);
    const before = byId(snap?.[key]);
    const up = [];
    const del = [];
    for (const [id, rec] of now) if (!before.has(id) || !same(before.get(id), rec)) up.push(rec);
    for (const id of before.keys()) if (!now.has(id)) del.push(id);
    out[key] = { up, del };
  }
  const s = (d) => (d ? setToRow(d, "x") : null);
  out.settings = !snap || !same(s(snap), s(cur));
  return out;
}

export const hasChanges = (c) =>
  c.settings || TABLES.some(({ key }) => c[key].up.length > 0 || c[key].del.length > 0);

/* ── 서버로 보내기 ───────────────────────────────────── */
export async function push(uid, data) {
  const ch = computeChanges(data);
  if (!hasChanges(ch)) return { ok: true, skipped: true };

  for (const { key, table, toRow } of TABLES) {
    const { up, del } = ch[key];
    if (up.length) {
      const { error } = await supabase.from(table).upsert(up.map((r) => toRow(r, uid)), { onConflict: "user_id,id" });
      if (error) throw error;
    }
    // 물리 삭제 대신 표식만 남긴다 — 다른 기기가 이 삭제를 알아볼 수 있게
    if (del.length) {
      const { error } = await supabase
        .from(table)
        .update({ deleted_at: new Date().toISOString() })
        .eq("user_id", uid)
        .in("id", del);
      if (error) throw error;
    }
  }
  if (ch.settings) {
    const { error } = await supabase.from("settings").upsert(setToRow(data, uid), { onConflict: "user_id" });
    if (error) throw error;
  }
  saveSnap(data);
  return { ok: true };
}

/* ── 서버에서 가져와 로컬과 합치기 ───────────────────────
   서버가 기준이되, 아직 올라가지 않은 로컬 편집은 지킨다.
   deleted_at 이 찍힌 행은 로컬에서도 지우고 다시 올리지 않는다. */
export async function pullMerge(uid, local) {
  const snap = loadSnap();
  const merged = structuredClone(local);
  let serverEmpty = true;

  for (const { key, table, toLocal } of TABLES) {
    const { data: rows, error } = await supabase.from(table).select("*").eq("user_id", uid);
    if (error) throw error;
    if (rows.length) serverEmpty = false;

    const tomb = new Set(rows.filter((r) => r.deleted_at).map((r) => r.id));
    const out = new Map(rows.filter((r) => !r.deleted_at).map((r) => [r.id, toLocal(r)]));
    const before = byId(snap?.[key]);

    for (const rec of local[key] ?? []) {
      if (tomb.has(rec.id)) continue; // 서버에서 지운 것은 되살리지 않는다
      const wasSynced = before.get(rec.id);
      if (wasSynced === undefined || !same(wasSynced, rec)) out.set(rec.id, rec); // 미전송 로컬 편집 우선
    }
    merged[key] = [...out.values()];
  }

  const { data: srow, error: serr } = await supabase.from("settings").select("*").eq("user_id", uid).maybeSingle();
  if (serr) throw serr;
  if (srow) {
    serverEmpty = false;
    const localChanged = snap && !same(setToRow(snap, "x"), setToRow(local, "x"));
    if (!localChanged) {
      merged.payday = srow.payday ?? merged.payday;
      merged.weekStart = srow.week_start === 1 ? 1 : 0;
      merged.saveGoal = Number(srow.save_goal) || 0;
      merged.goal = { monthly: Number(srow.goal_monthly) || 0 };
      merged.autoRunDate = srow.auto_run_date ?? null;
      merged.lastAuto = srow.last_auto ?? null;
      merged.menus = Array.isArray(srow.menus) ? srow.menus : [];
      merged.planned = Array.isArray(srow.planned) ? srow.planned : [];
      merged.routine = srow.routine ?? "";
    }
  }
  return { merged, serverEmpty };
}

/* 최초 로그인 때 이 기기 데이터를 통째로 올린다 */
export async function uploadAll(uid, data) {
  clearSnap(); // 스냅샷을 비워 전체를 변경분으로 보게 한다
  return push(uid, data);
}

/* 계정에 올릴 만한 내용이 있는지 — 최초 안내를 띄울지 판단용 */
export const hasLocalContent = (d) =>
  (d.entries?.length ?? 0) > 0 ||
  (d.rules?.length ?? 0) > 0 ||
  (d.accounts ?? []).some((a) => a.baseAmount !== 0);
