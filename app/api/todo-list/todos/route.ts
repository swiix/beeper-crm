import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { getTodos, createTodo, type GetTodosFilters, type TodoItem } from "@/lib/todo-db";
import { readTodoSettings } from "@/lib/todo-settings";
import { resolveEstimatedTimeMinutes } from "@/lib/todo-duration";
import { parseDueFieldsFromBody } from "@/lib/due-datetime";
import { maybeAutoSyncTodoOnAccept } from "@/lib/todo-auto-sync";
import { randomUUID } from "crypto";

const log = createLogger("api:todo-list:todos");

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

function parseMarkAsNext(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === "true" || raw === "1";
}

function parseEstimatedTimeMinutes(raw: unknown, defaultHours: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  return resolveEstimatedTimeMinutes(null, defaultHours);
}

/**
 * GET /api/todo-list/todos?status=open|completed|archived|snoozed|all&priority=&dueFilter=overdue|due_today|any&list_id=&sort=&order=&q=
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filters: GetTodosFilters = {
      status: (searchParams.get("status") as GetTodosFilters["status"]) ?? "open",
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
    return NextResponse.json(todos);
  } catch (e) {
    log.error({ err: e }, "GET todos failed");
    return NextResponse.json({ error: "Failed to list todos" }, { status: 500 });
  }
}

/**
 * POST /api/todo-list/todos
 * Body: { title, due_date?, priority?, notes?, list_id?, source_chat_id?, skipDuplicates? }
 * Or body: { todos: [...], skipDuplicates? } for batch (e.g. "Alle übernehmen").
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const defaultDurationHours = readTodoSettings().todoListDefaultDurationHours;

    if (Array.isArray(body?.todos)) {
      const skipDuplicates = !!body.skipDuplicates;
      const inserted: TodoItem[] = [];
      const skipped: unknown[] = [];
      let syncSynced = 0;
      let syncFailed = 0;
      for (const t of body.todos) {
        if (!t || typeof t.title !== "string" || !t.title.trim()) continue;
        const id = randomUUID();
        const dueRaw =
          typeof t.due_date === "string"
            ? t.due_date
            : typeof t.due === "string"
              ? t.due
              : null;
        const dueFields = parseDueFieldsFromBody({
          due_date: dueRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueRaw) ? dueRaw : null,
          due_time: typeof t.due_time === "string" ? t.due_time : undefined,
          due_at: typeof t.due_at === "number" ? t.due_at : undefined,
        });
        const priority = parsePriority(t.priority);
        const estimated_time_minutes = parseEstimatedTimeMinutes(t.estimated_time_minutes, defaultDurationHours);
        try {
          const result = createTodo({
            id,
            title: t.title.trim(),
            notes: typeof t.notes === "string" ? t.notes : null,
            due_date: dueFields.due_date,
            due_at: dueFields.due_at,
            priority: priority ?? null,
            list_id: typeof t.list_id === "string" ? t.list_id : null,
            source_chat_id: typeof t.source_chat_id === "string" ? t.source_chat_id : null,
            source_chat_name: typeof t.source_chat_name === "string" ? t.source_chat_name : null,
            source_account_id: typeof t.source_account_id === "string" ? t.source_account_id : null,
            estimated_time_minutes,
            skipDuplicates,
          });
          if (result) {
            inserted.push(result.todo);
            const syncMeta = await maybeAutoSyncTodoOnAccept(result.todo, {
              markAsNext: parseMarkAsNext(t.mark_as_next),
            });
            if (syncMeta?.ok) syncSynced += 1;
            else if (syncMeta && !syncMeta.ok) syncFailed += 1;
          } else skipped.push({ title: t.title });
        } catch (err) {
          if (err instanceof Error && err.message === "DUPLICATE" && skipDuplicates) {
            skipped.push({ title: t.title });
          } else throw err;
        }
      }
      const payload: Record<string, unknown> = {
        inserted: inserted.length,
        skipped: skipped.length,
        todos: inserted,
      };
      if (syncSynced > 0 || syncFailed > 0) {
        payload.syncSummary = { synced: syncSynced, failed: syncFailed, target: readTodoSettings().todoSyncTarget };
      }
      return NextResponse.json(payload);
    }

    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const skipDuplicates = !!body?.skipDuplicates;
    const id = randomUUID();
    const dueFields = parseDueFieldsFromBody(body as Record<string, unknown>);
    const priority = parsePriority(body?.priority);

    const estimated_time_minutes = parseEstimatedTimeMinutes(body?.estimated_time_minutes, defaultDurationHours);
    try {
      const result = createTodo({
        id,
        title,
        notes: typeof body?.notes === "string" ? body.notes : null,
        due_date: dueFields.due_date,
        due_at: dueFields.due_at,
        due_time: typeof body?.due_time === "string" ? body.due_time : undefined,
        priority: priority ?? null,
        list_id: typeof body?.list_id === "string" ? body.list_id : null,
        source_chat_id: typeof body?.source_chat_id === "string" ? body.source_chat_id : null,
        source_chat_name: typeof body?.source_chat_name === "string" ? body.source_chat_name : null,
        source_account_id: typeof body?.source_account_id === "string" ? body.source_account_id : null,
        estimated_time_minutes,
        skipDuplicates,
      });
      if (result) {
        const externalSync = await maybeAutoSyncTodoOnAccept(result.todo, {
          markAsNext: parseMarkAsNext(body?.mark_as_next),
        });
        const payload: Record<string, unknown> = { ...result.todo };
        if (externalSync != null) payload.externalSync = externalSync;
        return NextResponse.json(payload, { status: 201 });
      }
      return NextResponse.json({ skipped: true, message: "Duplicate" }, { status: 200 });
    } catch (err) {
      if (err instanceof Error && err.message === "DUPLICATE") {
        return NextResponse.json({ error: "Todo with same title already exists" }, { status: 409 });
      }
      throw err;
    }
  } catch (e) {
    log.error({ err: e }, "POST todos failed");
    return NextResponse.json({ error: "Failed to create todo(s)" }, { status: 500 });
  }
}
