import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { listTodoSuggestionsMap } from "@/lib/todo-db";

const log = createLogger("api:todo-list:suggestions");

/**
 * GET /api/todo-list/suggestions?chat_ids=id1,id2
 * Loads persisted todo suggestion cache from SQLite (survives server restarts).
 */
export async function GET(request: NextRequest) {
  try {
    const chatIdsParam = request.nextUrl.searchParams.get("chat_ids");
    const chatIds =
      chatIdsParam
        ?.split(",")
        .map((id) => id.trim())
        .filter(Boolean) ?? undefined;
    const suggestions = listTodoSuggestionsMap(chatIds);
    return NextResponse.json({ suggestions });
  } catch (e) {
    log.error({ err: e }, "GET todo suggestions cache failed");
    return NextResponse.json({ error: "Failed to load todo suggestions cache" }, { status: 500 });
  }
}
