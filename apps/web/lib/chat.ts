/**
 * Static copy for the chat/help surfaces. The canned-response simulator that
 * used to live here retired with #16 — the assistant answers through the real
 * `POST /api/assistant` (see `send` in hooks/useAssistant.ts), and what it
 * says and offers is composed in lib/assistant.ts and lib/assistant-intent.ts.
 */

export const CHAT_TITLE = "AI assistant";

export const CHAT_GREETING =
  "Search your archive by what's actually in the photos — people, places, objects, scenes — then act on what you find: add it to a workspace, label it, share or download it. Or just tell me what to do.";

export const CHAT_PLACEHOLDER = "Search, or tell me what to do — “add these to Wedding”…";

export const CHAT_FOOTNOTE = "Powered by Gemini · searches your analyzed photos";

export interface FaqItem {
  q: string;
  a: string;
}

export const HELP_FAQ: FaqItem[] = [
  {
    q: "How does Smart Search work?",
    a: "We use AI to analyze actual file content — what's in photos, videos, and documents — not just filenames. Search for concepts, people, objects, and scenes across your whole archive.",
  },
  {
    q: "What is the Neural view?",
    a: "Neural is a project's freeform canvas. Files appear directly as tiles, and you can pan, zoom, select, and arrange them spatially.",
  },
  {
    q: "How do project views differ?",
    a: "Timeline lays files out on a horizontal date axis — one column per capture day. Map plots files by location. Topic clusters files by AI-detected theme; click a cloud's label to focus it, drag the label to move the whole cloud.",
  },
  {
    q: "Is my data private?",
    a: "Files are encrypted at rest and in transit. AI processing runs in isolated sandboxes — your content is never used to train models.",
  },
];
