import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtboardSettings } from "@archivemind/shared";

interface ExportDialogProps {
  assetIds: string[];
  onClose: () => void;
}

type Phase = "config" | "working" | "ready" | "error";

const LANGS: { key: ArtboardSettings["captionLang"]; label: string }[] = [
  { key: "en", label: "EN" },
  { key: "uk", label: "UK" },
  { key: "ru", label: "RU" },
];
const STYLES: { key: ArtboardSettings["captionStyle"]; label: string }[] = [
  { key: "social", label: "Social" },
  { key: "agency", label: "Agency" },
  { key: "archival", label: "Archival" },
];

const CARD: React.CSSProperties = {
  background: "var(--bg-el)",
  border: "1px solid var(--bd)",
  borderRadius: 4,
  padding: 20,
  width: 380,
  maxWidth: "92vw",
  fontFamily: "inherit",
};
const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--t3)",
  marginBottom: 6,
};

/** Artboard / selection → PDF export dialog (ADR 0035). Configures the layout +
 *  what goes under each photo, POSTs /api/exports, polls the job, then offers
 *  the finished PDF for download. Self-contained: no workspace-hook plumbing
 *  beyond open/close + the selected asset ids. Mounted only while open, so its
 *  state resets naturally each time (the parent gates it with `&&`). */
export default function ExportDialog({ assetIds, onClose }: ExportDialogProps) {
  const [layout, setLayout] = useState<ArtboardSettings["pageLayout"]>("one_per_page");
  const [pageSize, setPageSize] = useState<ArtboardSettings["pageSize"]>("A4");
  const [captionLang, setCaptionLang] = useState<ArtboardSettings["captionLang"]>("en");
  const [captionStyle, setCaptionStyle] = useState<ArtboardSettings["captionStyle"]>("agency");
  const [inc, setInc] = useState({ caption: true, title: true, facts: false, exif: false });
  const [phase, setPhase] = useState<Phase>("config");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const count = assetIds.length;

  const stopPoll = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };

  // Stop polling if the dialog unmounts mid-job (cleanup only — no state writes).
  useEffect(() => stopPoll, []);

  const options: ArtboardSettings = useMemo(
    () => ({ pageLayout: layout, pageSize, orientation: "portrait", captionLang, captionStyle, include: inc }),
    [layout, pageSize, captionLang, captionStyle, inc],
  );

  const start = async () => {
    setPhase("working");
    setErr("");
    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds, options }),
      });
      if (!res.ok) throw new Error("enqueue failed");
      const { jobId } = (await res.json()) as { jobId: string };
      stopPoll();
      poll.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/exports?jobId=${jobId}`);
          if (!r.ok) return;
          const j = (await r.json()) as { status: string; url: string | null };
          if (j.status === "done" && j.url) {
            stopPoll();
            setUrl(j.url);
            setPhase("ready");
          } else if (j.status === "failed" || j.status === "canceled") {
            stopPoll();
            setErr("The export job failed. Please try again.");
            setPhase("error");
          }
        } catch {
          // transient — keep polling
        }
      }, 1500);
    } catch {
      setErr("Couldn't start the export.");
      setPhase("error");
    }
  };

  const seg = (active: boolean): React.CSSProperties => ({
    flex: 1,
    height: 30,
    border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`,
    background: active ? "color-mix(in srgb, var(--ac) 14%, transparent)" : "transparent",
    color: active ? "var(--ac)" : "var(--t2)",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  });

  return (
    <div
      onPointerDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,.5)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div onPointerDown={(e) => e.stopPropagation()} style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--t1)", marginBottom: 2 }}>Export to PDF</div>
        <div style={{ fontSize: 11.5, color: "var(--t3)", marginBottom: 16 }}>
          {count} {count === 1 ? "photo" : "photos"} · each with its caption underneath
        </div>

        {phase === "ready" && url ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--t2)" }}>Your PDF is ready.</div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--ac)",
                color: "#050505",
                borderRadius: 2,
                fontSize: 12,
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Download PDF
            </a>
            <button onClick={onClose} style={{ ...seg(false), height: 32 }}>
              Close
            </button>
          </div>
        ) : phase === "working" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0 4px" }}>
            <div style={{ fontSize: 12, color: "var(--t2)" }}>Rendering your PDF…</div>
            <div style={{ height: 3, background: "var(--bd)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "40%", background: "var(--ac)", animation: "none" }} />
            </div>
            <div style={{ fontSize: 10.5, color: "var(--t3)" }}>This can take a moment for large sets.</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={LABEL}>Layout</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={seg(layout === "one_per_page")} onClick={() => setLayout("one_per_page")}>
                  One per page
                </button>
                <button style={seg(layout === "grid")} onClick={() => setLayout("grid")}>
                  Grid
                </button>
              </div>
            </div>

            <div>
              <div style={LABEL}>Page size</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={seg(pageSize === "A4")} onClick={() => setPageSize("A4")}>
                  A4
                </button>
                <button style={seg(pageSize === "Letter")} onClick={() => setPageSize("Letter")}>
                  Letter
                </button>
              </div>
            </div>

            <div>
              <div style={LABEL}>Caption language / style</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                {LANGS.map((l) => (
                  <button key={l.key} style={seg(captionLang === l.key)} onClick={() => setCaptionLang(l.key)}>
                    {l.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {STYLES.map((s) => (
                  <button key={s.key} style={seg(captionStyle === s.key)} onClick={() => setCaptionStyle(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div style={LABEL}>Under each photo</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(
                  [
                    ["caption", "Caption"],
                    ["title", "Title"],
                    ["facts", "Facts"],
                    ["exif", "EXIF"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    style={{ ...seg(inc[key]), flex: "0 0 auto", padding: "0 12px" }}
                    onClick={() => setInc((p) => ({ ...p, [key]: !p[key] }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {phase === "error" && <div style={{ fontSize: 11, color: "var(--red)" }}>{err}</div>}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={onClose} style={{ ...seg(false), height: 34 }}>
                Cancel
              </button>
              <button
                onClick={start}
                style={{
                  flex: 1,
                  height: 34,
                  border: 0,
                  background: "var(--ac)",
                  color: "#050505",
                  borderRadius: 2,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Export PDF
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
