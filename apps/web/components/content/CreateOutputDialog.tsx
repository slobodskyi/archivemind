"use client";

import { useState } from "react";
import Dialog, { DialogButton } from "@/components/modals/Dialog";
import type { CreateOutputInput } from "@/lib/content-generation-client";

interface CreateOutputDialogProps {
  open: boolean;
  /** The outcome was picked in the hub (or fixed by the draft being
   *  regenerated) — this step only collects the brief. */
  kind: CreateOutputInput["kind"];
  boardName: string;
  allAssetIds: string[];
  selectedAssetIds: string[];
  busy: boolean;
  error: string | null;
  initial?: Partial<CreateOutputInput> | null;
  /** Step back to the hub. Escape and the footer's Back both land there. */
  onClose: () => void;
  onGenerate: (input: CreateOutputInput) => void;
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  background: "var(--bg)",
  color: "var(--t1)",
  fontFamily: "inherit",
  fontSize: 12.5,
  outline: "none",
} as const;

const fieldLabel = { color: "var(--t2)", fontSize: 10.5 } as const;

/** The brief step (ADR 0045 as amended): prompt and language up front, the
 * refinements behind More options — the studio is where the result gets
 * shaped, so the form stops charging eight decisions before the first draft. */
export default function CreateOutputDialog({
  open,
  kind,
  boardName,
  allAssetIds,
  selectedAssetIds,
  busy,
  error,
  initial,
  onClose,
  onGenerate,
}: CreateOutputDialogProps) {
  const initialSourceIds = initial?.sourceAssetIds?.length ? initial.sourceAssetIds : [];
  const [source, setSource] = useState<"snapshot" | "selected" | "all">(
    initialSourceIds.length ? "snapshot" : selectedAssetIds.length ? "selected" : "all",
  );
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [audience, setAudience] = useState(initial?.audience ?? "");
  const [language, setLanguage] = useState<"en" | "uk" | "ru">(initial?.language ?? "en");
  const [tone, setTone] = useState<"editorial" | "personal" | "social">(initial?.tone ?? "editorial");
  const [length, setLength] = useState<"short" | "medium" | "long">(initial?.kind === "article" ? (initial.length ?? "medium") : "medium");
  const [aspectRatio, setAspectRatio] = useState<"4:5" | "1:1">(initial?.kind === "instagram_carousel" ? (initial.aspectRatio ?? "4:5") : "4:5");
  const [count, setCount] = useState<number | null>(
    initial?.kind === "article" ? (initial.imageCount ?? null) : initial?.kind === "instagram_carousel" ? (initial.slideCount ?? null) : null,
  );
  // A seed that carries refinements should not hide them behind the fold.
  const [moreOpen, setMoreOpen] = useState(() => Boolean(
    (initial?.audience ?? "") !== "" ||
    (initial?.tone && initial.tone !== "editorial") ||
    (initial?.kind === "article" && initial.length && initial.length !== "medium") ||
    (initial?.kind === "instagram_carousel" && initial.aspectRatio && initial.aspectRatio !== "4:5"),
  ));
  if (!open) return null;

  const sourceAssetIds = source === "snapshot" && initialSourceIds.length
    ? initialSourceIds
    : source === "selected" && selectedAssetIds.length
      ? selectedAssetIds
      : allAssetIds;
  const generationAssetIds = sourceAssetIds.slice(0, 20);
  const maxCount = generationAssetIds.length;
  const minCount = kind === "article" ? 1 : 2;
  const defaultCount = kind === "article" ? 5 : Math.min(7, Math.max(2, maxCount));
  const actualCount = Math.min(Math.max(count ?? defaultCount, minCount), maxCount);
  const canGenerate = prompt.trim().length > 0 && maxCount >= minCount && !busy;
  const submit = () => {
    if (!canGenerate) return;
    const common = {
      sourceAssetIds: generationAssetIds,
      prompt: prompt.trim(),
      audience: audience.trim(),
      additionalInstructions: "",
      language,
      tone,
    };
    onGenerate(
      kind === "article"
        ? { ...common, kind, length, imageCount: actualCount }
        : { ...common, kind, aspectRatio, slideCount: actualCount },
    );
  };

  const moreSummary = [
    audience.trim() || null,
    tone !== "editorial" ? tone : null,
    kind === "article" ? (length !== "medium" ? length : null) : aspectRatio !== "4:5" ? aspectRatio : null,
    `${actualCount} ${kind === "article" ? "images" : "slides"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dialog
      open={open}
      size="l"
      kicker="Create"
      title={`${kind === "article" ? "Article" : "Instagram carousel"} from ${boardName}`}
      subtitle="Say what it should tell. Everything else can change after the draft exists."
      closeButton={false}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <DialogButton onClick={onClose} disabled={busy}>‹ Back</DialogButton>
          <DialogButton variant="primary" onClick={submit} disabled={!canGenerate}>
            {busy ? "Drafting…" : `Generate ${kind === "article" ? "article" : "carousel"}`}
          </DialogButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {(initialSourceIds.length > 0 || (selectedAssetIds.length > 0 && selectedAssetIds.length !== allAssetIds.length)) && (
          <fieldset style={{ margin: 0, padding: 0, border: 0 }}>
            <legend style={{ marginBottom: 7, color: "var(--t2)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".07em" }}>Sources</legend>
            <div style={{ display: "flex", gap: 8 }}>
              {([
                ...(initialSourceIds.length ? [["snapshot", `Draft snapshot ${initialSourceIds.length}`] as const] : []),
                ...(selectedAssetIds.length > 0 && selectedAssetIds.length !== allAssetIds.length
                  ? [["selected", `Selected ${selectedAssetIds.length}`] as const]
                  : []),
                ["all", `All ${allAssetIds.length}`] as const,
              ]).map(([value, label]) => (
                <label key={value} style={{ color: "var(--t2)", fontSize: 12, cursor: "pointer" }}>
                  <input type="radio" name="output-source" checked={source === value} onChange={() => setSource(value)} /> {label}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: 7, color: "var(--t2)", fontSize: 11.5 }}>
          What should this say?
          <textarea
            data-autofocus=""
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={kind === "article" ? "Tell the story behind this selection…" : "What should viewers understand or do after the last slide?"}
            rows={4}
            maxLength={4000}
            style={{ ...inputStyle, padding: "10px 11px", resize: "vertical", lineHeight: 1.45 }}
          />
        </label>

        <label style={{ ...fieldLabel, maxWidth: 220 }}>Language
          <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 8px" }}>
            <option value="en">English</option><option value="uk">Українська</option><option value="ru">Русский</option>
          </select>
        </label>

        <div>
          <button
            type="button"
            onClick={() => setMoreOpen((value) => !value)}
            aria-expanded={moreOpen}
            style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: moreOpen ? 10 : 0, padding: 0, border: 0, background: "transparent", color: "var(--t3)", fontFamily: "inherit", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", cursor: "pointer" }}
          >
            {moreOpen ? "▾" : "▸"} More options <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--t2)" }}>— {moreSummary}</span>
          </button>
          {moreOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={fieldLabel}>Audience
                <input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Readers, clients…" style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 9px" }} />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label style={fieldLabel}>Tone
                  <select value={tone} onChange={(event) => setTone(event.target.value as typeof tone)} style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 8px" }}>
                    <option value="editorial">Editorial</option><option value="personal">Personal</option><option value="social">Social</option>
                  </select>
                </label>
                {kind === "article" ? (
                  <label style={fieldLabel}>Length
                    <select value={length} onChange={(event) => setLength(event.target.value as typeof length)} style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 8px" }}>
                      <option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option>
                    </select>
                  </label>
                ) : (
                  <label style={fieldLabel}>Aspect ratio
                    <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof aspectRatio)} style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 8px" }}>
                      <option value="4:5">Portrait 4:5</option><option value="1:1">Square 1:1</option>
                    </select>
                  </label>
                )}
                <label style={fieldLabel}>{kind === "article" ? "Images" : "Slides"}
                  <input type="number" min={minCount} max={maxCount} value={actualCount} onChange={(event) => setCount(Number(event.target.value))} style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 9px" }} />
                </label>
              </div>
            </div>
          )}
        </div>

        {sourceAssetIds.length > 20 && <div style={{ color: "var(--t3)", fontSize: 10.5 }}>Generation uses the first 20 sources from the current canvas order. Raw Download still includes the full Workspace.</div>}
        <div style={{ color: "var(--t3)", fontSize: 10.5 }}>AI text is a draft. Review names, dates and claims before publishing.</div>
        {kind === "instagram_carousel" && maxCount < 2 && <div style={{ color: "var(--red)", fontSize: 11 }}>A carousel needs at least 2 photos.</div>}
        {error && <div role="alert" style={{ color: "var(--red)", fontSize: 11.5 }}>{error}</div>}
      </div>
    </Dialog>
  );
}
