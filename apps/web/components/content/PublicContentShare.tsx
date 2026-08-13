"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  serializePublicationText,
  type PublicationShareAsset,
  type PublicPublicationShare,
} from "@/lib/publication-shares";

interface PublicContentShareProps {
  share: PublicPublicationShare;
  rawToken: string;
}

const MONO = "var(--font-space-mono), var(--font-mono-cy), monospace";

const compactButton: CSSProperties = {
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  padding: "0 12px",
  border: "1px solid var(--bdh)",
  borderRadius: 2,
  background: "rgba(8,8,8,.78)",
  color: "var(--t1)",
  fontFamily: MONO,
  fontSize: 10.5,
  fontWeight: 700,
  textDecoration: "none",
  cursor: "pointer",
};

function fallbackCopy(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  field.style.pointerEvents = "none";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  return copied;
}

function CopyTextButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else if (!fallbackCopy(text)) {
        throw new Error("Clipboard unavailable");
      }
      setState("copied");
    } catch {
      setState("error");
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 2_500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      style={{ ...compactButton, borderColor: "transparent", background: "var(--ac)", color: "#050505" }}
    >
      {state === "copied" ? "Copied" : state === "error" ? "Copy failed" : "Copy text"}
      <span aria-hidden="true">{state === "copied" ? "✓" : "⧉"}</span>
    </button>
  );
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

