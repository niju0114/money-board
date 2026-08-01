import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* 환경변수가 없으면 서버 없이 로컬 전용으로 돈다 — 기존 동작 그대로 */
export const supabase =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;

export const serverEnabled = !!supabase;

/* 로그인 후 돌아올 주소 — GitHub Pages의 base 경로까지 포함해야 한다 */
export const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}`;
