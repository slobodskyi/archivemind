"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface AuthFormProps {
  mode: "login" | "signup";
  /** Failure carried over from /auth/callback, already resolved to display copy
   *  by the server. Seeds the same red line a submit failure uses, so retrying
   *  clears it. */
  initialError?: string | null;
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

const labelStyle: React.CSSProperties = { fontSize: 10.5, color: "var(--t2b)", letterSpacing: "0.08em" };
const linkBtn: React.CSSProperties = {
  alignSelf: "flex-start",
  marginTop: 14,
  padding: 0,
  background: "transparent",
  border: 0,
  color: "var(--t2b)",
  fontSize: 11,
  fontFamily: "inherit",
  cursor: "pointer",
};

function primaryBtnStyle(busy: boolean): React.CSSProperties {
  return {
    marginTop: 4,
    padding: "11px 12px",
    background: busy ? "var(--bg-el)" : "var(--ac)",
    color: busy ? "var(--t2b)" : "#050505",
    border: 0,
    borderRadius: 2,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    cursor: busy ? "default" : "pointer",
    fontFamily: "inherit",
  };
}

/** Official four-colour Google "G". Google's branding guidelines require the
 *  mark on any "Sign in with Google" affordance, so it stays coloured even
 *  though the rest of the surface is monochrome. */
function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

export default function AuthForm({ mode, initialError = null }: AuthFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Within login mode, a lightweight "forgot password" sub-view (email-only).
  const [view, setView] = useState<"auth" | "reset">("auth");

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

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    const supabase = createClient();
    // Reuse the hardened callback: it exchanges the recovery code, then
    // forwards to /auth/update-password (validated by safeNextUrl). The
    // Supabase project's Redirect URLs must allow this callback URL.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // Don't confirm the address exists (account enumeration) — neutral copy.
    setInfo("If that email has an account, a password-reset link is on its way. Check your inbox.");
    setBusy(false);
  }

  async function signInWithGoogle() {
    setError(null);
    setInfo(null);
    setBusy(true);
    const supabase = createClient();

    // Origin-derived (never a build-time constant) so Vercel previews hand back
    // their own host — Supabase's redirect allow-list is what gates it.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    // On success the browser is already navigating to Google; leave `busy` set
    // so the buttons stay disabled until the page unloads.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  if (view === "reset") {
    return (
      <form onSubmit={sendReset} method="post" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.5, marginBottom: 2 }}>
          Enter your account email and we&apos;ll send a link to set a new password.
        </div>
        <label style={labelStyle}>
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

        {error && <div style={{ fontSize: 11.5, color: "var(--red)", lineHeight: 1.5 }}>{error}</div>}
        {info && <div style={{ fontSize: 11.5, color: "var(--ac)", lineHeight: 1.5 }}>{info}</div>}

        <button type="submit" disabled={busy} style={primaryBtnStyle(busy)}>
          {busy ? "SENDING…" : "SEND RESET LINK"}
        </button>
        <button
          type="button"
          onClick={() => {
            setView("auth");
            setError(null);
            setInfo(null);
          }}
          style={linkBtn}
        >
          ← Back to sign in
        </button>
      </form>
    );
  }

  return (
    <>
      {/* method="post": if the form is submitted before hydration, the native
          fallback must never put credentials into the URL as a GET would. */}
      <form onSubmit={submit} method="post" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={labelStyle}>
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
        <label style={labelStyle}>
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
        {mode === "signup" && (
          <div style={{ fontSize: 10.5, color: "var(--t2b)", marginTop: -2 }}>At least 6 characters.</div>
        )}

        {error && (
          <div style={{ fontSize: 11.5, color: "var(--red)", lineHeight: 1.5 }}>{error}</div>
        )}
        {info && (
          <div style={{ fontSize: 11.5, color: "var(--ac)", lineHeight: 1.5 }}>{info}</div>
        )}

        <button type="submit" disabled={busy} style={primaryBtnStyle(busy)}>
          {busy ? (mode === "login" ? "SIGNING IN…" : "CREATING ACCOUNT…") : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}
        </button>
        {mode === "login" && (
          <button
            type="button"
            onClick={() => {
              setView("reset");
              setError(null);
              setInfo(null);
            }}
            style={linkBtn}
          >
            Forgot password?
          </button>
        )}
      </form>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "14px 0" }}>
        <div style={{ flex: 1, height: 1, background: "var(--bd)" }} />
        <span style={{ fontSize: 10, color: "var(--t3)", letterSpacing: "0.08em" }}>OR</span>
        <div style={{ flex: 1, height: 1, background: "var(--bd)" }} />
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: "11px 12px",
          background: "var(--bg-in)",
          color: busy ? "var(--t3)" : "var(--t1)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.08em",
          cursor: busy ? "default" : "pointer",
          fontFamily: "inherit",
        }}
      >
        <GoogleMark />
        CONTINUE WITH GOOGLE
      </button>
    </>
  );
}
