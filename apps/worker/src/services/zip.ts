import { crc32 } from "node:zlib";

/** Minimal STORE-only ZIP writer (no dependency).
 *
 *  Why hand-rolled: the monorepo had no zip library at all, and the alternative
 *  (`yazl`/`archiver`) buys deflate we do not want. Every payload here is a
 *  JPEG, HEIC, webp or RAW — already entropy-coded — so compressing costs real
 *  CPU for ~0–2%. STORE also keeps the format trivially correct: sizes and CRCs
 *  are known before the header is written, so there are no data descriptors.
 *  Node 22 ships `zlib.crc32`, which is the only non-trivial piece.
 *
 *  Deliberately NOT Zip64. Zip64 only matters above 4 GiB or 65535 entries, and
 *  an export is capped well below both — but a silently truncated archive is the
 *  worst possible failure for a deliverable, so both limits THROW. */

export interface ZipEntry {
  /** Path inside the archive. Forward slashes; must be unique. */
  name: string;
  body: Buffer;
  /** Modification time stored in the entry. Defaults to now. */
  mtime?: Date;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
/** Bit 11: filename is UTF-8, so Cyrillic names survive. */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const VERSION = 20;

export const ZIP_MAX_ENTRIES = 0xffff;
export const ZIP_MAX_BYTES = 0xffffffff;

/** MS-DOS date/time pair (the format's native, 2-second-resolution stamp). */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Build a ZIP archive in memory. Entry order is preserved. */
export function buildZip(entries: readonly ZipEntry[], now: Date = new Date()): Buffer {
  if (entries.length > ZIP_MAX_ENTRIES) {
    throw new Error(`zip_too_many_entries:${entries.length}`);
  }
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.name)) throw new Error(`zip_duplicate_name:${e.name}`);
    seen.add(e.name);
  }

  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const { time, date } = dosDateTime(entry.mtime ?? now);
    const sum = crc32(entry.body);
    const size = entry.body.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(size, 18); // compressed == uncompressed under STORE
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    chunks.push(local, name, entry.body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(CENTRAL_SIG, 0);
    dir.writeUInt16LE(VERSION, 4); // version made by
    dir.writeUInt16LE(VERSION, 6); // version needed
    dir.writeUInt16LE(FLAG_UTF8, 8);
    dir.writeUInt16LE(METHOD_STORE, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(size, 20);
    dir.writeUInt32LE(size, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk number start
    dir.writeUInt16LE(0, 36); // internal attrs
    // External attrs: regular file, rw-r--r--. `>>> 0` because JS `<<` is signed
    // 32-bit — 0o100644 << 16 overflows to a negative, which writeUInt32LE rejects.
    dir.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);

    offset += local.length + name.length + size;
    if (offset > ZIP_MAX_BYTES) throw new Error("zip_too_large");
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // no archive comment

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

/** Make `name` safe and unique inside an archive. Filenames come from the OS or
 *  a cloud provider, so they can collide, contain separators, or be empty. */
export function uniqueEntryName(name: string, taken: Set<string>): string {
  const cleaned =
    name
      .replace(/[/\\]+/g, "_")
      .replace(/^\.+/, "")
      .trim()
      .slice(0, 180) || "file";
  if (!taken.has(cleaned)) {
    taken.add(cleaned);
    return cleaned;
  }
  const dot = cleaned.lastIndexOf(".");
  const stem = dot > 0 ? cleaned.slice(0, dot) : cleaned;
  const ext = dot > 0 ? cleaned.slice(dot) : "";
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}
