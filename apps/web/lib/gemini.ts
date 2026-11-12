import { GoogleGenAI, Type } from "@google/genai";
import {
  ASSET_LABELS,
  ASSISTANT_ACTIONS,
  ASSISTANT_PARSE_PROMPT,
  ASSISTANT_TARGETS,
  ASSISTANT_VIEWS,
  SEARCH_PARSE_PROMPT,
  assistantIntentSchema,
  searchParseSchema,
  type AssistantIntent,
  type SearchParse,
} from "@archivemind/shared";

/** Server-only Gemini client for search (spec §8.4). Mirrors the worker's
 *  service: model ids come from env (ADR 0010); the embedding space is pinned
 *  to the worker's — switching models means a full re-embed, so both constants
 *  must stay in lockstep with apps/worker/src/services/gemini.ts. */

export const EMBEDDING_MODEL = "gemini-embedding-2";
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

const SEARCH_PARSE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    semantic_text: { type: Type.STRING },
    date_from: { type: Type.STRING, nullable: true },
    date_to: { type: Type.STRING, nullable: true },
    place_terms: { type: Type.ARRAY, items: { type: Type.STRING } },
    tag_terms: { type: Type.ARRAY, items: { type: Type.STRING } },
    camera_terms: { type: Type.ARRAY, items: { type: Type.STRING } },
    iso_min: { type: Type.NUMBER, nullable: true },
    iso_max: { type: Type.NUMBER, nullable: true },
    aperture: { type: Type.STRING, nullable: true },
    kinds: {
      type: Type.ARRAY,
      items: { type: Type.STRING, enum: ["photo", "pdf", "document", "other"] },
    },
  },
  required: ["semantic_text", "place_terms", "tag_terms", "camera_terms", "kinds"],
};

export async function parseSearchQuery(q: string, today: string): Promise<SearchParse> {
  const res = await ai().models.generateContent({
    model: analyzeModel(),
    contents: [{ role: "user", parts: [{ text: `${SEARCH_PARSE_PROMPT}\nToday's date: ${today}\nQuery: ${q}` }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: SEARCH_PARSE_RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  });
  return searchParseSchema.parse(JSON.parse(res.text ?? "{}"));
}

/** One flat object: the intent fields beside the search fields. The same single
 *  model call that used to parse a search now also says what the message asks
 *  for, so understanding commands costs no extra call (ADR 0056). */
const ASSISTANT_PARSE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    action: { type: Type.STRING, enum: [...ASSISTANT_ACTIONS] },
    target: { type: Type.STRING, enum: [...ASSISTANT_TARGETS] },
    workspace_name: { type: Type.STRING, nullable: true },
    label: { type: Type.STRING, nullable: true, enum: [...ASSET_LABELS, "none"] },
    view: { type: Type.STRING, nullable: true, enum: [...ASSISTANT_VIEWS] },
    ...SEARCH_PARSE_RESPONSE_SCHEMA.properties,
  },
  required: ["action", "target", ...SEARCH_PARSE_RESPONSE_SCHEMA.required],
};

export interface AssistantParseContext {
  /** Names of the project's Workspaces, so the model can spell one. */
  workspaces: readonly string[];
  hasResults: boolean;
  selectionCount: number;
}

/** Classify a chat message and parse its search fields, in one call.
 *
 *  The instructions go in as the system instruction and everything that came
 *  from a person — the message, and the Workspace names, which are user text
 *  too — goes in as content, JSON-quoted. Neither can do more than pick a
 *  member of a closed enum: the answer is schema-constrained here and
 *  .catch()-guarded again by zod, and the client runs whatever comes back
 *  through the app's own handlers, confirmations included. */
export async function parseAssistantMessage(
  message: string,
  today: string,
  context: AssistantParseContext,
): Promise<{ intent: AssistantIntent; parsed: SearchParse }> {
  const known = context.workspaces.length ? context.workspaces.map((n) => JSON.stringify(n)).join(", ") : "(none)";
  const res = await ai().models.generateContent({
    model: analyzeModel(),
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              `Today's date: ${today}`,
              `Context: results shown: ${context.hasResults ? "yes" : "no"}; photos selected: ${context.selectionCount}`,
              `Known workspaces: ${known}`,
              `Message: ${JSON.stringify(message)}`,
            ].join("\n"),
          },
        ],
      },
    ],
    config: {
      systemInstruction: ASSISTANT_PARSE_PROMPT,
      responseMimeType: "application/json",
      responseSchema: ASSISTANT_PARSE_RESPONSE_SCHEMA,
      temperature: 0.1,
    },
  });
  const raw: unknown = JSON.parse(res.text ?? "{}");
  return { intent: assistantIntentSchema.parse(raw), parsed: searchParseSchema.parse(raw) };
}

export async function embedText(text: string): Promise<number[]> {
  const res = await ai().models.embedContent({
    model: EMBEDDING_MODEL,
    // Exactly ONE Content per input (aggregation trap — spec §8.2).
    contents: [{ parts: [{ text }] }],
    config: { outputDimensionality: EMBEDDING_DIMS },
  });
  const values = res.embeddings?.[0]?.values;
  if (!values || values.length !== EMBEDDING_DIMS) {
    throw new Error(`embedding: expected ${EMBEDDING_DIMS} dims, got ${values?.length ?? 0}`);
  }
  return values;
}
