import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getDb } from "@/lib/db";
import { TODO_ITEM_SELECT, type TodoItem } from "@/lib/todo-db";
import { syncTodoToGoogleTasks } from "@/lib/todo-google-sync";
import { assertTodoSyncTarget } from "@/lib/todo-auto-sync";

const log = createLogger("api:todo-list:todos:id:google-sync");

const TODO_SELECT = `SELECT ${TODO_ITEM_SELECT} FROM todos WHERE id = ?`;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const todo = db.prepare(TODO_SELECT).get(id) as TodoItem | undefined;
    if (!todo) return NextResponse.json({ error: "Todo not found" }, { status: 404 });

    const targetError = assertTodoSyncTarget("google");
    if (targetError) return NextResponse.json({ error: targetError }, { status: 400 });

    const result = await syncTodoToGoogleTasks(todo);
    if (!result.ok) {
      const status = /not connected|Missing environment variable|refresh/i.test(result.error) ? 400 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      ok: true,
      alreadySynced: result.alreadySynced,
      googleTaskId: result.googleTaskId,
      googleTaskLink: result.googleTaskLink ?? null,
      googleSyncAt: result.googleSyncAt,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to sync todo to Google Tasks.";
    log.error({ err: e }, "Todo Google sync failed");
    const status = /not connected|Missing environment variable|refresh/i.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
