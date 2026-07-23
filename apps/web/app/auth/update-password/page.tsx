import { redirect } from "next/navigation";
import UpdatePasswordForm from "@/components/auth/UpdatePasswordForm";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Set a new password — ArchiveMind" };

/** Landing page after a password-reset link: /auth/callback has exchanged the
 *  recovery code and established the session, so a real user arrives here
 *  authenticated. If there's no session (link expired mid-flow, or a direct
 *  hit), bounce to /login with a reason instead of showing a form that can't
 *  work. */
export default async function UpdatePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?auth_error=recovery_session_missing");

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: 340,
          background: "var(--bg-s)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          padding: "28px 26px",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", letterSpacing: "0.04em" }}>
          ArchiveMind
        </div>
        <div style={{ fontSize: 11, color: "var(--t2b)", marginTop: 4, marginBottom: 22 }}>
          Set a new password for your account
        </div>
        <UpdatePasswordForm />
      </div>
    </main>
  );
}
