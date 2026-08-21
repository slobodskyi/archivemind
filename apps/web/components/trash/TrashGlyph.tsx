import type { TrashItem } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";

/** What a trashed thing looks like when there is no thumbnail to show — which
 *  is every kind except a photo, and a photo whose previews never rendered.
 *  Drawn from the item itself rather than a `kind` string so a Workspace keeps
 *  its own colour here, the way it does on its chip. */
export default function TrashGlyph({ item, size = 22 }: { item: TrashItem; size?: number }) {
  const stroke = item.kind === "workspace" && item.color ? LABEL_COLORS[item.color] : "var(--t3)";
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (item.kind === "project") {
    return (
      <svg {...props} aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    );
  }
  if (item.kind === "workspace") {
    return (
      <svg {...props} aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18" />
        <circle cx="6" cy="6.5" r=".9" fill={stroke} stroke="none" />
      </svg>
    );
  }
  if (item.kind === "draft") {
    return (
      <svg {...props} aria-hidden="true">
        <path d="M5 3h9l5 5v13H5z" />
        <path d="M14 3v5h5M8 13h8M8 17h5" />
      </svg>
    );
  }
  if (item.assetKind === "pdf" || item.assetKind === "document") {
    return (
      <svg {...props} aria-hidden="true">
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    );
  }
  if (item.assetKind === "other") {
    return (
      <svg {...props} aria-hidden="true">
        <path d="M6 3h8l4 4v14H6z" />
        <path d="M14 3v4h4" />
      </svg>
    );
  }
  return (
    <svg {...props} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l5-4 4 3 3-2 4 3" />
    </svg>
  );
}
