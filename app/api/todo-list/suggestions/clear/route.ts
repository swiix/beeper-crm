import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { clearTodoSuggestionsCache } from "@/lib/todo-db";

const log = createLogger("api:todo-list:suggestions:clear");

/** POST /api/todo-list/suggestions/clear — wipe all cached todo suggestions from SQLite. */
export async function POST() {
  try {
    clearTodoSuggestionsCache();
    log.info("todo suggestions cache cleared");
    return NextResponse.json({ ok: true });
  } catch (e) {
    log.error({ err: e }, "POST clear todo suggestions failed");
    return NextResponse.json({ error: "Failed to clear todo suggestions cache" }, { status: 500 });
  }
}
