export default function UsagePill() {
  return (
    <div
      style={{
        position: "absolute",
        left: 74,
        bottom: 18,
        display: "flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 12px",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 999,
        color: "var(--text-secondary)",
        fontSize: 12,
        zIndex: 30,
      }}
    >
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <circle cx={12} cy={12} r={8} />
        <path d="M9 12h6" />
        <path d="M12 9v6" />
      </svg>
      12% used
    </div>
  );
}
