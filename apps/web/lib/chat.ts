/**
 * Static copy for the chat/help surfaces. The canned-response simulator that
 * used to live here retired with #16 — the assistant now answers through the
 * real `GET /api/search` (see `sendChat` in hooks/useWorkspace.ts).
 */

export const CHAT_GREETING =
  "Hi! I can help you search, analyze, and work with your archive. Ask me anything about your photos.";

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

export const SEARCH_PLACEHOLDER =
  'Search what\'s inside your photos — "medics", "rubble at night", "aid line"…';
