import { NextResponse } from "next/server";
import {
  assistantNeedsSearch,
  assistantRequestSchema,
  assistantResponseSchema,
  type AssistantIntent,
  type SearchParse,
} from "@archivemind/shared";
import { parseAssistantMessage } from "@/lib/gemini";
import { runSearch, semanticOnlyParse } from "@/lib/search-server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** POST /api/assistant (ADR 0056): what does this chat message ask for?
 *
 *  One model call classifies the message and parses its search fields — the
 *  call `GET /api/search` already made, with an intent attached. The route
 *  then runs the search pipeline only when the intent needs one, so a command
 *  ("switch to the map", "add these to Wedding") costs LESS than the search
 *  every message used to be.
 *
 *  It answers with a description and never acts: there is no write in this
 *  file. The client turns the intent into a `ChatAction` and runs it through
 *  the handler a button already calls — which is also where every gate and
 *  confirmation lives, so a wrong or manipulated intent can at worst open a
 *  dialog the user then declines.
 *
 *  Zero credits, like search. A search that runs logs its `search_query`
 *  event as before; a pure command logs nothing — there is no event type for
 *  it, and counting it as a search would inflate that number. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const body = assistantRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });
  const { message, projectId, context } = body.data;

  // A model hiccup degrades to what the chat did before it understood
  // commands: a plain semantic search on the text. Never a failed request,
  // and never a guessed action.
  const today = new Date().toISOString().slice(0, 10);
  let intent: AssistantIntent;
  let parsed: SearchParse;
  try {
    ({ intent, parsed } = await parseAssistantMessage(message, today, context));
  } catch {
    intent = { action: "search", target: "new_search" };
    parsed = semanticOnlyParse(message);
  }
  // A search is a search whatever target the parser paired it with.
  if (intent.action === "search") intent = { ...intent, target: "new_search" };

  if (!assistantNeedsSearch(intent)) {
    return NextResponse.json(assistantResponseSchema.parse({ intent, parsed, results: null }));
  }

  const outcome = await runSearch(supabase, {
    workspaceId,
    userId: user.id,
    projectId: projectId ?? null,
    parsed,
    q: message,
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(assistantResponseSchema.parse({ intent, parsed, results: outcome.results }));
}
