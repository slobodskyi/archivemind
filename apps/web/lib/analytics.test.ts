import { describe, expect, it } from "vitest";
import {
  MASK_ATTR,
  REDACTED_URL,
  UNMASK_ATTR,
  isUnmasked,
  maskAttribute,
  maskText,
  posthogConfig,
  redactSignedUrls,
} from "./analytics";
import { config as proxyConfig } from "../proxy";

// What @aws-sdk/s3-request-presigner emits for an R2 preview.
const SIGNED =
  "https://acc.r2.cloudflarestorage.com/archivemind/ws1/previews/a1/thumb.webp" +
  "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=KEY%2F20261014%2Fauto%2Fs3%2Faws4_request" +
  "&X-Amz-Date=20261014T000000Z&X-Amz-Expires=3600&X-Amz-Signature=deadbeef&X-Amz-SignedHeaders=host";

/** A stand-in for an element: `markers` is its ancestor chain, nearest first,
 *  as the attribute each carries (or null for an unmarked ancestor). */
function el(...markers: (typeof UNMASK_ATTR | typeof MASK_ATTR | null)[]) {
  return {
    closest: () => {
      const hit = markers.find((m) => m !== null);
      return hit ? ({ hasAttribute: (a: string) => a === hit } as unknown as Element) : null;
    },
    hasAttribute: () => false,
  };
}

describe("redactSignedUrls", () => {
  it("removes a presigned URL from a tile's inline style, quoted or not", () => {
    expect(redactSignedUrls(`background-image: url("${SIGNED}"); width: 40px;`)).toBe(
      `background-image: url("${REDACTED_URL}"); width: 40px;`,
    );
    expect(redactSignedUrls(`background-image: url(${SIGNED})`)).toBe(`background-image: url(${REDACTED_URL})`);
  });

  it("removes every presigned URL in one value", () => {
    const out = redactSignedUrls(`url("${SIGNED}"), url("${SIGNED}")`);
    expect(out).not.toContain("X-Amz-Signature");
    expect(out.split(REDACTED_URL)).toHaveLength(3);
  });

  it("leaves unsigned URLs and plain text alone", () => {
    for (const v of ["/projects/42", "https://www.archivemind.media/?q=1", "translateX(-50%)", "IMG_0042.HEIC"]) {
      expect(redactSignedUrls(v)).toBe(v);
    }
  });
});

describe("text masking", () => {
  it("masks text with no marker at all — private by default", () => {
    expect(maskText("IMG_0042.HEIC", el(null, null))).toBe("*************");
    expect(maskText("Kyiv, Ukraine", undefined)).toBe("***** *******");
  });

  it("keeps text under data-ph-unmask", () => {
    expect(isUnmasked(el(UNMASK_ATTR))).toBe(true);
    expect(maskText("Move 4 to Trash", el(null, UNMASK_ATTR))).toBe("Move 4 to Trash");
  });

  it("lets the nearest marker win, so a mask inside an unmasked bar holds", () => {
    expect(maskText("yoga", el(MASK_ATTR, UNMASK_ATTR))).toBe("****");
    expect(maskText("Regroup", el(UNMASK_ATTR, MASK_ATTR))).toBe("Regroup");
  });

  it("masks text-bearing attributes by the same rule, and scrubs URLs from every attribute", () => {
    expect(maskAttribute("title", "IMG_0042.HEIC", el(null))).toBe("*************");
    expect(maskAttribute("aria-label", "Delete", el(UNMASK_ATTR))).toBe("Delete");
    expect(maskAttribute("href", SIGNED, el(UNMASK_ATTR))).toBe(REDACTED_URL);
    expect(maskAttribute("class", "am-bar am-bar-low", el(null))).toBe("am-bar am-bar-low");
  });
});

describe("posthogConfig", () => {
  const cfg = posthogConfig();
  const rec = cfg.session_recording!;

  it("talks to PostHog EU through the same-origin proxy", () => {
    expect(cfg.api_host).toBe("/ingest");
    expect(cfg.ui_host).toBe("https://eu.posthog.com");
  });

  it("masks all text and inputs, and records no request headers or bodies", () => {
    expect(rec.maskTextSelector).toBe("*");
    expect(rec.maskAllInputs).toBe(true);
    expect(rec.recordHeaders).toBe(false);
    expect(rec.recordBody).toBe(false);
  });

  it("keeps autocapture off — it ships clicked text outside the replay mask", () => {
    expect(cfg.autocapture).toBe(false);
  });

  it("scrubs signatures from recorded network requests", () => {
    const req = rec.maskCapturedNetworkRequestFn!({ name: SIGNED } as never);
    expect(req?.name).toBe(REDACTED_URL);
  });
});

describe("proxy matcher", () => {
  const matcher = new RegExp(`^${proxyConfig.matcher[0]}$`);

  it("skips the PostHog reverse proxy", () => {
    expect(matcher.test("/ingest/e/")).toBe(false);
    expect(matcher.test("/ingest/static/recorder.js")).toBe(false);
  });

  it("still guards the app", () => {
    expect(matcher.test("/projects/42")).toBe(true);
    expect(matcher.test("/")).toBe(true);
  });
});
