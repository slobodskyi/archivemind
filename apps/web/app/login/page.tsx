import Link from "next/link";
import AuthForm from "@/components/auth/AuthForm";
import { AUTH_ERROR_PARAM, authErrorMessage } from "@/lib/auth-errors";

export const metadata = { title: "Sign in — ArchiveMind" };

/** A param can legally arrive repeated (`?x=a&x=b`); take the first and ignore
 *  the rest rather than rendering "a,b". */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // /auth/callback redirects here when a confirmation or OAuth sign-in fails.
  const params = await searchParams;
  const error = authErrorMessage(first(params[AUTH_ERROR_PARAM]));

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
        <AuthForm mode="login" initialError={error} />
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
