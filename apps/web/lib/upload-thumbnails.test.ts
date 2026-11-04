import { describe, expect, it, vi } from "vitest";
import {
  UPLOAD_THUMB_EDGE,
  createThumbQueue,
  thumbnailSize,
  type UploadThumb,
} from "./upload-thumbnails";

function file(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

/** A render the test resolves by hand, so it can look inside the gap. */
function deferredRender() {
  const calls: Array<{ file: File; resolve: (thumb: UploadThumb | null) => void }> = [];
  const render = vi.fn(
    (input: File) =>
      new Promise<UploadThumb | null>((resolve) => {
        calls.push({ file: input, resolve });
      }),
  );
  return { render, calls };
}

const thumbFor = (name: string): UploadThumb => ({ url: `blob:${name}`, width: 4032, height: 3024 });
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("thumbnailSize", () => {
  it("fits the long edge to the worker's thumb size", () => {
    expect(thumbnailSize(4032, 3024)).toEqual({ width: UPLOAD_THUMB_EDGE, height: 192 });
    expect(thumbnailSize(3024, 4032)).toEqual({ width: 192, height: UPLOAD_THUMB_EDGE });
  });

  it("never upscales and never collapses a side to zero", () => {
    expect(thumbnailSize(120, 80)).toEqual({ width: 120, height: 80 });
    expect(thumbnailSize(10000, 10)).toEqual({ width: 256, height: 1 });
  });
});

describe("createThumbQueue", () => {
  it("renders one file at a time, in order", async () => {
    const { render, calls } = deferredRender();
    const onThumb = vi.fn();
    const queue = createThumbQueue({ render, isWanted: () => true, onThumb, revoke: vi.fn() });

    queue.enqueue([{ id: "a", file: file("a.jpg") }, { id: "b", file: file("b.jpg") }]);
    queue.enqueue([{ id: "c", file: file("c.jpg") }]);
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
    expect(queue.pending()).toBe(2);

    calls[0].resolve(thumbFor("a"));
    await settle();
    expect(render).toHaveBeenCalledTimes(2);
    expect(calls[1].file.name).toBe("b.jpg");

    calls[1].resolve(thumbFor("b"));
    await settle();
    calls[2].resolve(thumbFor("c"));
    await settle();
    expect(onThumb.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c"]);
    expect(queue.pending()).toBe(0);
  });

  it("skips a tile that left before its turn, without decoding it", async () => {
    const { render, calls } = deferredRender();
    const wanted = new Set(["a", "b"]);
    const onThumb = vi.fn();
    const queue = createThumbQueue({ render, isWanted: (id) => wanted.has(id), onThumb, revoke: vi.fn() });

    queue.enqueue([{ id: "a", file: file("a.jpg") }, { id: "gone", file: file("gone.jpg") }, { id: "b", file: file("b.jpg") }]);
    await settle();
    calls[0].resolve(thumbFor("a"));
    await settle();
    expect(calls.map((call) => call.file.name)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("revokes a thumbnail whose tile left while it was decoding", async () => {
    const { render, calls } = deferredRender();
    const wanted = new Set(["a"]);
    const onThumb = vi.fn();
    const revoke = vi.fn();
    const queue = createThumbQueue({ render, isWanted: (id) => wanted.has(id), onThumb, revoke });

    queue.enqueue([{ id: "a", file: file("a.jpg") }]);
    await settle();
    wanted.delete("a");
    calls[0].resolve(thumbFor("a"));
    await settle();
    expect(onThumb).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith("blob:a");
  });

  it("keeps going after a file that does not decode", async () => {
    const render = vi
      .fn<(input: File) => Promise<UploadThumb | null>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(thumbFor("c"));
    const onThumb = vi.fn();
    const queue = createThumbQueue({ render, isWanted: () => true, onThumb, revoke: vi.fn() });

    queue.enqueue(["a", "b", "c"].map((id) => ({ id, file: file(`${id}.jpg`) })));
    await settle();
    expect(render).toHaveBeenCalledTimes(3);
    expect(onThumb).toHaveBeenCalledWith("c", thumbFor("c"));
  });

  it("clear drops the waiting jobs, revokes the running one, and still accepts new work", async () => {
    const { render, calls } = deferredRender();
    const onThumb = vi.fn();
    const revoke = vi.fn();
    const queue = createThumbQueue({ render, isWanted: () => true, onThumb, revoke });

    queue.enqueue([{ id: "a", file: file("a.jpg") }, { id: "b", file: file("b.jpg") }]);
    await settle();
    queue.clear();
    expect(queue.pending()).toBe(0);
    calls[0].resolve(thumbFor("a"));
    await settle();
    expect(revoke).toHaveBeenCalledWith("blob:a");
    expect(render).toHaveBeenCalledTimes(1);

    queue.enqueue([{ id: "c", file: file("c.jpg") }]);
    await settle();
    calls[1].resolve(thumbFor("c"));
    await settle();
    expect(onThumb).toHaveBeenCalledWith("c", thumbFor("c"));
  });
});
