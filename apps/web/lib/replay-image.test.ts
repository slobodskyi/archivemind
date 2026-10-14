import { describe, expect, it } from "vitest";
import { REPLAY_IMAGE_TOKEN_TTL_S, mintReplayImageToken, verifyReplayImageRequest } from "./replay-image";

const SECRET = "test-secret";
const BUCKET = "archivemind";
const NOW = 1_800_000_000;
const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

const preview = (ws: string, dir = "previews", file = "thumb.webp") => `/${BUCKET}/${ws}/${dir}/${ASSET}/${file}`;
const mint = (ws = WS, now = NOW) => mintReplayImageToken(ws, now, SECRET)!;
const verify = (path: string | null, token: string | null, now = NOW) =>
  verifyReplayImageRequest(path, token, BUCKET, now, SECRET);

describe("mintReplayImageToken", () => {
  it("mints nothing without a secret — the feature is off", () => {
    expect(mintReplayImageToken(WS, NOW, undefined)).toBeNull();
    expect(mintReplayImageToken(WS, NOW, "")).toBeNull();
  });

  it("expires after the replay retention window", () => {
    expect(mint().split(".")[0]).toBe(String(NOW + REPLAY_IMAGE_TOKEN_TTL_S));
  });
});

describe("verifyReplayImageRequest", () => {
  it("opens a preview or an edited preview of the token's own workspace", () => {
    expect(verify(preview(WS), mint())).toBe(`${WS}/previews/${ASSET}/thumb.webp`);
    expect(verify(preview(WS, "edits", "medium.webp"), mint())).toBe(`${WS}/edits/${ASSET}/medium.webp`);
  });

  it("refuses another workspace's photos", () => {
    expect(verify(preview(OTHER_WS), mint(WS))).toBeNull();
  });

  it("refuses anything that is not a preview — originals, exports, traversal", () => {
    const token = mint();
    for (const path of [
      `/${BUCKET}/${WS}/originals/${ASSET}/IMG_0042.HEIC`,
      `/${BUCKET}/${WS}/exports/${ASSET}.pdf`,
      `/${BUCKET}/${WS}/previews/${ASSET}/../../originals/x.webp`,
      `/${BUCKET}/${WS}/previews/${ASSET}/thumb.jpg`,
      `/other-bucket/${WS}/previews/${ASSET}/thumb.webp`,
      `${WS}/previews/${ASSET}/thumb.webp`,
    ]) {
      expect(verify(path, token)).toBeNull();
    }
  });

  it("refuses an expired, forged or missing token", () => {
    expect(verify(preview(WS), mint(WS, NOW - REPLAY_IMAGE_TOKEN_TTL_S - 1))).toBeNull();
    const [exp] = mint().split(".");
    expect(verify(preview(WS), `${exp}.AAAA`)).toBeNull();
    expect(verify(preview(WS), `${Number(exp) + 1}.${mint().split(".")[1]}`)).toBeNull();
    expect(verify(preview(WS), null)).toBeNull();
    expect(verify(null, mint())).toBeNull();
  });

  it("refuses everything when the secret is unset or rotated", () => {
    const token = mint();
    expect(verifyReplayImageRequest(preview(WS), token, BUCKET, NOW, undefined)).toBeNull();
    expect(verifyReplayImageRequest(preview(WS), token, BUCKET, NOW, "rotated")).toBeNull();
  });
});
