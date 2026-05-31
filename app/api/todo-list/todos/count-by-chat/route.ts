import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getTodoCountByChat } from "@/lib/todo-db";

const log = createLogger("api:todo-list:todos:count-by-chat");

/**
 * GET /api/todo-list/todos/count-by-chat?chatIds=id1,id2,...
 */
export async function GET(request: NextRequest) {
  try {
    const chatIdsParam = request.nextUrl.searchParams.get("chatIds");
    if (!chatIdsParam) {
      return NextResponse.json({ error: "Missing chatIds query parameter" }, { status: 400 });
    }
    const chatIds = chatIdsParam
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const counts = getTodoCountByChat(chatIds);
    return NextResponse.json(counts);
  } catch (e) {
    log.error({ err: e }, "GET count-by-chat failed");
    return NextResponse.json({ error: "Failed to get counts" }, { status: 500 });
  }
}
