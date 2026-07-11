"use client";

import Link from "next/link";
import { useEffect } from "react";

/** Route error boundary. Without this file a render/navigation error makes the
 *  Next runtime hard-reload the document in a loop ("missing required error
 *  components") — observed live during the 2026-07-11 frontend audit.
 *  Next 16 passes `unstable_retry` (re-fetch + re-render); `reset` is the
 *  older clear-and-rerender fallback. */

export default function RouteError({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  unstable_retry?: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const retry = unstable_retry ?? reset;

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
          width: "min(440px, calc(100vw - 48px))",
          background: "var(--bg-s)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          padding: "22px 24px",
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--t1)" }}>
          Something went wrong
        </div>
        <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.55, marginTop: 10 }}>
          The page failed to load. Your files are safe — try again, or head back to your projects.
        </div>
        {error.digest && (
          <div style={{ fontSize: 10, color: "var(--tm)", marginTop: 8, letterSpacing: "0.04em" }}>
            Error digest: {error.digest}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          {retry && (
            <button
              onClick={() => retry()}
              style={{
                height: 32,
                padding: "0 14px",
                background: "var(--ac)",
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
          <Link
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              height: 32,
              padding: "0 14px",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              color: "var(--t2)",
              fontSize: 12,
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
