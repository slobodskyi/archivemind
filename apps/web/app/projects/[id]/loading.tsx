/** Canvas skeleton — header bar + toolbar strip + a quiet loading label, so
 *  opening a project responds instantly while the server assembles assets and
 *  presigned previews. Adding this boundary also lets `<Link>`s to projects
 *  prefetch the route shell. */

function Sk({ w, h, style }: { w: number | string; h: number; style?: React.CSSProperties }) {
  return <div className="am-skeleton" style={{ width: w, height: h, ...style }} />;
}

export default function ProjectLoading() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "var(--bg)", position: "relative" }}>
      {/* header shell (real AppHeader is 52px, bottom-bordered) */}
      <div
        style={{
          height: 52,
          borderBottom: "1px solid var(--bd)",
          background: "var(--bg-nb)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Sk w={26} h={26} />
          <Sk w={132} h={13} />
          <Sk w={88} h={13} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Sk w={180} h={26} />
          <Sk w={70} h={26} />
          <Sk w={26} h={26} />
        </div>
      </div>

      {/* left toolbar strip */}
      <div
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Sk key={i} w={34} h={34} />
        ))}
      </div>

      {/* quiet center label */}
      <div
        style={{
          position: "absolute",
          inset: "52px 0 0 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--t3)",
            animation: "amPulse 1.4s ease-in-out infinite",
          }}
        >
          Loading archive
        </div>
      </div>
    </div>
  );
}
