import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { listTodoSuggestionsMeta } from "@/lib/todo-db";

const log = createLogger("api:todo-list:suggestions:meta");

function parseChatIds(request: NextRequest, body?: { chatIds?: unknown }): string[] | undefined {
  if (body && Array.isArray(body.chatIds)) {
    return body.chatIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim());
  }
  const chatIdsParam = request.nextUrl.searchParams.get("chat_ids");
  if (!chatIdsParam) return undefined;
  return chatIdsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

/**
 * GET /api/todo-list/suggestions/meta?chat_ids=id1,id2
 */
export async function GET(request: NextRequest) {
  try {
    const chatIds = parseChatIds(request);
    const meta = listTodoSuggestionsMeta(chatIds);
    return NextResponse.json({ meta });
  } catch (e) {
    log.error({ err: e }, "GET todo suggestions meta failed");
    return NextResponse.json({ error: "Failed to load suggestions meta" }, { status: 500 });
  }
}

/** POST body: { chatIds: string[] } — for large id lists */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { chatIds?: unknown };
    const chatIds = parseChatIds(request, body);
    const meta = listTodoSuggestionsMeta(chatIds);
    return NextResponse.json({ meta });
  } catch (e) {
    log.error({ err: e }, "POST todo suggestions meta failed");
    return NextResponse.json({ error: "Failed to load suggestions meta" }, { status: 500 });
  }
}
