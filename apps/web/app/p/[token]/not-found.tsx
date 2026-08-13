export default function PublicShareNotFound() {
  return (
    <main className="public-share-scroll-root">
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <section
          style={{
            width: "min(430px, 100%)",
            padding: "26px 28px",
            border: "1px solid var(--bdh)",
            borderRadius: 2,
            background: "var(--bg-s)",
          }}
        >
          <div style={{ color: "var(--t3)", fontSize: 9.5, fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase" }}>
            ArchiveMind · shared preview
          </div>
          <h1 style={{ margin: "15px 0 0", fontFamily: '"Inter Tight Variable", system-ui, sans-serif', fontSize: 34, lineHeight: 1.05 }}>
            Preview unavailable
          </h1>
          <p style={{ margin: "14px 0 0", color: "var(--t2)", fontFamily: '"Inter Tight Variable", system-ui, sans-serif', fontSize: 16, lineHeight: 1.55 }}>
            This link may have expired or been turned off. Ask the person who shared it for a new preview link.
          </p>
        </section>
      </div>
    </main>
  );
}
