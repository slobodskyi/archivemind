"use client";

import { useEffect, useRef, useState } from "react";
import { POPOVER_SURFACE, Z } from "@/lib/ui";
import { ChevronDownIcon, CheckIcon } from "@/components/icons/icons";

interface DropdownOption<T extends string> {
  value: T;
  label: string;
}

/** A select styled as the app's own dropdown rather than the browser's native
 *  one (which renders in the OS chrome, above our menus and clipped by the
 *  viewport). Same floating surface every other popover uses. Click-away and
 *  Escape close it; picking an option closes it. */
export default function Dropdown<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  width = 180,
}: {
  value: T;
  options: readonly DropdownOption<T>[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  /** Trigger width, in px. The menu is at least this wide, so long labels are
   *  never cropped. */
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative", flex: "0 0 auto" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          width,
          height: 30,
          padding: "0 8px",
          background: "var(--bg-in)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          color: "var(--t1)",
          fontSize: 11.5,
          fontFamily: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current?.label ?? ""}
        </span>
        <ChevronDownIcon width={11} height={11} stroke="var(--t3)" style={{ flex: "0 0 auto" }} />
      </button>
      {open && (
        <div
          role="listbox"
          style={{
            ...POPOVER_SURFACE,
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: width,
            padding: 4,
            zIndex: Z.menu,
          }}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className="am-mi"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  padding: "7px 9px",
                  border: 0,
                  borderRadius: 2,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 12,
                  color: active ? "var(--t1)" : "var(--t2)",
                  background: "transparent",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ display: "flex", width: 12, flex: "0 0 auto", justifyContent: "center", color: "var(--ac)", opacity: active ? 1 : 0 }}>
                  <CheckIcon width={11} height={11} stroke="currentColor" />
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
