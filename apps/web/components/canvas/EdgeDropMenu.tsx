import { POPOVER_SURFACE, Z } from "@/lib/ui";

interface EdgeDropMenuProps {
  /** Screen coords of the wire's release point; null = closed. */
  menu: { x: number; y: number } | null;
  onPick: (item: "sticky-note") => void;
  onClose: () => void;
}

/** What a wire dropped on empty canvas can become (ADR 0048). One item today;
 *  the list IS the extension point — an AI action or Create-from-thread is a
 *  new entry here plus a handler branch, not a new component. Nothing has been
 *  written when this opens, so dismissing it costs nothing. */
const ITEMS: { id: "sticky-note"; label: string; hint: string }[] = [
  { id: "sticky-note", label: "Sticky note", hint: "wired to this photo" },
];

export default function EdgeDropMenu({ menu, onPick, onClose }: EdgeDropMenuProps) {
  if (!menu) return null;
  const W = 200;
  const left = typeof window !== "undefined" ? Math.min(menu.x, window.innerWidth - W - 8) : menu.x;
  const top = typeof window !== "undefined" ? Math.min(menu.y, window.innerHeight - 80) : menu.y;

  return (
    <>
      <div
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
        style={{ position: "fixed", inset: 0, zIndex: Z.menuBackdrop }}
      />
      <div data-edge-port="" style={{ ...POPOVER_SURFACE, position: "fixed", left, top, width: W, padding: 6 }}>
        {ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onPick(item.id)}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              width: "100%",
              padding: "8px 10px",
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              fontFamily: "inherit",
              color: "var(--t2)",
              fontSize: 12.5,
              background: "transparent",
              textAlign: "left",
            }}
          >
            <span style={{ color: "var(--t1)" }}>{item.label}</span>
            <span style={{ color: "var(--t3)", fontSize: 10 }}>{item.hint}</span>
          </button>
        ))}
      </div>
    </>
  );
}
