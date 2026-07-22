"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  EDIT_STRAIGHTEN_MAX_DEG,
  editRecipeSchema,
  inscribedCropForStraighten,
  isIdentityRecipe,
  workingDimensions,
  type EditCrop,
  type EditRecipe,
} from "@archivemind/shared";
import type { Photo } from "@/types";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "@/components/icons/icons";

/** Tier-0 non-destructive image editor (ADR 0030): crop, rotate 90°, straighten,
 *  flip. The client only ever produces a RECIPE — a live CSS preview renders the
 *  working image (flip → rotate90+straighten combined into one CSS rotate,
 *  matching the worker's single sharp rotate), and a crop overlay in that
 *  working frame is normalized 1:1 into recipe.crop. The worker renders the real
 *  edited previews from the original medium; this never touches pixels. */

type Rotate = 0 | 90 | 180 | 270;

interface ImageEditorProps {
  open: boolean;
  photo: Photo | null;
  /** A save/reset job is in flight — Save is disabled to avoid double-enqueue. */
  busy?: boolean;
  onClose: () => void;
  onSave: (recipe: EditRecipe) => void;
  onReset: (id: string) => void;
}

interface AspectPreset {
  label: string;
  /** width/height in pixels, or null for free-form, or "original" to track the
   *  working frame's own aspect. */
  ratio: number | null | "original";
}
const ASPECTS: AspectPreset[] = [
  { label: "Free", ratio: null },
  { label: "Original", ratio: "original" },
  { label: "1:1", ratio: 1 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "3:2", ratio: 3 / 2 },
  { label: "16:9", ratio: 16 / 9 },
];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export default function ImageEditor({ open, photo, busy, onClose, onSave, onReset }: ImageEditorProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const [rotate, setRotate] = useState<Rotate>(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [straighten, setStraighten] = useState(0);
  const [crop, setCrop] = useState<EditCrop | null>(null);
  const [aspect, setAspect] = useState<AspectPreset["ratio"]>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Reset transient editor state whenever the edited asset changes — done during
  // render (the documented "adjust state on prop change" escape hatch), not in an
  // effect, so React never cascades. The async load below only fills state in.
  // Keyed on the asset id, NOT the photo object: a background job's router.refresh
  // hands us a new photo object with the same id, and re-editing must survive it.
  const photoId = photo?.id ?? null;
  const scope = open && photoId ? photoId : "";
  const [loadedScope, setLoadedScope] = useState("");
  if (scope !== loadedScope) {
    setLoadedScope(scope);
    setUrl(null);
    setNatural(null);
    setRotate(0);
    setFlipH(false);
    setFlipV(false);
    setStraighten(0);
    setCrop(null);
    setAspect(null);
    setLoading(scope !== "");
  }

  // ── Load the ORIGINAL medium + the current recipe when the editor opens ─────
  useEffect(() => {
    if (!open || !photoId) return;
    const id = photoId;
    let alive = true;

    // ?original=1 → the untouched preview; the recipe is relative to it. Measure
    // its natural (oriented) dims off-DOM so the working frame can be sized
    // before the visible <img> mounts. `loading` is tied to THIS image (not the
    // recipe fetch), so the stage never flashes "unavailable" before it lands.
    fetch(`/api/assets/${id}/medium?original=1`)
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string | null }>) : null))
      .then((j) => {
        if (!alive) return;
        if (!j?.url) {
          setLoading(false);
          return;
        }
        const measured = document.createElement("img");
        measured.onload = () => {
          if (!alive) return;
          setNatural({ w: measured.naturalWidth, h: measured.naturalHeight });
          setUrl(j.url);
          setLoading(false);
        };
        measured.onerror = () => {
          if (alive) setLoading(false);
        };
        measured.src = j.url;
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    // Resume the last edit so re-opening is non-destructive.
    fetch(`/api/assets/${id}/edit`)
      .then((r) => (r.ok ? (r.json() as Promise<{ recipe: unknown }>) : null))
      .then((j) => {
        if (!alive || !j?.recipe) return;
        const parsed = editRecipeSchema.safeParse(j.recipe);
        if (!parsed.success) return;
        setRotate(parsed.data.rotate as Rotate);
        setFlipH(parsed.data.flipH);
        setFlipV(parsed.data.flipV);
        setStraighten(parsed.data.straighten);
        setCrop(parsed.data.crop);
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [open, photoId]);

  // ── Measure the stage so we can `contain`-fit the working frame ─────────────
  useLayoutEffect(() => {
    if (!open) return;
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setStage({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  // ── Escape closes ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const rotateBy = useCallback((delta: 90 | -90) => {
    setRotate((r) => (((r + delta + 360) % 360) as Rotate));
    setCrop(null); // a quarter-turn reshapes the frame — drop a stale crop box
  }, []);

  // Geometry of the working frame (the crop's coordinate space).
  const workRecipe = { rotate, straighten };
  const work = natural ? workingDimensions(natural.w, natural.h, workRecipe) : { w: 4, h: 3 };
  const workAspect = work.w / work.h;

  // Effective crop for BOTH the preview overlay and the saved recipe: a manual
  // crop wins; otherwise a straighten auto-insets to the largest corner-free
  // rectangle so a tilt never reveals empty triangles.
  const effectiveCrop: EditCrop | null =
    crop ?? (natural && straighten !== 0 ? inscribedCropForStraighten(natural.w, natural.h, workRecipe) : null);

  const recipe: EditRecipe = { rotate, flipH, flipV, straighten, crop: effectiveCrop };
  const dirty = !isIdentityRecipe(recipe);

  // contain-fit the working frame into the stage.
  const fitK = stage.w && stage.h ? Math.min(stage.w / work.w, stage.h / work.h) : 0;
  const frameW = work.w * fitK;
  const frameH = work.h * fitK;
  const imgW = natural ? natural.w * fitK : 0;
  const imgH = natural ? natural.h * fitK : 0;
  const angle = (((rotate + straighten) % 360) + 360) % 360;

  // ── Crop overlay interaction (normalized [0,1] within the working frame) ────
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<
    | { kind: "move"; ox: number; oy: number }
    | { kind: "resize"; anchorX: number; anchorY: number }
    | null
  >(null);

  const pointerNorm = useCallback((e: PointerEvent | React.PointerEvent): { x: number; y: number } => {
    const el = frameRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  }, []);

  /** Snap a rect (normalized) to the locked aspect, growing the crop from a
   *  corner. `ar` is width/height in PIXELS — convert to the frame's normalized
   *  ratio via the frame's own pixel aspect. */
  const applyAspect = useCallback(
    (c: EditCrop): EditCrop => {
      if (aspect === null) return c;
      const arPx = aspect === "original" ? workAspect : aspect;
      const arNorm = arPx / workAspect; // normalized w:h target
      // Keep width, derive height (then clamp within bounds, re-derive width).
      let w = c.w;
      let h = w / arNorm;
      if (c.y + h > 1) {
        h = 1 - c.y;
        w = h * arNorm;
      }
      if (c.x + w > 1) {
        w = 1 - c.x;
        h = w / arNorm;
      }
      return { x: c.x, y: c.y, w: Math.max(0.02, w), h: Math.max(0.02, h) };
    },
    [aspect, workAspect],
  );

  useEffect(() => {
    if (!open) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = pointerNorm(e);
      setCrop((prev) => {
        const base = prev ?? effectiveCrop ?? { x: 0, y: 0, w: 1, h: 1 };
        if (d.kind === "move") {
          const w = base.w;
          const h = base.h;
          return {
            x: Math.min(1 - w, Math.max(0, p.x - d.ox)),
            y: Math.min(1 - h, Math.max(0, p.y - d.oy)),
            w,
            h,
          };
        }
        // resize: rect between the fixed anchor corner and the pointer
        const x = Math.min(d.anchorX, p.x);
        const y = Math.min(d.anchorY, p.y);
        const w = Math.max(0.02, Math.abs(p.x - d.anchorX));
        const h = Math.max(0.02, Math.abs(p.y - d.anchorY));
        return applyAspect({ x, y, w, h });
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // A drag interrupted by a close (Escape mid-drag) must not resume as a
      // phantom button-less drag after reopen — the pointerup would be missed.
      dragRef.current = null;
    };
  }, [open, pointerNorm, applyAspect, effectiveCrop]);

  const startMove = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const c = effectiveCrop ?? { x: 0, y: 0, w: 1, h: 1 };
    const p = pointerNorm(e);
    dragRef.current = { kind: "move", ox: p.x - c.x, oy: p.y - c.y };
  };
  const startResize = (anchorX: number, anchorY: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { kind: "resize", anchorX, anchorY };
  };

  const pickAspect = (preset: AspectPreset) => {
    setAspect(preset.ratio);
    if (preset.ratio === null) return; // free — keep current crop
    const arPx = preset.ratio === "original" ? workAspect : preset.ratio;
    const arNorm = arPx / workAspect;
    // Largest centered rect of that ratio inside the frame.
    let w = 1;
    let h = w / arNorm;
    if (h > 1) {
      h = 1;
      w = h * arNorm;
    }
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };

  const resetAll = () => {
    setRotate(0);
    setFlipH(false);
    setFlipV(false);
    setStraighten(0);
    setCrop(null);
    setAspect(null);
  };

  const save = () => {
    const parsed = editRecipeSchema.safeParse(recipe);
    if (!parsed.success || isIdentityRecipe(parsed.data)) return;
    onSave(parsed.data);
  };

  if (!open || !photo) return null;

  const oc = effectiveCrop; // overlay crop (may be null → full frame, no scrim)
  const cornerHandles: Array<{ ax: number; ay: number; cx: number; cy: number; cursor: string }> = oc
    ? [
        { ax: oc.x + oc.w, ay: oc.y + oc.h, cx: oc.x, cy: oc.y, cursor: "nwse-resize" }, // TL, anchor BR
        { ax: oc.x, ay: oc.y + oc.h, cx: oc.x + oc.w, cy: oc.y, cursor: "nesw-resize" }, // TR, anchor BL
        { ax: oc.x + oc.w, ay: oc.y, cx: oc.x, cy: oc.y + oc.h, cursor: "nesw-resize" }, // BL, anchor TR
        { ax: oc.x, ay: oc.y, cx: oc.x + oc.w, cy: oc.y + oc.h, cursor: "nwse-resize" }, // BR, anchor TL
      ]
    : [];

  return (
    <div
      role="dialog"
      aria-label="Edit image"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 90,
        background: "rgba(5,5,5,.72)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onPointerDown={(e) => {
        // click on the dim backdrop (not the panel) closes
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(92vw, 960px)",
          height: "min(88vh, 720px)",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-sf)",
          border: "1px solid var(--bd)",
          borderRadius: 4,
          boxShadow: "0 24px 80px rgba(0,0,0,.6)",
          overflow: "hidden",
        }}
      >
        {/* header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 46,
            padding: "0 14px",
            borderBottom: "1px solid var(--bd)",
          }}
        >
          <span style={{ fontSize: 12.5, color: "var(--t1)" }}>
            Edit — <span style={{ color: "var(--t3)" }}>{photo.filename}</span>
          </span>
          <button onClick={onClose} aria-label="Close" style={iconBtn}>
            <CloseIcon width={13} height={13} strokeWidth={1.8} />
          </button>
        </div>

        {/* stage */}
        <div
          ref={stageRef}
          style={{
            position: "relative",
            flex: 1,
            background: "var(--bg)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {url && natural ? (
            <div
              ref={frameRef}
              style={{
                position: "absolute",
                left: (stage.w - frameW) / 2,
                top: (stage.h - frameH) / 2,
                width: frameW,
                height: frameH,
                overflow: "hidden",
                touchAction: "none",
              }}
            >
              {/* the working image: flip then a single rotate (rotate+straighten),
                  centered so its rotation bbox fills the frame (matches sharp) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt=""
                draggable={false}
                style={{
                  position: "absolute",
                  left: (frameW - imgW) / 2,
                  top: (frameH - imgH) / 2,
                  width: imgW,
                  height: imgH,
                  transformOrigin: "center center",
                  transform: `rotate(${angle}deg) scaleX(${flipH ? -1 : 1}) scaleY(${flipV ? -1 : 1})`,
                  userSelect: "none",
                }}
              />

              {/* crop overlay */}
              {oc && (
                <div
                  onPointerDown={startMove}
                  style={{
                    position: "absolute",
                    left: `${oc.x * 100}%`,
                    top: `${oc.y * 100}%`,
                    width: `${oc.w * 100}%`,
                    height: `${oc.h * 100}%`,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,.5)",
                    border: "1px solid rgba(255,255,255,.9)",
                    cursor: "move",
                    touchAction: "none",
                  }}
                >
                  {/* rule-of-thirds guides */}
                  <div style={thirds(true)} />
                  <div style={thirds(false)} />
                  {cornerHandles.map((h, i) => (
                    <div
                      key={i}
                      onPointerDown={startResize(h.ax, h.ay)}
                      style={{
                        position: "absolute",
                        left: `calc(${(h.cx - oc.x) / oc.w * 100}% - 7px)`,
                        top: `calc(${(h.cy - oc.y) / oc.h * 100}% - 7px)`,
                        width: 14,
                        height: 14,
                        background: "var(--ac)",
                        border: "1px solid #050505",
                        borderRadius: 2,
                        cursor: h.cursor,
                        touchAction: "none",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "var(--t3)" }}>
              {loading ? "Loading…" : "Preview unavailable"}
            </div>
          )}
        </div>

        {/* toolbar */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderTop: "1px solid var(--bd)",
          }}
        >
          <button onClick={() => rotateBy(-90)} style={toolBtn()} title="Rotate left">
            <ChevronLeftIcon /> 90°
          </button>
          <button onClick={() => rotateBy(90)} style={toolBtn()} title="Rotate right">
            90° <ChevronRightIcon />
          </button>
          <button onClick={() => setFlipH((v) => !v)} style={toolBtn(flipH)} title="Flip horizontal">
            Flip H
          </button>
          <button onClick={() => setFlipV((v) => !v)} style={toolBtn(flipV)} title="Flip vertical">
            Flip V
          </button>

          <div style={{ display: "flex", gap: 2, background: "var(--bg-in)", borderRadius: 2, padding: 2 }}>
            {ASPECTS.map((a) => (
              <button
                key={a.label}
                onClick={() => pickAspect(a)}
                style={{
                  height: 24,
                  padding: "0 9px",
                  border: 0,
                  borderRadius: 2,
                  fontSize: 11,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  background: aspect === a.ratio ? "var(--bg-el)" : "transparent",
                  color: aspect === a.ratio ? "#fff" : "var(--t3)",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--t3)" }}>
            Straighten
            <input
              type="range"
              min={-EDIT_STRAIGHTEN_MAX_DEG}
              max={EDIT_STRAIGHTEN_MAX_DEG}
              step={0.5}
              value={straighten}
              disabled={!natural}
              onChange={(e) => setStraighten(Number(e.target.value))}
              style={{ width: 120 }}
            />
            <span style={{ width: 34, textAlign: "right", color: "var(--t2)", fontVariantNumeric: "tabular-nums" }}>
              {straighten.toFixed(1)}°
            </span>
          </label>
        </div>

        {/* footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderTop: "1px solid var(--bd)",
          }}
        >
          <button onClick={resetAll} disabled={!dirty} style={ghostBtn(!dirty)}>
            Reset edits
          </button>
          {photo.edited && (
            <button
              onClick={() => {
                onReset(photo.id);
                onClose();
              }}
              disabled={busy}
              style={ghostBtn(Boolean(busy))}
              title="Remove the saved edit and restore the original"
            >
              Revert to original
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={ghostBtn(false)}>
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!dirty || busy || !natural}
            style={primaryBtn(!dirty || Boolean(busy) || !natural)}
          >
            Save edit
          </button>
        </div>
      </div>
    </div>
  );
}

function thirds(vertical: boolean): React.CSSProperties {
  return {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background: vertical
      ? "linear-gradient(to right, transparent 33.33%, rgba(255,255,255,.25) 33.33%, rgba(255,255,255,.25) calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent 66.66%, rgba(255,255,255,.25) 66.66%, rgba(255,255,255,.25) calc(66.66% + 1px), transparent calc(66.66% + 1px))"
      : "linear-gradient(to bottom, transparent 33.33%, rgba(255,255,255,.25) 33.33%, rgba(255,255,255,.25) calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent 66.66%, rgba(255,255,255,.25) 66.66%, rgba(255,255,255,.25) calc(66.66% + 1px), transparent calc(66.66% + 1px))",
  };
}

const iconBtn: React.CSSProperties = {
  display: "flex",
  width: 26,
  height: 26,
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--bd)",
  background: "var(--bg-el)",
  color: "var(--t1)",
  borderRadius: 2,
  cursor: "pointer",
};

function toolBtn(active?: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 4,
    height: 30,
    padding: "0 11px",
    background: active ? "var(--bg-el)" : "var(--bg-in)",
    border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`,
    borderRadius: 2,
    color: active ? "#fff" : "var(--t1)",
    fontSize: 11.5,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: "0 13px",
    background: "transparent",
    border: "1px solid var(--bdh)",
    borderRadius: 2,
    color: disabled ? "var(--t3)" : "var(--t1)",
    fontSize: 12,
    fontFamily: "inherit",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    padding: "0 16px",
    background: "var(--ac)",
    border: 0,
    borderRadius: 2,
    color: "#050505",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.04em",
    fontFamily: "inherit",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}
