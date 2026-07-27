import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { crc32 } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { ZIP_MAX_ENTRIES, buildZip, uniqueEntryName } from "./zip";

const run = promisify(execFile);
const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Structural sanity via the system `unzip` — a hand-rolled container that only
 *  our own reader accepts would be worthless. ASCII names only: Info-ZIP 6.0 on
 *  macOS is built without UNICODE_SUPPORT, so it transliterates non-ASCII to "?"
 *  and then cannot even create the file. That is its limitation, not the
 *  archive's — Python's spec-compliant zipfile below is the oracle for names. */
async function unzipList(zip: Buffer): Promise<string> {
  const { stdout } = await run("unzip", ["-l", await writeZip(zip)]);
  return stdout;
}

async function writeZip(zip: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "am-zip-"));
  dirs.push(dir);
  const path = join(dir, "a.zip");
  await writeFile(path, zip);
  return path;
}

interface Inspection {
  names: string[];
  /** null = every entry's stored CRC matches its bytes. */
  badEntry: string | null;
  methods: number[];
}

/** Read the archive with Python's zipfile: it honours the UTF-8 flag properly and
 *  `testzip()` re-checks the CRC of every entry, so this verifies the container
 *  independently of our own writer. */
async function inspect(zip: Buffer): Promise<Inspection> {
  const path = await writeZip(zip);
  const { stdout } = await run("python3", [
    "-c",
    [
      "import json,sys,zipfile",
      "z=zipfile.ZipFile(sys.argv[1])",
      "print(json.dumps({'names':z.namelist(),'badEntry':z.testzip(),'methods':[i.compress_type for i in z.infolist()]}))",
    ].join("\n"),
    path,
  ]);
  return JSON.parse(stdout) as Inspection;
}

async function readEntry(zip: Buffer, name: string): Promise<Buffer> {
  const path = await writeZip(zip);
  const { stdout } = await run(
    "python3",
    ["-c", "import sys,zipfile;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))", path, name],
    { encoding: "buffer" },
  );
  return stdout as unknown as Buffer;
}

describe("buildZip", () => {
  const now = new Date("2026-07-27T12:34:56Z");

  it("produces an archive the system unzip accepts, with no errors", async () => {
    const zip = buildZip(
      [
        { name: "one.txt", body: Buffer.from("hello") },
        { name: "two.bin", body: Buffer.from([0, 1, 2, 255, 254]) },
      ],
      now,
    );
    const listing = await unzipList(zip);
    expect(listing).toContain("one.txt");
    expect(listing).toContain("two.bin");
    // `unzip -l` prints "2 files" on a well-formed archive.
    expect(listing).toMatch(/2 files/);
    // ...and every stored CRC matches its bytes.
    const seen = await inspect(zip);
    expect(seen.names).toEqual(["one.txt", "two.bin"]);
    expect(seen.badEntry).toBeNull();
    expect(seen.methods).toEqual([0, 0]); // STORE, not deflate
  });

  it("round-trips binary payloads byte for byte", async () => {
    const body = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) % 256));
    const zip = buildZip([{ name: "blob.bin", body }], now);
    expect(await readEntry(zip, "blob.bin")).toEqual(body);
  });

  it("keeps Cyrillic filenames intact through a real extraction", async () => {
    const name = "Одеса 2026.jpg";
    const zip = buildZip([{ name, body: Buffer.from("x") }], now);
    // Bit 11 of the general purpose flags, at offset 6 of the local header.
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
    // Extract and read the directory rather than parsing `unzip -l`: Info-ZIP
    // prints "?" for non-ASCII in its own listing regardless of the flag, so the
    // listing would test its console encoding, not the archive.
    const seen = await inspect(zip);
    expect(seen.names).toContain(name);
    expect(seen.badEntry).toBeNull();
  });

  it("stores rather than deflates, and records a real CRC", () => {
    const body = Buffer.from("a".repeat(1000));
    const zip = buildZip([{ name: "a.txt", body }], now);
    expect(zip.readUInt16LE(8)).toBe(0); // method 0 = STORE
    expect(zip.readUInt32LE(14)).toBe(crc32(body));
    // Compressed size equals uncompressed — nothing was compressed away.
    expect(zip.readUInt32LE(18)).toBe(body.length);
    expect(zip.readUInt32LE(22)).toBe(body.length);
  });

  it("writes an empty but valid archive for no entries", async () => {
    const zip = buildZip([], now);
    expect(zip).toHaveLength(22); // EOCD only
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
  });

  it("refuses a duplicate name instead of emitting an ambiguous archive", () => {
    expect(() => buildZip([
      { name: "a.jpg", body: Buffer.from("1") },
      { name: "a.jpg", body: Buffer.from("2") },
    ])).toThrow(/zip_duplicate_name/);
  });

  it("refuses more entries than the non-Zip64 central directory can address", () => {
    const entries = Array.from({ length: ZIP_MAX_ENTRIES + 1 }, (_, i) => ({
      name: `f${i}`,
      body: Buffer.alloc(0),
    }));
    // A silently truncated archive is the worst failure for a deliverable.
    expect(() => buildZip(entries)).toThrow(/zip_too_many_entries/);
  });
});

describe("uniqueEntryName", () => {
  it("passes an ordinary name through", () => {
    expect(uniqueEntryName("DSC_0001.jpg", new Set())).toBe("DSC_0001.jpg");
  });

  it("disambiguates collisions before the extension", () => {
    const taken = new Set<string>();
    expect(uniqueEntryName("a.jpg", taken)).toBe("a.jpg");
    expect(uniqueEntryName("a.jpg", taken)).toBe("a (2).jpg");
    expect(uniqueEntryName("a.jpg", taken)).toBe("a (3).jpg");
  });

  it("strips path separators and leading dots so no entry escapes the archive", () => {
    expect(uniqueEntryName("../../etc/passwd", new Set())).toBe(".._.._etc_passwd".replace(/^\.+/, ""));
    expect(uniqueEntryName("a/b\\c.jpg", new Set())).toBe("a_b_c.jpg");
  });

  it("falls back to a name for empty or whitespace input", () => {
    expect(uniqueEntryName("   ", new Set())).toBe("file");
    expect(uniqueEntryName("", new Set())).toBe("file");
  });

  it("bounds the length", () => {
    expect(uniqueEntryName("x".repeat(500), new Set())).toHaveLength(180);
  });
});
