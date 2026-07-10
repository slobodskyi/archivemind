import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";

export const metadata = { title: "Create account — ArchiveMind" };

export default function SignupPage() {
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
        <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 4, marginBottom: 22 }}>
          Create your workspace — team-ready from day one
        </div>
        <AuthForm mode="signup" />
        <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 18 }}>
          Already registered?{" "}
          <Link href="/login" style={{ color: "var(--ac)", textDecoration: "none" }}>
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
