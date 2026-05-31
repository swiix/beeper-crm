import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getDb } from "@/lib/db";
import { updateTodo, deleteTodo, TODO_ITEM_SELECT, type TodoItem } from "@/lib/todo-db";
import { parseDueFieldsFromBody } from "@/lib/due-datetime";
import { pushTodoChangesToExternal } from "@/lib/todo-external-push";

const log = createLogger("api:todo-list:todos:id");

function parsePriority(v: unknown): number | null {
  if (typeof v === "number" && !Number.isNaN(v)) return Math.min(5, Math.max(1, Math.round(v)));
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (!Number.isNaN(n)) return Math.min(5, Math.max(1, n));
    const map: Record<string, number> = { high: 5, medium: 3, low: 1 };
    return map[v.toLowerCase()] ?? null;
  }
  return null;
}

/**
 * PATCH /api/todo-list/todos/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const updates: Partial<Pick<TodoItem, "title" | "notes" | "due_date" | "due_at" | "completed" | "archived" | "priority" | "sort_order" | "list_id" | "source_chat_name" | "source_account_id" | "reminder_at" | "snoozed" | "pinned" | "estimated_time_minutes" | "external_google_task_id" | "google_sync_at">> & {
      due_time?: string | null;
    } = {};
    if (typeof body?.title === "string") updates.title = body.title.trim();
    if (body?.notes !== undefined) updates.notes = body.notes === null || typeof body.notes === "string" ? body.notes : undefined;
    if (
      body?.due_date !== undefined ||
      body?.due_at !== undefined ||
      body?.due_time !== undefined
    ) {
      const due = parseDueFieldsFromBody(body as Record<string, unknown>);
      updates.due_date = due.due_date;
      updates.due_at = due.due_at;
    }
    if (typeof body?.reminder_at === "number" || body?.reminder_at === null) updates.reminder_at = body.reminder_at;
    if (typeof body?.snoozed === "number") updates.snoozed = body.snoozed;
    if (typeof body?.pinned === "number") updates.pinned = body.pinned;
    if (body?.estimated_time_minutes !== undefined) {
      const v = body.estimated_time_minutes;
      updates.estimated_time_minutes = v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0) ? v : undefined;
    }
    if (typeof body?.completed === "number") updates.completed = body.completed;
    if (typeof body?.archived === "number") updates.archived = body.archived;
    if (body?.priority !== undefined) updates.priority = parsePriority(body.priority) ?? undefined;
    if (typeof body?.sort_order === "number") updates.sort_order = body.sort_order;
    if (body?.list_id !== undefined) updates.list_id = body.list_id === null || typeof body.list_id === "string" ? body.list_id : undefined;
    if (body?.source_chat_name !== undefined) updates.source_chat_name = body.source_chat_name === null || typeof body.source_chat_name === "string" ? body.source_chat_name : undefined;
    if (body?.source_account_id !== undefined) updates.source_account_id = body.source_account_id === null || typeof body.source_account_id === "string" ? body.source_account_id : undefined;
    if (body?.external_google_task_id !== undefined) updates.external_google_task_id = body.external_google_task_id === null || typeof body.external_google_task_id === "string" ? body.external_google_task_id : undefined;
    if (body?.google_sync_at !== undefined) updates.google_sync_at = body.google_sync_at === null || typeof body.google_sync_at === "number" ? body.google_sync_at : undefined;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const db = getDb();
    const existing = db.prepare("SELECT id FROM todos WHERE id = ?").get(id);
    if (!existing) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }

    updateTodo(id, updates);
    const row = db.prepare(`SELECT ${TODO_ITEM_SELECT} FROM todos WHERE id = ?`).get(id) as TodoItem;
    const syncFields = ["title", "notes", "due_date", "due_at", "priority", "estimated_time_minutes"] as const;
    const shouldPush = syncFields.some((f) => updates[f] !== undefined);
    const externalPush = shouldPush ? await pushTodoChangesToExternal(row) : null;
    return NextResponse.json(externalPush != null ? { ...row, externalPush } : row);
  } catch (e) {
    log.error({ err: e }, "PATCH todo failed");
    return NextResponse.json({ error: "Failed to update todo" }, { status: 500 });
  }
}

/**
 * DELETE /api/todo-list/todos/[id]
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const existing = db.prepare("SELECT id FROM todos WHERE id = ?").get(id);
    if (!existing) {
      return NextResponse.json({ error: "Todo not found" }, { status: 404 });
    }
    deleteTodo(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    log.error({ err: e }, "DELETE todo failed");
    return NextResponse.json({ error: "Failed to delete todo" }, { status: 500 });
  }
}
