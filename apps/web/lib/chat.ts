/**
 * AI Assistant is a pure client-side canned-response simulator — no LLM call
 * anywhere. Exact-string lookup against this table; generic fallback otherwise.
 */
export const CHAT_REPLIES: Record<string, string> = {
  "Find photos with medical workers":
    "Found 3 photos tagged with medics or medical — photos a, b and g. Two from Jun 18, one from Jun 17, all in Kyiv. Want me to select them?",
  "Generate captions for unprocessed photos":
    "There are several unprocessed photos. Switch to a project's Timeline view, select them, and I can caption all of them in one pass — multilingual, with your chosen style.",
  "Which locations have the most photos?":
    "Ukraine leads, with United Kingdom and France close behind. Switch to Map view within a project to see the full geographic spread.",
  "Group photos by visual theme":
    "Switch to Sense view — I'll cluster everything by visual theme automatically, sized by how many files belong to each.",
};

export const CHAT_FALLBACK_REPLY =
  "Let me look into that — I'll search across your whole archive and pull what matches.";

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
    a: "All my files shows every source you've connected — Google Drive, iCloud, Dropbox — as circles, with the folders and files inside them branching out as a connected graph.",
  },
  {
    q: "How do project views differ?",
    a: "Timeline groups files by month in a scrollable grid. Map plots files by location. Sense clusters files by AI-detected theme.",
  },
  {
    q: "Is my data private?",
    a: "Files are encrypted at rest and in transit. AI processing runs in isolated sandboxes — your content is never used to train models.",
  },
];

export const SEARCH_PLACEHOLDER =
  'Search what\'s inside your photos — "medics", "rubble at night", "aid line"…';
