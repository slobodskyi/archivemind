"use client";

import { useState } from "react";
import Dialog, { DialogButton } from "@/components/modals/Dialog";
import type { CreateOutputInput } from "@/lib/content-generation-client";

interface CreateOutputDialogProps {
  open: boolean;
  boardName: string;
  allAssetIds: string[];
  selectedAssetIds: string[];
  busy: boolean;
  error: string | null;
  initial?: Partial<CreateOutputInput> | null;
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

export default function CreateOutputDialog({
  open,
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
  const [kind, setKind] = useState<CreateOutputInput["kind"]>(initial?.kind ?? "article");
  const [source, setSource] = useState<"snapshot" | "selected" | "all">(
    initialSourceIds.length ? "snapshot" : selectedAssetIds.length ? "selected" : "all",
  );
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [audience, setAudience] = useState(initial?.audience ?? "");
  const [language, setLanguage] = useState<"en" | "uk" | "ru">(initial?.language ?? "en");
  const [tone, setTone] = useState<"editorial" | "personal" | "social">(initial?.tone ?? "editorial");
  const [length, setLength] = useState<"short" | "medium" | "long">(initial?.kind === "article" ? (initial.length ?? "medium") : "medium");
  const [aspectRatio, setAspectRatio] = useState<"4:5" | "1:1">(initial?.kind === "instagram_carousel" ? (initial.aspectRatio ?? "4:5") : "4:5");
  const [count, setCount] = useState(initial?.kind === "article" ? (initial.imageCount ?? 5) : initial?.kind === "instagram_carousel" ? (initial.slideCount ?? 5) : 5);
  if (!open) return null;

  const sourceAssetIds = source === "snapshot" && initialSourceIds.length
    ? initialSourceIds
    : source === "selected" && selectedAssetIds.length
      ? selectedAssetIds
      : allAssetIds;
  const generationAssetIds = sourceAssetIds.slice(0, 20);
  const maxCount = generationAssetIds.length;
  const minCount = kind === "article" ? 1 : 2;
  const actualCount = Math.min(Math.max(count, minCount), maxCount);
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

  return (
    <Dialog
      open={open}
      size="l"
      kicker="Create"
      title={`Create from ${boardName}`}
      subtitle="Choose the outcome first. File formats come after the copy is reviewed."
      closeButton={false}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <DialogButton onClick={onClose} disabled={busy}>Cancel</DialogButton>
          <DialogButton variant="primary" onClick={submit} disabled={!canGenerate}>
            {busy ? "Drafting…" : `Generate ${kind === "article" ? "article" : "carousel"}`}
          </DialogButton>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {([
            ["article", "Article", "Narrative copy with ordered images"],
            ["instagram_carousel", "Instagram carousel", "Phone-sized story sequence + caption"],
          ] as const).map(([value, label, help]) => (
            <button
              key={value}
              onClick={() => {
                setKind(value);
                setCount(value === "article" ? 5 : Math.min(7, Math.max(2, maxCount)));
              }}
              style={{
                padding: "13px 14px",
                textAlign: "left",
                background: kind === value ? "color-mix(in srgb,var(--ac) 10%,var(--bg-el))" : "var(--bg-el)",
                border: `1px solid ${kind === value ? "var(--ac)" : "var(--bd)"}`,
                borderRadius: 2,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <span style={{ display: "block", color: "var(--t1)", fontSize: 13, fontWeight: 700 }}>{label}</span>
              <span style={{ display: "block", marginTop: 4, color: "var(--t3)", fontSize: 10.5 }}>{help}</span>
            </button>
          ))}
        </div>

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

        <label style={fieldLabel}>Audience
          <input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="Readers, clients…" style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 9px" }} />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={fieldLabel}>Language
            <select value={language} onChange={(event) => setLanguage(event.target.value as typeof language)} style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 8px" }}>
              <option value="en">English</option><option value="uk">Українська</option><option value="ru">Русский</option>
            </select>
          </label>
          <label style={fieldLabel}>Tone
            <select value={tone} onChange={(event) => setTone(event.target.value as typeof tone)} style={{ ...inputStyle, height: 34, marginTop: 6, padding: "0 8px" }}>
              <option value="editorial">Editorial</option><option value="personal">Personal</option><option value="social">Social</option>
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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

        {sourceAssetIds.length > 20 && <div style={{ color: "var(--t3)", fontSize: 10.5 }}>Generation uses the first 20 sources from the current canvas order. Raw Download still includes the full Workspace.</div>}
        <div style={{ color: "var(--t3)", fontSize: 10.5 }}>AI text is a draft. Review names, dates and claims before publishing.</div>
        {kind === "instagram_carousel" && maxCount < 2 && <div style={{ color: "var(--red)", fontSize: 11 }}>A carousel needs at least 2 photos.</div>}
        {error && <div role="alert" style={{ color: "var(--red)", fontSize: 11.5 }}>{error}</div>}
      </div>
    </Dialog>
  );
}
