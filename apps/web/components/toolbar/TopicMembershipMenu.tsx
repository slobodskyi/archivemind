"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AddIcon, CheckIcon, TopicMoveIcon, TopicResetIcon } from "@/components/icons/icons";

/** One persisted Topic cloud that can accept a manual membership assignment.
 *
 * `id` is deliberately the stable row id, never the display label: a rename
 * must not invalidate either the current marker or the move target. Heuristic
 * clouds without a stable id should not be offered by the caller. */
export interface TopicMembershipTarget {
  id: string;
  label: string;
  /** Optional cloud colour, used only as a visual locator in the list. */
  color?: string;
  /** A user-created cloud rather than a k-means-generated one. */
  manual?: boolean;
  /** Its display label has been pinned by a person and survives re-cluster. */
  pinned?: boolean;
}

export interface TopicMembershipMenuProps {
  targets: readonly TopicMembershipTarget[];
  selectionCount: number;
  /** The shared effective topic of the selection; null means mixed/unknown. */
  currentTopicId?: string | null;
  /** True when at least one selected file has a manual assignment to remove. */
  canReturnToAi: boolean;
  /** A membership mutation is in flight. */
  busy?: boolean;
  onMove: (topicId: string) => void;
  onCreate: (name: string) => void;
  onReturnToAi: () => void;
}

const menuButtonStyle = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  border: 0,
  borderRadius: 2,
  fontFamily: "inherit",
} as const;

function TopicBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        flex: "0 0 auto",
        padding: "2px 4px",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        color: "var(--tm)",
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: ".06em",
        lineHeight: 1,
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

/** Explicit semantic Topic control. A deliberate dwell-and-drop onto a
 * highlighted cloud offers the direct gesture; this menu is the precise,
 * keyboard-friendly alternative and also owns create/reset. */
