import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { reorderTodos } from "@/lib/todo-db";

const log = createLogger("api:todo-list:todos:reorder");

/**
 * PUT /api/todo-list/todos/reorder
 * Body: { orderedIds: string[] }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const orderedIds = body?.orderedIds;
    if (!Array.isArray(orderedIds) || orderedIds.some((id: unknown) => typeof id !== "string")) {
      return NextResponse.json({ error: "orderedIds must be an array of strings" }, { status: 400 });
    }
    reorderTodos(orderedIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    log.error({ err: e }, "PUT reorder failed");
    return NextResponse.json({ error: "Failed to reorder todos" }, { status: 500 });
  }
}
