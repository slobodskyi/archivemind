/** Homepage skeleton — mirrors HomeClient's drawer-sidebar + card-grid layout
 *  so the shell appears the instant a navigation starts (this boundary is also
 *  what lets Next prefetch the route shell for `<Link>`s to `/`). */

function Sk({ w, h, style }: { w: number | string; h: number; style?: React.CSSProperties }) {
  return <div className="am-skeleton" style={{ width: w, height: h, ...style }} />;
}

export default function HomeLoading() {
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      <aside
        style={{
          width: 248,
          flex: "0 0 auto",
          height: "100%",
          background: "var(--bg-s)",
          borderRight: "1px solid var(--bd)",
          display: "flex",
          flexDirection: "column",
          padding: "18px 14px 14px",
        }}
      >
        <div style={{ padding: "0 8px 18px" }}>
          <Sk w={112} h={15} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Sk w="100%" h={33} />
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ borderTop: "1px solid var(--bd)", paddingTop: 12, display: "flex", alignItems: "center", gap: 9 }}>
          <Sk w={32} h={32} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
            <Sk w={72} h={11} />
            <Sk w={128} h={9} />
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, height: "100%", overflow: "hidden", padding: "26px 30px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <Sk w={118} h={22} />
          <Sk w={124} h={32} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ border: "1px solid var(--bd)", borderRadius: 3, overflow: "hidden", background: "var(--bg-s)" }}>
              <Sk w="100%" h={122} style={{ borderRadius: 0 }} />
              <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                <Sk w="62%" h={13} />
                <Sk w={54} h={10} />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
