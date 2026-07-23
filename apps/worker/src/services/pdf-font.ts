import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The embedded PDF text face for artboard export (ADR 0035). Bundled at the
 *  package root's data/fonts/ (Liberation Sans, OFL — Latin + Cyrillic + Greek
 *  in one TTF, so en/uk/ru captions never fall back to tofu). Resolved by
 *  walking up from this module because it runs from two depths — src/services/
 *  under tsx/vitest, dist/ once tsup has bundled it — exactly like the geocode
 *  data artifact. An `EXPORT_FONT_PATH` env overrides it (swap the house font
 *  without a rebuild). */
const FONT_FILE = "LiberationSans-Regular.ttf";

function resolveFontFile(): string {
  const envPath = process.env.EXPORT_FONT_PATH;
  if (envPath && fs.existsSync(envPath)) return envPath;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const up of ["..", "../..", "../../.."]) {
    const candidate = path.join(here, up, "data", "fonts", FONT_FILE);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(here, "..", "data", "fonts", FONT_FILE); // report the expected path
}

let cached: Buffer | null = null;

/** The font bytes for pdf-lib embedding. Throws `export_font_missing` (the
 *  message IS the code → ai_jobs.error) if the asset isn't deployed, so a bad
 *  image never silently ships a tofu PDF. */
export function loadPdfFont(): Buffer {
  if (cached) return cached;
  const file = resolveFontFile();
  if (!fs.existsSync(file)) throw new Error("export_font_missing");
  cached = fs.readFileSync(file);
  return cached;
}
