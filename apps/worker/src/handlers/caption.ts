import {
  CAPTION_LANG_NAMES,
  CAPTION_PROMPTS,
  captionJobPayloadSchema,
  type CaptionLang,
  type CaptionStyleKey,
} from "@archivemind/shared";
import { analyzeModel, generateCaption } from "../services/gemini";
import { getObjectBuffer } from "../services/r2";
import type { HandlerContext } from "./index";

/** Captions (spec §8.3), per asset × lang: medium preview + known metadata
 *  (EXIF date/camera/GPS label + confirmed facts) → styled caption → upsert.
 *  Never overwrites a user-edited caption (is_edited guard in the upsert —
 *  the UI owns the confirm-overwrite flow). One usage_event per caption. */

interface CaptionAssetRow {
  asset_id: string;
  workspace_id: string;
  title: string | null;
  preview_key: string | null;
  taken_at: string | Date | null;
  camera_make: string | null;
  camera_model: string | null;
  gps_label: string | null;
}

export interface CaptionContext {
  taken_at: string | Date | null;
  camera_make: string | null;
  camera_model: string | null;
  gps_label: string | null;
  confirmed_facts: string[];
}

/** Pure prompt assembly: style template + target language + whatever metadata
 *  actually exists — the model is told to never invent beyond it. */
export function buildCaptionPrompt(style: CaptionStyleKey, lang: CaptionLang, ctx: CaptionContext): string {
  const metadata = [
    ctx.taken_at ? `Taken: ${new Date(ctx.taken_at).toISOString().slice(0, 10)}` : null,
    ctx.camera_make || ctx.camera_model
      ? `Camera: ${[ctx.camera_make, ctx.camera_model].filter(Boolean).join(" ")}`
      : null,
    ctx.gps_label ? `Location: ${ctx.gps_label}` : null,
    ctx.confirmed_facts.length ? `Confirmed facts: ${ctx.confirmed_facts.join(" · ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return `${CAPTION_PROMPTS[style]}\nWrite it in ${CAPTION_LANG_NAMES[lang]}.${
    metadata ? `\nKnown metadata (use only what is relevant, never invent beyond it):\n${metadata}` : ""
  }`;
}

export async function captionHandler({ pool, job, progress }: HandlerContext): Promise<void> {
  const { asset_ids, langs, style } = captionJobPayloadSchema.parse(job.payload);

  const { rows } = await pool.query<CaptionAssetRow>(
    `select a.id as asset_id, a.workspace_id, a.title, ap.r2_key as preview_key,
            e.taken_at, e.camera_make, e.camera_model, e.gps_label
     from assets a
     left join asset_previews ap on ap.asset_id = a.id and ap.size = 'medium'
     left join asset_exif e on e.asset_id = a.id
     where a.id = any($1::uuid[]) and a.status = 'active'
     order by a.created_at`,
    [asset_ids],
  );

  const totalUnits = rows.length * langs.length;
  let done = 0; // progress units, including skipped assets
  let generated = 0; // captions actually written

  for (const row of rows) {
    if (!row.preview_key) {
      console.log(`[caption] ${row.title ?? row.asset_id}: no medium preview — skipped`);
      done += langs.length;
      continue;
    }

    const image = await getObjectBuffer(row.preview_key);
    const { rows: confirmed } = await pool.query(
      `select text from facts where asset_id = $1 and status = 'confirmed' limit 6`,
      [row.asset_id],
    );

    for (const lang of langs) {
      await progress(
        Math.round((done / totalUnits) * 100),
        `Captioning ${row.title ?? row.asset_id} (${lang.toUpperCase()})`,
        done,
        totalUnits,
      );

      const prompt = buildCaptionPrompt(style, lang, {
        taken_at: row.taken_at,
        camera_make: row.camera_make,
        camera_model: row.camera_model,
        gps_label: row.gps_label,
        confirmed_facts: confirmed.map((f) => f.text as string),
      });
      const text = await generateCaption(image, "image/webp", prompt);

      // is_edited guard: a user-edited caption is never silently replaced.
      await pool.query(
        `insert into captions (asset_id, lang, style, text, generated_by)
         values ($1, $2, $3, $4, $5)
         on conflict (asset_id, lang, style) do update
           set text = excluded.text, generated_by = excluded.generated_by, updated_at = now()
           where captions.is_edited = false`,
        [row.asset_id, lang, style, text, analyzeModel()],
      );
      await pool.query(
        `insert into usage_events (workspace_id, user_id, job_id, event_type, units, model)
         values ($1, $2, $3, 'caption_generated', 1, $4)`,
        [row.workspace_id, job.user_id, job.id, analyzeModel()],
      );
      done += 1;
      generated += 1;
    }
  }

  await progress(100, `Generated ${generated} caption(s)`, done, totalUnits);
}