function safeLink(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const INLINE_MARKS = /(\*\*[^*\n]+\*\*|_[^_\n]+_|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;
const INLINE_LINK = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/;
const BULLET_LINE = /^\s*[-*]\s+(.+)$/;
const NUMBER_LINE = /^\s*\d+\.\s+(.+)$/;

/** Minimal editor syntax rendered as React nodes. React escapes every text
 * fragment, and links pass an explicit protocol allow-list; shared copy never
 * becomes an HTML execution boundary. */
function InlineText({ text }: { text: string }) {
  const parts = text.split(INLINE_MARKS);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("_") && part.endsWith("_")) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        const link = INLINE_LINK.exec(part);
        const href = link ? safeLink(link[2]) : null;
        if (link && href) {
          return (
            <a key={index} href={href} target="_blank" rel="noreferrer nofollow noopener">
              {link[1]}
            </a>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

type TextBlock =
  | { kind: "paragraph"; lines: string[] }
  | { kind: "heading"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let listOrdered: boolean | null = null;
  let listItems: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };
  const flushList = () => {
    if (listOrdered !== null && listItems.length) {
      blocks.push({ kind: "list", ordered: listOrdered, items: listItems });
    }
    listOrdered = null;
    listItems = [];
  };

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = BULLET_LINE.exec(line);
    const number = NUMBER_LINE.exec(line);
    if (bullet || number) {
      flushParagraph();
      const ordered = Boolean(number);
      if (listOrdered !== null && listOrdered !== ordered) flushList();
      listOrdered = ordered;
      listItems.push((bullet ?? number)?.[1] ?? "");
      continue;
    }
    flushList();
    if (line.startsWith("### ")) {
      flushParagraph();
      blocks.push({ kind: "heading", text: line.slice(4) });
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      blocks.push({ kind: "quote", text: line.slice(2) });
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function RichText({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="public-share-richtext">
      {textBlocks(text).map((block, index) => {
        if (block.kind === "heading") return <h3 key={index}><InlineText text={block.text} /></h3>;
        if (block.kind === "quote") return <blockquote key={index}><InlineText text={block.text} /></blockquote>;
        if (block.kind === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return <Tag key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}><InlineText text={item} /></li>)}</Tag>;
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                <InlineText text={line} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function qualityLabel(asset: PublicationShareAsset): string {
  return asset.downloadQuality === "original" ? "Original file" : "Web-size · up to 1024px";
}

function assetHref(rawToken: string, publicId: string): string {
  return `/p/${encodeURIComponent(rawToken)}/media/${encodeURIComponent(publicId)}`;
}

/** Pictures are fetched through the token, not through a signature baked into
 * this HTML: a lazily loaded image asks for its bytes minutes after the page
 * was rendered, and a turned-off link must stop answering by then. */
function previewHref(rawToken: string, publicId: string): string {
  return `${assetHref(rawToken, publicId)}/preview`;
}

function DownloadLink({ rawToken, asset }: { rawToken: string; asset: PublicationShareAsset }) {
  return (
    <a
      href={assetHref(rawToken, asset.publicId)}
      rel="noreferrer"
      style={{ ...compactButton, padding: "0 11px", fontSize: 9.5 }}
    >
      <span aria-hidden="true">↓</span>
      {asset.downloadQuality === "original" ? "Download original" : "Download web-size"}
    </a>
  );
}

function MissingMedia() {
  return (
    <div className="public-share-missing-media" role="img" aria-label="Preview unavailable">
      Preview unavailable
    </div>
  );
}

function ArticleFigure({
  media,
  asset,
  rawToken,
  allowDownloads,
}: {
  media: Extract<PublicPublicationShare["snapshot"], { kind: "article" }>["content"]["sections"][number]["media"][number];
  asset: PublicationShareAsset | undefined;
  rawToken: string;
  allowDownloads: boolean;
}) {
  const { presentation } = media;
  const aspectRatio = presentation.aspect === "landscape"
    ? "16 / 9"
    : presentation.aspect === "portrait"
      ? "4 / 5"
      : presentation.aspect === "square"
        ? "1 / 1"
        : asset?.width && asset.height
          ? `${asset.width} / ${asset.height}`
          : "4 / 3";
  const align = presentation.width === "wide" || presentation.width === "full" ? "center" : presentation.alignment;

  return (
    <figure className={`public-share-figure public-share-width-${presentation.width} public-share-align-${align}`}>
      <div className="public-share-image-frame" style={{ aspectRatio }}>
        {asset ? (
          // Share media must not enter Next's persistent image cache: a revoked
          // link has to stop resolving on the next request, not on a TTL.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewHref(rawToken, asset.publicId)}
            alt={media.altText || media.caption || asset.filename}
            width={asset.width ?? undefined}
            height={asset.height ?? undefined}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              objectFit: presentation.aspect === "original" ? "contain" : presentation.fit,
              objectPosition: `${presentation.focalPoint.x * 100}% ${presentation.focalPoint.y * 100}%`,
            }}
          />
        ) : <MissingMedia />}
      </div>
      {media.caption || (asset && allowDownloads) ? (
        <figcaption className="public-share-figure-caption">
          {media.caption ? <span>{media.caption}</span> : <span />}
          {asset && allowDownloads ? <DownloadLink rawToken={rawToken} asset={asset} /> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function ArticlePublication({
  share,
  assets,
  rawToken,
}: {
  share: PublicPublicationShare & { snapshot: Extract<PublicPublicationShare["snapshot"], { kind: "article" }> };
  assets: ReadonlyMap<string, PublicationShareAsset>;
  rawToken: string;
}) {
  const { content } = share.snapshot;
  return (
    <article className="public-share-article">
      <header className="public-share-article-lead">
        <div className="public-share-kicker">Shared article</div>
        <h1>{content.title || share.name}</h1>
        {content.dek ? <p className="public-share-dek">{content.dek}</p> : null}
        <div className="public-share-rule" />
        <RichText text={content.intro} />
      </header>

      {content.sections.map((section, index) => (
        <section key={section.id} className="public-share-article-section">
          <div className="public-share-section-label">Section {index + 1}</div>
          {section.heading ? <h2>{section.heading}</h2> : null}
          <RichText text={section.body} />
          {section.media.map((media) => (
            <ArticleFigure
              key={media.publicAssetId}
              media={media}
              asset={assets.get(media.publicAssetId)}
              rawToken={rawToken}
              allowDownloads={share.allowDownloads}
            />
          ))}
        </section>
      ))}

      {content.socialExcerpt ? (
        <aside className="public-share-excerpt">
          <div className="public-share-kicker">Social excerpt</div>
          <RichText text={content.socialExcerpt} />
        </aside>
      ) : null}
    </article>
  );
}

function CarouselImage({
  asset,
  rawToken,
  headline,
  body,
  aspectRatio,
  presentation,
}: {
  asset: PublicationShareAsset | undefined;
  rawToken: string;
  headline: string;
  body: string;
  aspectRatio: "4:5" | "1:1";
  presentation: { fit: "cover" | "contain"; focalPoint: { x: number; y: number } };
}) {
  return (
    <div className="public-share-carousel-image" style={{ aspectRatio: aspectRatio === "4:5" ? "4 / 5" : "1 / 1" }}>
      {asset ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewHref(rawToken, asset.publicId)}
          alt={headline || asset.filename}
          width={asset.width ?? undefined}
          height={asset.height ?? undefined}
          decoding="async"
          referrerPolicy="no-referrer"
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: presentation.fit,
            objectPosition: `${presentation.focalPoint.x * 100}% ${presentation.focalPoint.y * 100}%`,
          }}
        />
      ) : (
        <div className="public-share-text-slide">
          {headline ? <strong>{headline}</strong> : null}
          {body ? <span>{body}</span> : null}
        </div>
      )}
    </div>
  );
}

function CarouselPublication({
  share,
  assets,
  rawToken,
}: {
  share: PublicPublicationShare & { snapshot: Extract<PublicPublicationShare["snapshot"], { kind: "instagram_carousel" }> };
  assets: ReadonlyMap<string, PublicationShareAsset>;
  rawToken: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const { content } = share.snapshot;
  const activeSlide = content.slides[Math.min(activeIndex, Math.max(0, content.slides.length - 1))];
  const activeAsset = activeSlide?.publicAssetId ? assets.get(activeSlide.publicAssetId) : undefined;

  return (
    <article className="public-share-carousel">
      <header className="public-share-carousel-lead">
        <div className="public-share-kicker">Instagram carousel · {content.slides.length} slides</div>
        <h1>{share.name}</h1>
      </header>

      {content.slides.length ? (
        <>
          <nav className="public-share-slide-tabs" aria-label="Carousel slides">
            {content.slides.map((slide, index) => {
              const asset = slide.publicAssetId ? assets.get(slide.publicAssetId) : undefined;
              return (
                <button
                  key={slide.id}
                  type="button"
                  aria-current={index === activeIndex ? "step" : undefined}
                  aria-label={`Show slide ${index + 1}${slide.headline ? `: ${slide.headline}` : ""}`}
                  onClick={() => setActiveIndex(index)}
                >
                  <span className="public-share-tab-thumb">
                    {asset ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={previewHref(rawToken, asset.publicId)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                    ) : <span aria-hidden="true">Aa</span>}
                  </span>
                  <span>{index + 1}</span>
                </button>
              );
            })}
          </nav>

          {activeSlide ? (
            <section className="public-share-carousel-stage" aria-live="polite">
              <div>
                <CarouselImage
                  asset={activeAsset}
                  rawToken={rawToken}
                  headline={activeSlide.headline}
                  body={activeSlide.body}
                  aspectRatio={content.aspectRatio}
                  presentation={activeSlide.presentation}
                />
              </div>
              <div className="public-share-slide-copy">
                <div className="public-share-section-label">Slide {activeIndex + 1} of {content.slides.length}</div>
                {activeSlide.headline ? <h2>{activeSlide.headline}</h2> : null}
                <RichText text={activeSlide.body} />
                {activeAsset && share.allowDownloads ? <DownloadLink rawToken={rawToken} asset={activeAsset} /> : null}
                <div className="public-share-slide-arrows">
                  <button
                    type="button"
                    onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
                    disabled={activeIndex === 0}
                    aria-label="Previous slide"
                  >←</button>
                  <button
                    type="button"
                    onClick={() => setActiveIndex((index) => Math.min(content.slides.length - 1, index + 1))}
                    disabled={activeIndex === content.slides.length - 1}
                    aria-label="Next slide"
                  >→</button>
                </div>
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <div className="public-share-empty">This carousel has no slides.</div>
      )}

      {content.caption || content.hashtags.length ? (
        <section className="public-share-post-copy">
          <div className="public-share-kicker">Post copy</div>
          <RichText text={content.caption} />
          {content.hashtags.length ? <p className="public-share-hashtags">{content.hashtags.join(" ")}</p> : null}
        </section>
      ) : null}
    </article>
  );
}

function FilesSection({
  assets,
  rawToken,
}: {
  assets: readonly PublicationShareAsset[];
  rawToken: string;
}) {
  if (!assets.length) return null;
  return (
    <section id="shared-files" className="public-share-files" aria-labelledby="shared-files-title">
      <div className="public-share-files-lead">
        <div>
          <div className="public-share-kicker">Files</div>
          <h2 id="shared-files-title">Publication images</h2>
        </div>
        <p>Download each file at the best quality available in this archive.</p>
      </div>
      <div className="public-share-file-grid">
        {assets.map((asset) => (
          <div key={asset.publicId} className="public-share-file-card">
            <div className="public-share-file-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewHref(rawToken, asset.publicId)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
            </div>
            <div className="public-share-file-meta">
              <strong title={asset.filename}>{asset.filename}</strong>
              <span>{qualityLabel(asset)}</span>
              <DownloadLink rawToken={rawToken} asset={asset} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function RightsFooter({ share }: { share: PublicPublicationShare }) {
  const terms: ReactNode[] = [];
  if (share.rights.creator) terms.push(<span key="creator">Created by {share.rights.creator}</span>);
  if (share.rights.credit) terms.push(<span key="credit">Credit: {share.rights.credit}</span>);
  if (share.rights.copyrightNotice) terms.push(<span key="copyright">{share.rights.copyrightNotice}</span>);
  if (share.rights.usageTerms) terms.push(<span key="terms">Usage: {share.rights.usageTerms}</span>);
  return (
    <footer className="public-share-footer">
      <div>
        <span>Shared {formatDate(share.createdAt)}</span>
        {share.expiresAt ? <span>Link available until {formatDate(share.expiresAt)}</span> : null}
      </div>
      {terms.length ? <div>{terms}</div> : null}
    </footer>
  );
}

export default function PublicContentShare({ share, rawToken }: PublicContentShareProps) {
  const assetsById = useMemo(
    () => new Map(share.assets.map((asset) => [asset.publicId, asset])),
    [share.assets],
  );
  const copy = useMemo(() => serializePublicationText(share.snapshot), [share.snapshot]);
  const label = share.snapshot.kind === "article" ? "Shared article" : "Shared Instagram carousel";

  return (
    <div className="public-share-scroll-root" lang={share.snapshot.language}>
      <header className="public-share-app-header">
        <div className="public-share-header-inner">
          <div className="public-share-brand">
            <strong>ArchiveMind</strong>
            <span aria-hidden="true">/</span>
            <span>{label}</span>
          </div>
          <div className="public-share-header-actions">
            {share.allowDownloads && share.assets.length ? (
              <a href="#shared-files" style={compactButton}>Files {share.assets.length}</a>
            ) : null}
            <CopyTextButton text={copy} />
          </div>
        </div>
      </header>

      <main className="public-share-main">
        {share.snapshot.kind === "article" ? (
          <ArticlePublication
            share={{ ...share, snapshot: share.snapshot }}
            assets={assetsById}
            rawToken={rawToken}
          />
        ) : (
          <CarouselPublication
            share={{ ...share, snapshot: share.snapshot }}
            assets={assetsById}
            rawToken={rawToken}
          />
        )}
        {share.allowDownloads ? <FilesSection assets={share.assets} rawToken={rawToken} /> : null}
        <RightsFooter share={share} />
      </main>
    </div>
  );
}
