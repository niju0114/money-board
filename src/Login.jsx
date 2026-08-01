import { useState } from "react";
import { supabase, redirectTo } from "./supabase";

const C = {
  bg: "var(--bg)", card: "var(--card)", text: "var(--text)",
  sub: "var(--sub)", line: "var(--line)", field: "var(--field)", accent: "var(--accent)",
};

export default function Login({ error = "" }) {
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = msg || error; // 콜백에서 돌아온 실패 사유도 그대로 보여준다

  const google = async () => {
    setBusy(true);
    setMsg("");
    try {
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (e) { setMsg(e.message); setBusy(false); }
    } catch (e) {
      setMsg(String(e?.message ?? e));
      setBusy(false);
    }
  };

  const magic = async () => {
    if (!email.trim()) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    });
    setBusy(false);
    setMsg(error ? error.message : "메일로 로그인 링크를 보냈어요. 같은 기기에서 열어주세요.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: C.bg, color: C.text }}>
      <div className="w-full max-w-sm">
        <h1 className="text-[28px] font-semibold tracking-tight">민준의 돈</h1>
        <p className="text-[15px] mt-1" style={{ color: C.sub }}>로그인하면 기기가 바뀌어도 기록이 따라와요.</p>

        <div className="rounded-2xl mt-6 px-4 py-2" style={{ background: C.card }}>
          <button onClick={google} disabled={busy}
            className="w-full text-[15px] py-3 font-medium text-left"
            style={{ color: C.accent }}>
            구글로 계속하기
          </button>
          <div className="py-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <input
              id="login-email" name="email"
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && magic()}
              placeholder="이메일 주소" autoComplete="email"
              className="w-full text-[15px] rounded-[10px] px-2.5 py-2 outline-none border-0"
              style={{ background: C.field }}
            />
            <button onClick={magic} disabled={busy || !email.trim()}
              className="w-full text-[15px] py-2.5 mt-2 rounded-[10px] font-medium"
              style={{ background: C.accent, color: "#fff", opacity: busy || !email.trim() ? 0.5 : 1 }}>
              로그인 링크 받기
            </button>
          </div>
        </div>

        {shown && (
          <p className="text-[13px] mt-3 px-1 leading-5" style={{ color: error && !msg ? "var(--danger)" : C.sub }}>
            {shown}
          </p>
        )}
        <p className="text-[12px] mt-4 px-1" style={{ color: C.sub }}>
          돌아올 주소: {redirectTo}
        </p>
      </div>
    </div>
  );
}
