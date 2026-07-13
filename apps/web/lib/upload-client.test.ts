import { SINGLE_PUT_MAX_BYTES } from "@archivemind/shared";
import { describe, expect, it } from "vitest";
import { uploadCandidates } from "./upload-client";

function file(name: string, size = 1): File {
  return new File([new Uint8Array(size)], name, { type: "image/jpeg" });
}

describe("uploadCandidates", () => {
  it("keeps original input indexes while filtering invalid files", () => {
    const oversized = file("oversized.jpg");
    Object.defineProperty(oversized, "size", { value: SINGLE_PUT_MAX_BYTES + 1 });
    const files = [file("valid-a.jpg"), file("empty.jpg", 0), oversized, file("valid-b.jpg")];

    expect(uploadCandidates(files).map((item) => item.inputIndex)).toEqual([0, 3]);
  });

  it("caps one completion batch at the API contract limit", () => {
    const files = Array.from({ length: 501 }, (_, index) => file(`${index}.jpg`));
    const candidates = uploadCandidates(files);

    expect(candidates).toHaveLength(500);
    expect(candidates[499].inputIndex).toBe(499);
  });
});
