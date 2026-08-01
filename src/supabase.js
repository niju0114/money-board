import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* 환경변수가 없으면 서버 없이 로컬 전용으로 돈다 — 기존 동작 그대로 */
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true, // 돌아온 URL의 code를 알아서 세션으로 바꾼다
          flowType: "pkce",
        },
      })
    : null;

export const serverEnabled = !!supabase;

/* 로그인 후 돌아올 주소 — base('/money-board/')까지 포함해야 루트로 튕기지 않는다 */
export const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;

const hashParams = () => {
  const h = window.location.hash || "";
  return new URLSearchParams(h.startsWith("#") ? h.slice(1) : h);
};

/* 콜백으로 돌아온 URL에서 인증 결과를 읽는다 */
export const readAuthCallback = () => {
  const q = new URL(window.location.href).searchParams;
  const h = hashParams();
  return {
    code: q.get("code"),
    token: h.get("access_token"),
    error: q.get("error_description") || q.get("error") || h.get("error_description") || h.get("error") || "",
  };
};

/* 주소창에 남은 인증 파라미터를 지운다 — 새로고침 때 재사용돼 실패하는 걸 막는다 */
export const cleanAuthParams = () => {
  const u = new URL(window.location.href);
  let touched = false;
  for (const k of ["code", "state", "error", "error_code", "error_description"]) {
    if (u.searchParams.has(k)) { u.searchParams.delete(k); touched = true; }
  }
  if (u.hash && /access_token|refresh_token|error/.test(u.hash)) { u.hash = ""; touched = true; }
  if (touched) window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
};
