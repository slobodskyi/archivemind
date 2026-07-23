"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

/** Set a new password after following a reset link. The /auth/callback exchange
 *  already established the (recovery) session, so updateUser() is authorized;
 *  the page server-guards for that session before rendering this form. */
export default function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those passwords don't match.");
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // Recovery session is now a full session — land in the workspace.
    window.location.assign("/");
  }

  return (
    <form onSubmit={submit} method="post" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={labelStyle}>
        NEW PASSWORD
        <input
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ ...inputStyle, marginTop: 5 }}
        />
      </label>
      <label style={labelStyle}>
        CONFIRM PASSWORD
        <input
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ ...inputStyle, marginTop: 5 }}
        />
      </label>
      <div style={{ fontSize: 10.5, color: "var(--t2b)", marginTop: -2 }}>At least 6 characters.</div>

      {error && <div style={{ fontSize: 11.5, color: "var(--red)", lineHeight: 1.5 }}>{error}</div>}

      <button
        type="submit"
        disabled={busy}
        style={{
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
        }}
      >
        {busy ? "SAVING…" : "SET NEW PASSWORD"}
      </button>
    </form>
  );
}