export default function TopicMembershipMenu({
  targets,
  selectionCount,
  currentTopicId = null,
  canReturnToAi,
  busy = false,
  onMove,
  onCreate,
  onReturnToAi,
}: TopicMembershipMenuProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;

    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
        setName("");
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setCreating(false);
      setName("");
    };

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setCreating(false);
    setName("");
  };

  const submitNewTopic = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    onCreate(trimmed);
    close();
  };

  const selectionLabel = selectionCount === 1 ? "1 file" : `${selectionCount} files`;

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex" }}>
      <button
        type="button"
        disabled={selectionCount === 0 || busy}
        onClick={() => setOpen((value) => !value)}
        aria-label={selectionCount > 0 ? `Change topic for ${selectionLabel}` : "Select files to change topic"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        className="am-tb"
        // Icon-only, a 34px square like every other control on these bars. It
        // used to be the one labelled button among icons, which made a menu that
        // is only reachable WITH a selection the loudest thing on an empty bar.
        title={selectionCount > 0 ? "Move to / create a topic" : "Select files to change topic"}
        style={{
          display: "flex",
          width: 34,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          border: 0,
          borderRadius: 2,
          cursor: selectionCount === 0 || busy ? "default" : "pointer",
          background: open ? "color-mix(in srgb,var(--ac) 12%,transparent)" : "transparent",
          color: open ? "var(--ac)" : "var(--t2)",
          opacity: selectionCount === 0 || busy ? 0.4 : 1,
          fontFamily: "inherit",
        }}
      >
        <TopicMoveIcon width={16} height={16} />
      </button>

      {open && selectionCount > 0 && (
        <div
          id={popoverId}
          role="dialog"
          aria-label={`Change topic for ${selectionLabel}`}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: "absolute",
            left: "50%",
            bottom: "100%",
            width: 292,
            marginBottom: 8,
            transform: "translateX(-50%)",
            padding: 6,
            background: "rgba(18,18,18,.97)",
            border: "1px solid var(--bdh)",
            borderRadius: 2,
            backdropFilter: "blur(20px)",
            boxShadow: "0 20px 60px rgba(0,0,0,.7)",
            zIndex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 12,
              padding: "6px 8px 8px",
            }}
          >
            <span style={{ color: "var(--tm)", fontSize: 10, letterSpacing: ".08em", textTransform: "uppercase" }}>
              Move to topic
            </span>
            <span style={{ color: "var(--t3)", fontSize: 10 }}>{selectionLabel}</span>
          </div>

          <div style={{ maxHeight: 210, overflowY: "auto", overscrollBehavior: "contain" }}>
            {targets.length === 0 ? (
              <div style={{ padding: "10px 9px 12px", color: "var(--tm)", fontSize: 12 }}>
                No existing topics yet
              </div>
            ) : (
              targets.map((target) => {
                const current = target.id === currentTopicId;
                return (
                  <button
                    key={target.id}
                    type="button"
                    disabled={busy || current}
                    onClick={() => {
                      onMove(target.id);
                      close();
                    }}
                    aria-current={current ? "true" : undefined}
                    className="am-mi"
                    style={{
                      ...menuButtonStyle,
                      gap: 8,
                      minHeight: 34,
                      padding: "7px 9px",
                      cursor: busy || current ? "default" : "pointer",
                      color: "var(--t1)",
                      opacity: busy ? 0.45 : 1,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: 9,
                        height: 9,
                        flex: "0 0 auto",
                        borderRadius: 999,
                        background: target.color ?? "var(--t3)",
                        boxShadow: target.color ? `0 0 8px ${target.color}` : "none",
                      }}
                    />
                    <span
                      style={{
                        minWidth: 0,
                        flex: 1,
                        overflow: "hidden",
                        color: current ? "var(--t2)" : "var(--t1)",
                        fontSize: 12.5,
                        textAlign: "left",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {target.label}
                    </span>
                    {target.manual && <TopicBadge>Manual</TopicBadge>}
                    {target.pinned && <TopicBadge>Pinned</TopicBadge>}
                    <span
                      aria-hidden="true"
                      style={{
                        display: "flex",
                        width: 12,
                        flex: "0 0 auto",
                        justifyContent: "center",
                        color: "var(--ac)",
                        opacity: current ? 1 : 0,
                      }}
                    >
                      <CheckIcon width={11} height={11} stroke="currentColor" />
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <div style={{ height: 1, margin: "4px 0", background: "var(--bd)" }} />

          {creating ? (
            <form onSubmit={submitNewTopic} style={{ display: "flex", gap: 6, padding: "4px 4px" }}>
              <input
                autoFocus
                value={name}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  // Keep workspace shortcuts from consuming a topic name.
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setCreating(false);
                    setName("");
                  }
                }}
                aria-label="New topic name"
                placeholder="New topic name"
                style={{
                  minWidth: 0,
                  height: 30,
                  flex: 1,
                  padding: "0 9px",
                  background: "var(--bg-in)",
                  border: "1px solid var(--bdh)",
                  borderRadius: 2,
                  color: "var(--t1)",
                  fontFamily: "inherit",
                  fontSize: 12,
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={busy || !name.trim()}
                style={{
                  height: 30,
                  padding: "0 10px",
                  background: !busy && name.trim() ? "var(--ac)" : "var(--bg-el)",
                  border: 0,
                  borderRadius: 2,
                  color: !busy && name.trim() ? "#050505" : "var(--tm)",
                  cursor: !busy && name.trim() ? "pointer" : "default",
                  fontFamily: "inherit",
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                Create
              </button>
            </form>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => setCreating(true)}
              className="am-mi"
              style={{
                ...menuButtonStyle,
                gap: 8,
                padding: "9px 10px",
                cursor: busy ? "default" : "pointer",
                color: "var(--ac)",
                fontSize: 12.5,
                opacity: busy ? 0.45 : 1,
              }}
            >
              <AddIcon width={13} height={13} strokeWidth={1.6} />
              New topic from selection
            </button>
          )}

          <div style={{ height: 1, margin: "4px 0", background: "var(--bd)" }} />

          <button
            type="button"
            disabled={busy || !canReturnToAi}
            onClick={() => {
              onReturnToAi();
              close();
            }}
            className="am-mi"
            title={canReturnToAi ? "Remove manual topic assignments" : "Selection already follows AI grouping"}
            style={{
              ...menuButtonStyle,
              gap: 8,
              padding: "9px 10px",
              cursor: busy || !canReturnToAi ? "default" : "pointer",
              color: "var(--t2)",
              fontSize: 12.5,
              opacity: busy || !canReturnToAi ? 0.42 : 1,
            }}
          >
            <TopicResetIcon width={13} height={13} />
            Return to AI
          </button>

          <div style={{ padding: "6px 9px 4px", color: "var(--tm)", fontSize: 9.5, lineHeight: 1.35 }}>
            Drag freely to position; hold over a highlighted cloud to move. Topic applies across the workspace.
          </div>
        </div>
      )}
    </div>
  );
}
