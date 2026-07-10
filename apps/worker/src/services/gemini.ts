import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { ANALYZE_PROMPT, analyzeOutputSchema, type AnalyzeOutput } from "@archivemind/shared";

/** Gemini calls (spec §8.2, ADR 0007/0010): `generateContent` + responseSchema
 *  for analysis (model id from GEMINI_ANALYZE_MODEL — never hardcode a
 *  generation), `embedContent` for embeddings. One Content per image on the
 *  embedding call — multiple Parts in one Content collapse into a single
 *  aggregated vector (silent index corruption). */

export const EMBEDDING_MODEL = "gemini-embedding-2"; // pinned space: switching = full re-embed
export const EMBEDDING_DIMS = 768;

let client: GoogleGenAI | null = null;

function ai(): GoogleGenAI {
  if (client) return client;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required");
  client = new GoogleGenAI({ apiKey });
  return client;
}

export function analyzeModel(): string {
  return process.env.GEMINI_ANALYZE_MODEL ?? "gemini-3.1-flash-lite";
}

/** Exponential backoff on 429/5xx (spec §7: worker-side rate limiting). */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const msg = String(e);
      if (!/429|RESOURCE_EXHAUSTED|500|503|UNAVAILABLE/i.test(msg) || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
    }
  }
  throw lastErr;
}

const ANALYZE_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    description: { type: Type.STRING },
    tags: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          category: {
            type: Type.STRING,
            enum: ["object", "scene", "place", "attribute", "event", "other"],
          },
          confidence: { type: Type.NUMBER },
        },
        required: ["name", "category", "confidence"],
      },
    },
    ocr_text: { type: Type.STRING },
    suggested_facts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          basis: { type: Type.STRING, enum: ["visual", "exif"] },
        },
        required: ["text", "basis"],
      },
    },
  },
  required: ["description", "tags", "ocr_text", "suggested_facts"],
};

export async function analyzeImage(image: Buffer, mimeType: string): Promise<AnalyzeOutput> {
  const res = await withRetry(() =>
    ai().models.generateContent({
      model: analyzeModel(),
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: image.toString("base64") } },
            { text: ANALYZE_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYZE_RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    }),
  );
  return analyzeOutputSchema.parse(JSON.parse(res.text ?? "{}"));
}

export async function embedImage(image: Buffer, mimeType: string): Promise<number[]> {
  const res = await withRetry(() =>
    ai().models.embedContent({
      model: EMBEDDING_MODEL,
      // Exactly ONE Content per image (aggregation trap — spec §8.2).
      contents: [{ parts: [{ inlineData: { mimeType, data: image.toString("base64") } }] }],
      config: { outputDimensionality: EMBEDDING_DIMS },
    }),
  );
  const values = res.embeddings?.[0]?.values;
  if (!values || values.length !== EMBEDDING_DIMS) {
    throw new Error(`embedding: expected ${EMBEDDING_DIMS} dims, got ${values?.length ?? 0}`);
  }
  return values;
}
