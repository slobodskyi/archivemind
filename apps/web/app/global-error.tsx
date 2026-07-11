"use client";

/** Last-resort boundary: replaces the root layout when it (or the app shell)
 *  throws, so it must render its own <html>/<body> and cannot rely on
 *  globals.css or next/font — everything is inlined. */

export default function GlobalError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  unstable_retry?: () => void;
}) {
  const retry = unstable_retry ?? reset;

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          width: "100vw",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#080808",
          color: "#eceee8",
          fontFamily: "'Space Mono', ui-monospace, monospace",
        }}
      >
        <div
          style={{
            width: "min(440px, calc(100vw - 48px))",
            background: "#0b0b0b",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 2,
            padding: "22px 24px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            ArchiveMind hit an error
          </div>
          <div style={{ fontSize: 12, color: "rgba(236,238,232,0.62)", lineHeight: 1.55, marginTop: 10 }}>
            The app shell failed to render. Your files are safe — try again or reload the page.
          </div>
          {error?.digest && (
            <div style={{ fontSize: 10, color: "rgba(236,238,232,0.2)", marginTop: 8 }}>Error digest: {error.digest}</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            {retry && (
              <button
                onClick={() => retry()}
                style={{
                  height: 32,
                  padding: "0 14px",
                  background: "#39ff6a",
                  color: "#050505",
                  border: 0,
                  borderRadius: 2,
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Try again
              </button>
            )}
            {/* Deliberate hard <a>: the app shell just crashed, so a full
                document load is safer than the client router here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                display: "flex",
                alignItems: "center",
                height: 32,
                padding: "0 14px",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 2,
                color: "rgba(236,238,232,0.62)",
                fontSize: 12,
                textDecoration: "none",
              }}
            >
              Back to projects
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
