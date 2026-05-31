import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { updateTodoSuggestionsList, type TodoSuggestionItem } from "@/lib/todo-db";

const log = createLogger("api:todo-list:suggestions:chatId");

function parseTodos(body: unknown): TodoSuggestionItem[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { todos?: unknown }).todos;
  if (!Array.isArray(raw)) return null;
  const todos: TodoSuggestionItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const title = (item as TodoSuggestionItem).title;
    if (typeof title !== "string" || !title.trim()) continue;
    todos.push(item as TodoSuggestionItem);
  }
  return todos;
}

/**
 * PUT /api/todo-list/suggestions/[chatId]
 * Persists edited suggestion list to SQLite (e.g. after reject/edit/accept in UI).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ chatId: string }> }
) {
  try {
    const { chatId } = await params;
    if (!chatId?.trim()) {
      return NextResponse.json({ error: "chatId is required" }, { status: 400 });
    }
    const body = await request.json();
    const todos = parseTodos(body);
    if (todos === null) {
      return NextResponse.json({ error: "todos array is required" }, { status: 400 });
    }
    updateTodoSuggestionsList(chatId, todos);
    return NextResponse.json({ ok: true, chatId, count: todos.length });
  } catch (e) {
    log.error({ err: e }, "PUT todo suggestions cache failed");
    return NextResponse.json({ error: "Failed to save todo suggestions cache" }, { status: 500 });
  }
}
