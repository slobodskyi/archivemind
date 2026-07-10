"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface AuthFormProps {
  mode: "login" | "signup";
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  background: "var(--bg-in)",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  color: "var(--t1)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

export default function AuthForm({ mode }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const supabase = createClient();

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      window.location.assign("/");
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    if (data.session) {
      // Email confirmations disabled (local dev) — signed in immediately.
      window.location.assign("/");
      return;
    }
    setInfo("Check your inbox — we sent a confirmation link.");
    setBusy(false);
  }

  return (
    // method="post": if the form is submitted before hydration, the native
    // fallback must never put credentials into the URL as a GET would.
    <form onSubmit={submit} method="post" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ fontSize: 10.5, color: "var(--t3)", letterSpacing: "0.08em" }}>
        EMAIL
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ ...inputStyle, marginTop: 5 }}
        />
      </label>
      <label style={{ fontSize: 10.5, color: "var(--t3)", letterSpacing: "0.08em" }}>
        PASSWORD
        <input
          type="password"
          required
          minLength={6}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...inputStyle, marginTop: 5 }}
        />
      </label>

      {error && (
        <div style={{ fontSize: 11.5, color: "var(--red)", lineHeight: 1.5 }}>{error}</div>
      )}
      {info && (
        <div style={{ fontSize: 11.5, color: "var(--ac)", lineHeight: 1.5 }}>{info}</div>
      )}

      <button
        type="submit"
        disabled={busy}
        style={{
          marginTop: 4,
          padding: "11px 12px",
          background: busy ? "var(--bg-el)" : "var(--ac)",
          color: busy ? "var(--t3)" : "#050505",
          border: 0,
          borderRadius: 2,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          cursor: busy ? "default" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {busy ? "…" : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
      </button>
    </form>
  );
}
