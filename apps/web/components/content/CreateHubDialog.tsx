"use client";

import type { CSSProperties } from "react";
import type { ContentDraft } from "@/lib/content-drafts";
import { sourcesChanged } from "@/lib/content-drafts";
import { photoSrc } from "@/lib/img";
import Dialog from "@/components/modals/Dialog";
import type { Photo } from "@/types";

interface CreateHubDialogProps {
  open: boolean;
  boardName: string;
  drafts: ContentDraft[];
  currentAssetIds: string[];
  /** The workspace's loaded photos — draft covers look their thumbnails up. */
  photos: readonly Photo[];
  onClose: () => void;
  onPickKind: (kind: "article" | "instagram_carousel") => void;
  onOpenDraft: (draft: ContentDraft) => void;
}

const sectionLabel = {
  display: "block",
  margin: "18px 0 8px",
  color: "var(--t3)",
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: ".08em",
  textTransform: "uppercase",
} as const;

/** The outcome glyphs. One visual language, twice: the glyph on a format card
 * is the same shape its drafts' covers take below — a page for an article, an
 * offset deck for a carousel — so the hub explains itself without a legend. */
function PageGlyph() {
  return (
    <svg width="22" height="28" viewBox="0 0 22 28" fill="none" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <rect x="1" y="1" width="20" height="26" rx="2" stroke="var(--t2)" strokeWidth="1.5" />
      <rect x="4.5" y="5" width="13" height="9" rx="1" fill="var(--t3)" opacity=".6" />
      <rect x="4.5" y="17.5" width="13" height="2" rx="1" fill="var(--t3)" />
      <rect x="4.5" y="21.5" width="9" height="2" rx="1" fill="var(--t3)" />
    </svg>
  );
}

function DeckGlyph() {
  return (
    <svg width="30" height="28" viewBox="0 0 30 28" fill="none" aria-hidden="true" style={{ flex: "0 0 auto" }}>
      <rect x="11.75" y="2.75" width="17.5" height="22.5" rx="2" stroke="var(--t2)" strokeWidth="1.5" opacity=".25" />
      <rect x="6.75" y="2.75" width="17.5" height="22.5" rx="2" fill="var(--bg-el)" stroke="var(--t2)" strokeWidth="1.5" opacity=".55" />
      <rect x="1.75" y="2.75" width="17.5" height="22.5" rx="2" fill="var(--bg-el)" stroke="var(--t2)" strokeWidth="1.5" />
    </svg>
  );
}

/** A draft's identity is its imagery; its kind is a shape. An article cover is
 * a page — photo above, text lines below; a carousel cover is a deck — the
 * first slide in front, the next two fanned behind, pager dots underneath.
 * With no thumbnail to show yet, the cover falls back to the kind's glyph. */
function DraftCover({ draft, photos }: { draft: ContentDraft; photos: readonly Photo[] }) {
  const placedIds = draft.kind === "article"
    ? draft.content.sections.flatMap((section) => section.assetIds)
    : draft.content.slides.flatMap((slide) => (slide.assetId ? [slide.assetId] : []));
  const coverIds = (placedIds.length ? placedIds : draft.sourceSnapshot.assetIds).slice(0, 3);
  const coverPhotos = coverIds.map((assetId) => photos.find((photo) => photo.id === assetId) ?? null);
  const front = coverPhotos[0];

  if (!front) {
    return (
      <span style={{ width: 52, height: 56, display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto", background: "var(--bg)", border: "1px solid var(--bd)", borderRadius: 1 }}>
        {draft.kind === "article" ? <PageGlyph /> : <DeckGlyph />}
      </span>
    );
  }

  if (draft.kind === "article") {
    return (
      <span style={{ width: 44, height: 56, display: "flex", flexDirection: "column", overflow: "hidden", flex: "0 0 auto", background: "var(--bg-in)", border: "1px solid var(--bdh)", borderRadius: 1 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoSrc(front, 88, 80)} alt="" style={{ width: "100%", flex: 1, minHeight: 0, display: "block", objectFit: "cover" }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2.5, padding: "4px 5px 5px" }}>
          <span style={{ display: "block", height: 2, background: "rgba(236,238,232,.22)", borderRadius: 1 }} />
          <span style={{ display: "block", height: 2, width: "60%", background: "rgba(236,238,232,.22)", borderRadius: 1 }} />
        </span>
      </span>
    );
  }

  const backCard = (index: 1 | 2): CSSProperties => ({
    position: "absolute",
    top: 2,
    left: 0,
    width: 40,
    height: 48,
    overflow: "hidden",
    background: "var(--bg-in)",
    border: "1px solid var(--bdh)",
    borderRadius: 1,
    transform: `translateX(${index * 5}px)`,
    opacity: index === 1 ? 0.5 : 0.25,
  });
  return (
    <span style={{ position: "relative", display: "block", width: 52, height: 56, flex: "0 0 auto" }}>
      {([2, 1] as const).map((index) => (
        <span key={index} style={backCard(index)}>
          {coverPhotos[index] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoSrc(coverPhotos[index], 80, 96)} alt="" style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />
          ) : null}
        </span>
      ))}
      <span style={{ position: "absolute", top: 2, left: 0, width: 40, height: 48, overflow: "hidden", background: "var(--bg-in)", border: "1px solid var(--bdh)", borderRadius: 1 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoSrc(front, 80, 96)} alt="" style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />
      </span>
      <span style={{ position: "absolute", left: 12, bottom: 0, display: "flex", gap: 3 }} aria-hidden="true">
        <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--t1)" }} />
        <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--t3)" }} />
        <span style={{ width: 3, height: 3, borderRadius: "50%", background: "var(--t3)" }} />
      </span>
    </span>
  );
}

