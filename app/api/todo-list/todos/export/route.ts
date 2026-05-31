import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getTodos, type GetTodosFilters } from "@/lib/todo-db";

const log = createLogger("api:todo-list:todos:export");

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
 * GET /api/todo-list/todos/export?format=json|csv&status=&dueFilter=&list_id=&q=...
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const format = searchParams.get("format") ?? "json";
    const filters: GetTodosFilters = {
      status: (searchParams.get("status") as GetTodosFilters["status"]) ?? "all",
      dueFilter: (searchParams.get("dueFilter") as GetTodosFilters["dueFilter"]) ?? "any",
      sort: (searchParams.get("sort") as GetTodosFilters["sort"]) ?? "due",
      order: (searchParams.get("order") as GetTodosFilters["order"]) ?? "asc",
    };
    const priorityParam = searchParams.get("priority");
    if (priorityParam != null && priorityParam !== "") {
      const p = parsePriority(priorityParam);
      if (p != null) filters.priority = p;
    }
    const listId = searchParams.get("list_id");
    if (listId != null && listId !== "") filters.list_id = listId;
    const sourceAccountId = searchParams.get("source_account_id");
    if (sourceAccountId != null && sourceAccountId !== "") filters.source_account_id = sourceAccountId;
    const sourceChatId = searchParams.get("source_chat_id");
    if (sourceChatId != null && sourceChatId !== "") filters.source_chat_id = sourceChatId;
    const q = searchParams.get("q") ?? searchParams.get("search");
    if (q != null && q.trim()) filters.q = q.trim();

    const todos = getTodos(filters);

    if (format === "csv") {
      const header = "title,due_date,priority,completed,archived,notes,estimated_time_minutes,source_chat_id,source_chat_name,source_account_id,created_at";
      const rows = todos.map((t) => {
        const escape = (s: string | null) => (s == null ? "" : `"${String(s).replace(/"/g, '""')}"`);
        return [escape(t.title), escape(t.due_date), t.priority ?? "", t.completed, t.archived, escape(t.notes), t.estimated_time_minutes ?? "", escape(t.source_chat_id), escape(t.source_chat_name), escape(t.source_account_id), t.created_at].join(",");
      });
      const csv = [header, ...rows].join("\n");
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="todos.csv"',
        },
      });
    }

    return NextResponse.json(todos, {
      headers: format === "json" ? { "Content-Disposition": 'attachment; filename="todos.json"' } : undefined,
    });
  } catch (e) {
    log.error({ err: e }, "GET export failed");
    return NextResponse.json({ error: "Failed to export todos" }, { status: 500 });
  }
}
