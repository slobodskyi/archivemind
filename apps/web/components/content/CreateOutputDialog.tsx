"use client";

import { useId, useState } from "react";
import Dialog, { DialogButton } from "@/components/modals/Dialog";
import SegmentedTrack from "@/components/ui/SegmentedTrack";
import Stepper from "@/components/ui/Stepper";
import type { CreateOutputInput } from "@/lib/content-generation-client";

interface CreateOutputDialogProps {
  open: boolean;
  /** The outcome was picked in the hub (or fixed by the draft being
   *  regenerated) — this step only collects the brief. */
  kind: CreateOutputInput["kind"];
  boardName: string;
  allAssetIds: string[];
  selectedAssetIds: string[];
  /** Authored chains drawn on the canvas (ADR 0048), each already in its
   *  walk order — every one becomes a source option. */
  threads?: readonly (readonly string[])[];
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
  threads = [],
  busy,
  error,
  initial,
  onClose,
  onGenerate,
}: CreateOutputDialogProps) {
  const initialSourceIds = initial?.sourceAssetIds?.length ? initial.sourceAssetIds : [];
  const [source, setSource] = useState<"snapshot" | "selected" | "all" | `thread:${number}`>(
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
  const languageId = useId();
  const toneId = useId();
  const shapeId = useId();
  // A seed that carries refinements should not hide them behind the fold.
  const [moreOpen, setMoreOpen] = useState(() => Boolean(
    (initial?.audience ?? "") !== "" ||
    (initial?.tone && initial.tone !== "editorial") ||
    (initial?.kind === "article" && initial.length && initial.length !== "medium") ||
    (initial?.kind === "instagram_carousel" && initial.aspectRatio && initial.aspectRatio !== "4:5"),
  ));
  if (!open) return null;

  const pickedThread = source.startsWith("thread:")
    ? threads[Number(source.slice("thread:".length))] ?? null
    : null;
  const sourceAssetIds = pickedThread
    ? [...pickedThread]
    : source === "snapshot" && initialSourceIds.length
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
      // A thread's order is authored (ADR 0048); the route re-verifies it
      // against the drawn edges before the prompt claims so.
      orderIsAuthored: pickedThread !== null,
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
        {(initialSourceIds.length > 0 ||
          threads.length > 0 ||
          (selectedAssetIds.length > 0 && selectedAssetIds.length !== allAssetIds.length)) && (
          <fieldset style={{ margin: 0, padding: 0, border: 0 }}>
            <legend style={{ marginBottom: 7, color: "var(--t2)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".07em" }}>Sources</legend>
            {/* One-of-N as accent chips (the ExportDialog format row), not
                native radios — the browser's blue dot answers to no theme. */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {([
                ...(initialSourceIds.length ? [["snapshot", `Draft snapshot ${initialSourceIds.length}`] as const] : []),
                // A thread is an authored chain (ADR 0048): its walk order
                // becomes the generation order, and the prompt is told so.
                ...threads.map(
                  (thread, index) =>
                    [`thread:${index}`, threads.length === 1 ? `Thread · ${thread.length} photos` : `Thread ${index + 1} · ${thread.length} photos`] as const,
                ),
                ...(selectedAssetIds.length > 0 && selectedAssetIds.length !== allAssetIds.length
                  ? [["selected", `Selected ${selectedAssetIds.length}`] as const]
                  : []),
                ["all", `All ${allAssetIds.length}`] as const,
              ]).map(([value, label]) => {
                const active = source === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSource(value)}
                    style={{
                      height: 28,
                      padding: "0 10px",
                      border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`,
                      borderRadius: 2,
                      background: active ? "color-mix(in srgb, var(--ac) 14%, transparent)" : "transparent",
                      color: active ? "var(--ac)" : "var(--t2)",
                      fontFamily: "inherit",
                      fontSize: 11,
                      fontWeight: active ? 700 : 400,
                      cursor: "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
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

        <div style={{ maxWidth: 340 }}>
          <div id={languageId} style={fieldLabel}>Language</div>
          <SegmentedTrack
            value={language}
            onChange={setLanguage}
            labelledBy={languageId}
            options={[
              { value: "en", label: "English" },
              { value: "uk", label: "Українська" },
              { value: "ru", label: "Русский" },
            ]}
            style={{ marginTop: 6 }}
          />
        </div>

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
              <div>
                <div id={toneId} style={fieldLabel}>Tone</div>
                <SegmentedTrack
                  value={tone}
                  onChange={setTone}
                  labelledBy={toneId}
                  options={[
                    { value: "editorial", label: "Editorial" },
                    { value: "personal", label: "Personal" },
                    { value: "social", label: "Social" },
                  ]}
                  style={{ marginTop: 6, maxWidth: 340 }}
                />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                {kind === "article" ? (
                  <div>
                    <div id={shapeId} style={fieldLabel}>Length</div>
                    <SegmentedTrack
                      value={length}
                      onChange={setLength}
                      labelledBy={shapeId}
                      options={[
                        { value: "short", label: "Short" },
                        { value: "medium", label: "Medium" },
                        { value: "long", label: "Long" },
                      ]}
                      style={{ marginTop: 6 }}
                    />
                  </div>
                ) : (
                  <div>
                    <div id={shapeId} style={fieldLabel}>Aspect ratio</div>
                    <SegmentedTrack
                      value={aspectRatio}
                      onChange={setAspectRatio}
                      labelledBy={shapeId}
                      options={[
                        { value: "4:5", label: "Portrait 4:5" },
                        { value: "1:1", label: "Square 1:1" },
                      ]}
                      style={{ marginTop: 6 }}
                    />
                  </div>
                )}
                <div style={{ width: 128 }}>
                  <div style={fieldLabel}>{kind === "article" ? "Images" : "Slides"}</div>
                  <div style={{ marginTop: 6 }}>
                    <Stepper
                      value={actualCount}
                      min={minCount}
                      max={maxCount}
                      onChange={setCount}
                      label={kind === "article" ? "Images" : "Slides"}
                    />
                  </div>
                </div>
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