/** The single entry into making content from a Workspace (ADR 0045 as
 * amended): pick an outcome, or continue a saved draft. It replaced the
 * separate DRAFTS and CREATE buttons — the library IS where creating starts,
 * which its own "+ Create" header button had already admitted. */
export default function CreateHubDialog({
  open,
  boardName,
  drafts,
  currentAssetIds,
  photos,
  onClose,
  onPickKind,
  onOpenDraft,
}: CreateHubDialogProps) {
  const canCreate = currentAssetIds.length > 0;
  return (
    <Dialog
      open={open}
      size="l"
      kicker="Create"
      title={boardName}
      subtitle="Turn this Workspace's files into something publishable. Every generated word stays editable."
      onClose={onClose}
      bodyStyle={{ padding: "16px 20px 20px" }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {([
          ["article", "Article", "Narrative copy with ordered images"],
          ["instagram_carousel", "Instagram carousel", "Phone-sized story sequence + caption"],
        ] as const).map(([value, label, help], index) => (
          <button
            key={value}
            data-autofocus={index === 0 ? "" : undefined}
            onClick={() => onPickKind(value)}
            disabled={!canCreate}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 14px",
              textAlign: "left",
              background: "var(--bg-el)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              cursor: canCreate ? "pointer" : "default",
              opacity: canCreate ? 1 : 0.45,
              fontFamily: "inherit",
            }}
          >
            {value === "article" ? <PageGlyph /> : <DeckGlyph />}
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", color: "var(--t1)", fontSize: 13, fontWeight: 700 }}>{label}</span>
              <span style={{ display: "block", marginTop: 4, color: "var(--t3)", fontSize: 10.5 }}>{help}</span>
            </span>
          </button>
        ))}
      </div>
      {!canCreate && (
        <div style={{ marginTop: 8, color: "var(--t3)", fontSize: 10.5 }}>
          This Workspace has no files yet — add some to create from them.
        </div>
      )}

      {drafts.length > 0 && (
        <>
          <span style={sectionLabel}>Continue editing</span>
          {drafts.map((draft) => {
            const changed = sourcesChanged(draft.sourceSnapshot, currentAssetIds);
            const kindLabel = draft.kind === "article" ? "Article" : "Carousel";
            const countLabel = draft.kind === "article"
              ? `${draft.sourceSnapshot.assetIds.length} ${draft.sourceSnapshot.assetIds.length === 1 ? "source" : "sources"}`
              : `${draft.content.slides.length} ${draft.content.slides.length === 1 ? "slide" : "slides"}`;
            return (
              <button
                key={draft.id}
                onClick={() => onOpenDraft(draft)}
                style={{ width: "100%", display: "grid", gridTemplateColumns: "56px 1fr auto", alignItems: "center", gap: 12, marginBottom: 6, padding: "10px 12px", background: "var(--bg-el)", border: "1px solid var(--bd)", borderRadius: 2, color: "inherit", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}
              >
                <DraftCover draft={draft} photos={photos} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t1)", fontSize: 12.5, fontWeight: 700 }}>{draft.name}</span>
                  <span style={{ display: "block", marginTop: 4, color: "var(--t3)", fontSize: 10.5 }}>
                    <span style={{ color: "var(--t2)" }}>{kindLabel}</span> · {countLabel} · edited {new Date(draft.updatedAt).toLocaleDateString()}
                  </span>
                </span>
                {changed ? <span style={{ padding: "4px 6px", background: "rgba(255,184,77,.1)", border: "1px solid rgba(255,184,77,.35)", color: "#ffbd66", fontSize: 9.5, whiteSpace: "nowrap" }}>Sources changed</span> : <span style={{ color: "var(--t3)", fontSize: 15 }}>›</span>}
              </button>
            );
          })}
        </>
      )}
    </Dialog>
  );
}
