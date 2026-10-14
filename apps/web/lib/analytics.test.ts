import { describe, expect, it } from "vitest";
import {
  MASK_ATTR,
  REDACTED_URL,
  REPLAY_MASK_TEXT,
  UNMASK_ATTR,
  isUnmasked,
  maskAttribute,
  maskText,
  posthogConfig,
  redactSignedUrls,
  rewriteSignedUrls,
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

describe("rewriteSignedUrls", () => {
  const replay = { origin: "https://www.archivemind.media", token: "1800000000.sig" };

  it("points a presigned URL at /api/replay-image, with the path and no signature", () => {
    const out = rewriteSignedUrls(`background-image: url("${SIGNED}")`, replay);
    expect(out).toBe(
      'background-image: url("https://www.archivemind.media/api/replay-image' +
        "?p=%2Farchivemind%2Fws1%2Fpreviews%2Fa1%2Fthumb.webp&t=1800000000.sig\")",
    );
    expect(out).not.toContain("X-Amz-");
  });

  it("blanks the URL when no replay token was issued", () => {
    expect(rewriteSignedUrls(SIGNED, null)).toBe(REDACTED_URL);
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

  it("masks text-bearing attributes by the same rule when masking is on", () => {
    expect(maskAttribute("title", "IMG_0042.HEIC", el(null), true)).toBe("*************");
    expect(maskAttribute("aria-label", "Delete", el(UNMASK_ATTR), true)).toBe("Delete");
    expect(maskAttribute("class", "am-bar am-bar-low", el(null), true)).toBe("am-bar am-bar-low");
  });

  it("leaves text-bearing attributes readable when masking is off", () => {
    expect(maskAttribute("title", "IMG_0042.HEIC", el(null), false)).toBe("IMG_0042.HEIC");
  });

  it("scrubs presigned URLs from every attribute in BOTH modes", () => {
    for (const on of [true, false]) {
      expect(maskAttribute("href", SIGNED, el(UNMASK_ATTR), on)).toBe(REDACTED_URL);
      expect(maskAttribute("style", `background-image: url("${SIGNED}")`, el(null), on)).toBe(
        `background-image: url("${REDACTED_URL}")`,
      );
    }
  });
});

describe("posthogConfig", () => {
  const cfg = posthogConfig();
  const rec = cfg.session_recording!;

  it("talks to PostHog EU through the same-origin proxy", () => {
    expect(cfg.api_host).toBe("/ingest");
    expect(cfg.ui_host).toBe("https://eu.posthog.com");
  });

  it("records text and inputs as-is during internal testing", () => {
    // Flip REPLAY_MASK_TEXT before the first external user (ADR 0050 amendment).
    expect(REPLAY_MASK_TEXT).toBe(false);
    expect(rec.maskAllInputs).toBe(false);
    expect(rec.maskTextSelector).toBeUndefined();
  });

  it("masks all text and inputs when the switch is on", () => {
    const masked = posthogConfig({ maskTextOn: true }).session_recording!;
    expect(masked.maskTextSelector).toBe("*");
    expect(masked.maskAllInputs).toBe(true);
  });

  it("records no request headers or bodies", () => {
    expect(rec.recordHeaders).toBe(false);
    expect(rec.recordBody).toBe(false);
  });

  it("keeps autocapture off — it ships clicked text outside the replay mask", () => {
    expect(cfg.autocapture).toBe(false);
  });

  it("records no console output, whatever the project setting says", () => {
    expect(cfg.enable_recording_console_log).toBe(false);
  });

  it("hands photos to the replay only while text masking is off", () => {
    const replayImages = { origin: "https://www.archivemind.media", token: "t" };
    const open = posthogConfig({ maskTextOn: false, replayImages }).session_recording!;
    const shut = posthogConfig({ maskTextOn: true, replayImages }).session_recording!;
    expect(open.maskAttributeFn!("src", SIGNED, undefined as never)).toContain("/api/replay-image?");
    expect(shut.maskAttributeFn!("src", SIGNED, undefined as never)).toBe(REDACTED_URL);
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

  it("leaves the token-guarded replay image route public", async () => {
    const { isPublicPath } = await import("../proxy");
    expect(isPublicPath("/api/replay-image")).toBe(true);
    expect(isPublicPath("/api/assets/1/medium")).toBe(false);
  });

  it("still guards the app", () => {
    expect(matcher.test("/projects/42")).toBe(true);
    expect(matcher.test("/")).toBe(true);
  });
});
