import { NextResponse } from "next/server";

interface TopicRpcError {
  code?: string;
  message: string;
}

/** Keep the three editable-Topic routes consistent without leaking SQL details
 *  for expected authorization/validation outcomes. */
export function topicRpcError(error: TopicRpcError) {
  if (error.code === "42501") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (error.code === "P0002") {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error.code === "22023") {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // Undefined function/table/column while the additive migration is still
  // pending. Reads and writes both fail explicitly: editable topics cannot be
  // represented safely in the pre-migration schema.
  if (["42883", "42P01", "42703"].includes(error.code ?? "")) {
    return NextResponse.json({ error: "editable topics are not available yet" }, { status: 503 });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}
