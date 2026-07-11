import Link from "next/link";

/** App-level 404 — unmatched routes and `notFound()` land here instead of the
 *  bare runtime fallback. */

export default function NotFound() {
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "min(400px, calc(100vw - 48px))",
          background: "var(--bg-s)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          padding: "22px 24px",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--t1)" }}>
          404 — not found
        </div>
        <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.55, marginTop: 10 }}>
          This page doesn&apos;t exist — the link may be stale, or the project was deleted.
        </div>
        <div style={{ display: "flex", marginTop: 18 }}>
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              height: 32,
              padding: "0 14px",
              background: "var(--ac)",
              color: "#050505",
              borderRadius: 2,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              textDecoration: "none",
            }}
          >
            Back to projects
          </Link>
        </div>
      </div>
    </div>
  );
}
