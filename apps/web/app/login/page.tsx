import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";

export const metadata = { title: "Sign in — ArchiveMind" };

export default function LoginPage() {
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
          Sign in to your workspace
        </div>
        <AuthForm mode="login" />
        <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 18 }}>
          No account?{" "}
          <Link href="/signup" style={{ color: "var(--ac)", textDecoration: "none" }}>
            Create one
          </Link>
        </div>
      </div>
    </main>
  );
}
