/**
 * Todo list persistence: chat todo suggestions, todo lists, and todos.
 */

import { getDb } from "@/lib/db";
import { DEFAULT_DUE_TIME, dueDateTimeToMs, msToDueDateTime, syncDueDateFromDateTime, type DueDateTime } from "@/lib/due-datetime";

export const TODO_ITEM_SELECT =
  "id, title, notes, due_date, due_at, completed, archived, priority, sort_order, list_id, source_chat_id, source_chat_name, source_account_id, created_at, updated_at, reminder_at, snoozed, pinned, estimated_time_minutes, external_google_task_id, google_sync_at, external_reclaim_task_id, reclaim_sync_at";

function resolveDueFields(data: {
  due_date?: string | null;
  due_at?: number | null;
  due_time?: string | null;
}): { due_date: string | null; due_at: number | null } | null {
  if (data.due_at === null || data.due_date === null) {
    return { due_date: null, due_at: null };
  }
  if (typeof data.due_at === "number" && Number.isFinite(data.due_at)) {
    const dt = msToDueDateTime(data.due_at);
    return { due_date: syncDueDateFromDateTime(dt), due_at: data.due_at };
  }
  if (data.due_date === undefined && data.due_at === undefined && data.due_time === undefined) {
    return null;
  }
  const date = typeof data.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.due_date) ? data.due_date : null;
  if (!date) return { due_date: null, due_at: null };
  const dt: DueDateTime = {
    date,
    time: typeof data.due_time === "string" && /^\d{2}:\d{2}$/.test(data.due_time) ? data.due_time : DEFAULT_DUE_TIME,
  };
  return { due_date: date, due_at: dueDateTimeToMs(dt) };
}

export interface TodoSuggestionItem {
  title: string;
  due: string | null;
  priority?: number | string;
  notes?: string | null;
  category?: string | null;
  /** AI-estimated time to complete in minutes (e.g. 15, 90 for 1.5h). */
  estimated_time_minutes?: number | null;
  /** AI-estimated time to complete in hours (e.g. 0.5, 1.5, 2). */
  estimated_time_hours?: number | null;
  /** When accepted, sync as Up Next (Reclaim onDeck / Google upnext title prefix). */
  mark_as_next?: boolean;
}

export interface TodoItem {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  /** Epoch ms for due date+time (local wall clock). */
  due_at: number | null;
  completed: number;
  archived: number;
  priority: number | null;
  sort_order: number;
  list_id: string | null;
  source_chat_id: string | null;
  source_chat_name: string | null;
  source_account_id: string | null;
  created_at: number;
  updated_at: number;
  /** Epoch ms when to remind the user (browser/UI); null = no reminder. */
  reminder_at: number | null;
  /** 1 = moved to Remind-later stack (hidden from open list), 0 = normal. */
  snoozed: number;
  /** 1 = pinned to top until acknowledged. */
  pinned: number;
  /** AI-estimated time to complete in minutes (e.g. 15, 90). */
  estimated_time_minutes: number | null;
  /** Linked Google Task ID from single-click sync. */
  external_google_task_id: string | null;
  /** Epoch ms of the last successful Google sync. */
  google_sync_at: number | null;
  /** Linked Reclaim task ID from single-click sync. */
  external_reclaim_task_id: string | null;
  /** Epoch ms of the last successful Reclaim sync. */
  reclaim_sync_at: number | null;
}

export interface TodoListRecord {
  id: string;
  name: string;
  sort_order: number;
}

export interface GetTodosFilters {
  status?: "open" | "completed" | "archived" | "snoozed" | "all";
  priority?: number | string;
  dueFilter?: "overdue" | "due_today" | "any";
  list_id?: string | null;
  source_account_id?: string | null;
  source_chat_id?: string | null;
  sort?: "due" | "priority" | "title" | "created" | "sort_order";
  order?: "asc" | "desc";
  q?: string;
}

function activateDueReminders(): void {
  const db = getDb();
  const t = now();
  // Move back from Remind-later archive when reminder time reached; restore to open list and pin until user acknowledges.
  db.prepare(
    "UPDATE todos SET snoozed = 0, pinned = 1, archived = 0, updated_at = ? WHERE snoozed = 1 AND completed = 0 AND reminder_at IS NOT NULL AND reminder_at <= ?"
  ).run(t, t);
}

function now(): number {
  return Date.now();
}

/** Get cached todo suggestions for a chat. Caller validates freshness via sort keys and prompt hash. */
export function getTodoSuggestions(chatId: string): {
  last_message_date: string;
  last_message_sort_key: string | null;
  last_analyzed_sort_key: string | null;
  todo_prompt_hash: string | null;
  todos: TodoSuggestionItem[];
} | null {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT last_message_date, last_message_sort_key, last_analyzed_sort_key, todos_json, todo_prompt_hash FROM chat_todo_suggestions WHERE chat_id = ?"
    )
    .get(chatId) as
    | {
        last_message_date: string;
        last_message_sort_key: string | null;
        last_analyzed_sort_key: string | null;
        todos_json: string;
        todo_prompt_hash: string | null;
      }
    | undefined;
  if (!row) return null;
  try {
    const todos = JSON.parse(row.todos_json) as TodoSuggestionItem[];
    return {
      last_message_date: row.last_message_date,
      last_message_sort_key: row.last_message_sort_key ?? null,
      last_analyzed_sort_key: row.last_analyzed_sort_key ?? null,
      todo_prompt_hash: row.todo_prompt_hash ?? null,
      todos: Array.isArray(todos) ? todos : [],
    };
  } catch {
    return null;
  }
}

/** Save todo suggestions for a chat (after AI analysis). */
export function setTodoSuggestions(
  chatId: string,
  lastMessageDate: string,
  lastMessageSortKey: string | null,
  lastAnalyzedSortKey: string | null,
  todos: TodoSuggestionItem[],
  todoPromptHash: string | null
): void {
  const db = getDb();
  const t = now();
  db.prepare(
    "INSERT INTO chat_todo_suggestions (chat_id, last_message_date, last_message_sort_key, last_analyzed_sort_key, todos_json, updated_at, todo_prompt_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (chat_id) DO UPDATE SET last_message_date = excluded.last_message_date, last_message_sort_key = excluded.last_message_sort_key, last_analyzed_sort_key = excluded.last_analyzed_sort_key, todos_json = excluded.todos_json, updated_at = excluded.updated_at, todo_prompt_hash = excluded.todo_prompt_hash"
  ).run(chatId, lastMessageDate, lastMessageSortKey, lastAnalyzedSortKey, JSON.stringify(todos), t, todoPromptHash);
}

/** Clear all cached todo suggestions (e.g. after prompt change so analyses are re-run with new prompt). */
export function clearTodoSuggestionsCache(): void {
  getDb().prepare("DELETE FROM chat_todo_suggestions").run();
}

function parseTodosJson(raw: string): TodoSuggestionItem[] {
  try {
    const todos = JSON.parse(raw) as TodoSuggestionItem[];
    if (!Array.isArray(todos)) return [];
    return todos.filter(
      (item): item is TodoSuggestionItem =>
        item != null && typeof item === "object" && typeof item.title === "string" && item.title.trim().length > 0
    );
  } catch {
    return [];
  }
}

export type TodoSuggestionMeta = {
  suggestionCount: number;
  updatedAt: number | null;
  lastMessageSortKey: string | null;
  lastAnalyzedSortKey: string | null;
  todoPromptHash: string | null;
};

/** Metadata per chat for inbox badges and stale detection. */
export function listTodoSuggestionsMeta(chatIds?: string[]): Record<string, TodoSuggestionMeta> {
  const db = getDb();
  const rows =
    chatIds && chatIds.length > 0
      ? (db
          .prepare(
            `SELECT chat_id, todos_json, updated_at, last_message_sort_key, last_analyzed_sort_key, todo_prompt_hash FROM chat_todo_suggestions WHERE chat_id IN (${chatIds.map(() => "?").join(",")})`
          )
          .all(...chatIds) as {
          chat_id: string;
          todos_json: string;
          updated_at: number;
          last_message_sort_key: string | null;
          last_analyzed_sort_key: string | null;
          todo_prompt_hash: string | null;
        }[])
      : (db
          .prepare(
            "SELECT chat_id, todos_json, updated_at, last_message_sort_key, last_analyzed_sort_key, todo_prompt_hash FROM chat_todo_suggestions"
          )
          .all() as {
          chat_id: string;
          todos_json: string;
          updated_at: number;
          last_message_sort_key: string | null;
          last_analyzed_sort_key: string | null;
          todo_prompt_hash: string | null;
        }[]);

  const out: Record<string, TodoSuggestionMeta> = {};
  for (const row of rows) {
    const todos = parseTodosJson(row.todos_json);
    out[row.chat_id] = {
      suggestionCount: todos.length,
      updatedAt: typeof row.updated_at === "number" ? row.updated_at : null,
      lastMessageSortKey: row.last_message_sort_key ?? null,
      lastAnalyzedSortKey: row.last_analyzed_sort_key ?? null,
      todoPromptHash: row.todo_prompt_hash ?? null,
    };
  }
  return out;
}

/** Load all persisted suggestion lists for UI hydration (SQLite on disk). */
export function listTodoSuggestionsMap(chatIds?: string[]): Record<string, TodoSuggestionItem[]> {
  const db = getDb();
  const rows =
    chatIds && chatIds.length > 0
      ? (db
          .prepare(
            `SELECT chat_id, todos_json FROM chat_todo_suggestions WHERE chat_id IN (${chatIds.map(() => "?").join(",")})`
          )
          .all(...chatIds) as { chat_id: string; todos_json: string }[])
      : (db.prepare("SELECT chat_id, todos_json FROM chat_todo_suggestions ORDER BY updated_at DESC").all() as {
          chat_id: string;
          todos_json: string;
        }[]);

  const out: Record<string, TodoSuggestionItem[]> = {};
  for (const row of rows) {
    const todos = parseTodosJson(row.todos_json);
    if (todos.length > 0) out[row.chat_id] = todos;
  }
  return out;
}

/**
 * Persist edited suggestion list for a chat (keeps analysis metadata from prior run).
 * Removes the row when the list is empty.
 */
export function updateTodoSuggestionsList(chatId: string, todos: TodoSuggestionItem[]): void {
  const db = getDb();
  if (todos.length === 0) {
    db.prepare("DELETE FROM chat_todo_suggestions WHERE chat_id = ?").run(chatId);
    return;
  }
  const existing = getTodoSuggestions(chatId);
  if (!existing) {
    setTodoSuggestions(chatId, "", null, null, todos, null);
    return;
  }
  db.prepare("UPDATE chat_todo_suggestions SET todos_json = ?, updated_at = ? WHERE chat_id = ?").run(
    JSON.stringify(todos),
    now(),
    chatId
  );
}

/** Get all todo lists. */
export function getTodoLists(): TodoListRecord[] {
  const db = getDb();
  const rows = db.prepare("SELECT id, name, sort_order FROM todo_lists ORDER BY sort_order ASC, name ASC").all() as TodoListRecord[];
  return rows;
}

/** Create a todo list. */
export function createTodoList(id: string, name: string, sortOrder: number = 0): void {
  const db = getDb();
  db.prepare("INSERT INTO todo_lists (id, name, sort_order) VALUES (?, ?, ?)").run(id, name, sortOrder);
}

/** Get todos with optional filters. */
export function getTodos(filters: GetTodosFilters = {}): TodoItem[] {
  activateDueReminders();
  const db = getDb();
  const status = filters.status ?? "open";
  const dueFilter = filters.dueFilter ?? "any";
  const sort = filters.sort ?? "due";
  const order = filters.order ?? "asc";
  const q = (filters.q ?? "").trim();

  let sql =
    `SELECT ${TODO_ITEM_SELECT} FROM todos WHERE 1=1`;
  const params: (string | number)[] = [];

  if (status === "open") {
    sql += " AND completed = 0 AND archived = 0 AND (snoozed = 0 OR snoozed IS NULL)";
  } else if (status === "completed") {
    sql += " AND completed = 1 AND archived = 0";
  } else if (status === "archived") {
    sql += " AND archived = 1 AND (snoozed = 0 OR snoozed IS NULL)";
  } else if (status === "snoozed") {
    sql += " AND completed = 0 AND snoozed = 1";
  }

  if (filters.source_account_id != null && filters.source_account_id !== "") {
    sql += " AND source_account_id = ?";
    params.push(filters.source_account_id);
  }
  if (filters.source_chat_id != null && filters.source_chat_id !== "") {
    sql += " AND source_chat_id = ?";
    params.push(filters.source_chat_id);
  }

  if (filters.priority != null) {
    const p = filters.priority;
    const num =
      typeof p === "number"
        ? p
        : typeof p === "string"
          ? { high: 5, medium: 3, low: 1 }[p.toLowerCase()] ?? parseInt(String(p), 10)
          : null;
    if (num != null && !Number.isNaN(num)) {
      sql += " AND priority = ?";
      params.push(num);
    }
  }

  if (dueFilter === "overdue") {
    const today = new Date().toISOString().slice(0, 10);
    sql += " AND due_date IS NOT NULL AND due_date < ?";
    params.push(today);
  } else if (dueFilter === "due_today") {
    const today = new Date().toISOString().slice(0, 10);
    sql += " AND due_date = ?";
    params.push(today);
  }

  if (filters.list_id != null && filters.list_id !== "") {
    sql += " AND list_id = ?";
    params.push(filters.list_id);
  }

  if (q) {
    sql += " AND (title LIKE ? OR notes LIKE ? OR source_chat_name LIKE ?)";
    const like = `%${q.replace(/%/g, "\\%")}%`;
    params.push(like, like, like);
  }

  const orderCol =
    sort === "due"
      ? "due_date"
      : sort === "priority"
        ? "priority"
        : sort === "title"
          ? "title"
          : sort === "sort_order"
            ? "sort_order"
            : "created_at";
  const orderDir = order === "desc" ? "DESC" : "ASC";
  // Pinned items should always stay on top in open list.
  if (status === "open") {
    sql += ` ORDER BY COALESCE(pinned, 0) DESC, ${orderCol} ${orderDir}, sort_order ASC`;
  } else {
    sql += ` ORDER BY ${orderCol} ${orderDir}, sort_order ASC`;
  }

  const rows = db.prepare(sql).all(...params) as TodoItem[];
  return rows;
}

/** Check if a todo with same title (and optional source_chat_id) already exists (open, not archived). */
export function findDuplicateTodo(title: string, sourceChatId?: string | null): TodoItem | null {
  const db = getDb();
  const trimmed = title.trim();
  if (!trimmed) return null;
  let sql =
    `SELECT ${TODO_ITEM_SELECT} FROM todos WHERE completed = 0 AND archived = 0 AND trim(title) = ?`;
  const params: (string | null)[] = [trimmed];
  if (sourceChatId != null && sourceChatId !== "") {
    sql += " AND source_chat_id = ?";
    params.push(sourceChatId);
  }
  const row = db.prepare(sql).get(...params) as TodoItem | undefined;
  return row ?? null;
}

/** Create a todo. Returns the new todo or null if duplicate and skipDuplicates. */
export function createTodo(data: {
  id: string;
  title: string;
  notes?: string | null;
  due_date?: string | null;
  due_at?: number | null;
  due_time?: string | null;
  priority?: number | null;
  list_id?: string | null;
  source_chat_id?: string | null;
  source_chat_name?: string | null;
  source_account_id?: string | null;
  estimated_time_minutes?: number | null;
  skipDuplicates?: boolean;
}): { todo: TodoItem; duplicate: boolean } | null {
  const dup = findDuplicateTodo(data.title, data.source_chat_id);
  if (dup && data.skipDuplicates) return null;
  if (dup) throw new Error("DUPLICATE");

  const db = getDb();
  const t = now();
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order FROM todos").get() as { next_order: number };
  const estMin = data.estimated_time_minutes != null && Number.isFinite(data.estimated_time_minutes) && data.estimated_time_minutes >= 0 ? data.estimated_time_minutes : null;
  const dueResolved = resolveDueFields(data);
  const due_date = dueResolved?.due_date ?? data.due_date ?? null;
  const due_at = dueResolved?.due_at ?? data.due_at ?? null;
  db.prepare(
    `INSERT INTO todos (id, title, notes, due_date, due_at, completed, archived, priority, sort_order, list_id, source_chat_id, source_chat_name, source_account_id, created_at, updated_at, reminder_at, snoozed, pinned, estimated_time_minutes, external_google_task_id, google_sync_at, external_reclaim_task_id, reclaim_sync_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, NULL, NULL, NULL)`
  ).run(
    data.id,
    data.title.trim(),
    data.notes ?? null,
    due_date,
    due_at,
    data.priority ?? null,
    maxOrder.next_order,
    data.list_id ?? null,
    data.source_chat_id ?? null,
    data.source_chat_name ?? null,
    data.source_account_id ?? null,
    t,
    t,
    null,
    estMin
  );
  const row = db.prepare(`SELECT ${TODO_ITEM_SELECT} FROM todos WHERE id = ?`).get(data.id) as TodoItem;
  return { todo: row, duplicate: false };
}

/** Update a todo. */
export function updateTodo(
  id: string,
  data: Partial<
    Pick<
      TodoItem,
      "title" | "notes" | "due_date" | "due_at" | "completed" | "archived" | "priority" | "sort_order" | "list_id" | "source_chat_name" | "source_account_id" | "reminder_at" | "snoozed" | "pinned" | "estimated_time_minutes"
      | "external_google_task_id" | "google_sync_at"
      | "external_reclaim_task_id" | "reclaim_sync_at"
    >
  > & { due_time?: string | null }
): void {
  const db = getDb();
  const t = now();
  const fields: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [t];

  const dueResolved = resolveDueFields({
    due_date: data.due_date,
    due_at: data.due_at,
    due_time: data.due_time,
  });
  if (dueResolved) {
    data.due_date = dueResolved.due_date;
    data.due_at = dueResolved.due_at;
  }
  if (data.title !== undefined) {
    fields.push("title = ?");
    params.push(data.title.trim());
  }
  if (data.notes !== undefined) {
    fields.push("notes = ?");
    params.push(data.notes);
  }
  if (data.due_date !== undefined) {
    fields.push("due_date = ?");
    params.push(data.due_date);
  }
  if (data.due_at !== undefined) {
    fields.push("due_at = ?");
    params.push(data.due_at);
  }
  if (data.completed !== undefined) {
    fields.push("completed = ?");
    params.push(data.completed);
  }
  if (data.archived !== undefined) {
    fields.push("archived = ?");
    params.push(data.archived);
  }
  if (data.priority !== undefined) {
    fields.push("priority = ?");
    params.push(data.priority);
  }
  if (data.sort_order !== undefined) {
    fields.push("sort_order = ?");
    params.push(data.sort_order);
  }
  if (data.list_id !== undefined) {
    fields.push("list_id = ?");
    params.push(data.list_id);
  }
  if (data.source_chat_name !== undefined) {
    fields.push("source_chat_name = ?");
    params.push(data.source_chat_name);
  }
  if (data.source_account_id !== undefined) {
    fields.push("source_account_id = ?");
    params.push(data.source_account_id);
  }
  if (data.reminder_at !== undefined) {
    fields.push("reminder_at = ?");
    params.push(data.reminder_at);
  }
  if (data.snoozed !== undefined) {
    fields.push("snoozed = ?");
    params.push(data.snoozed);
  }
  if (data.pinned !== undefined) {
    fields.push("pinned = ?");
    params.push(data.pinned);
  }
  if (data.estimated_time_minutes !== undefined) {
    fields.push("estimated_time_minutes = ?");
    params.push(data.estimated_time_minutes == null || (typeof data.estimated_time_minutes === "number" && (Number.isNaN(data.estimated_time_minutes) || data.estimated_time_minutes < 0)) ? null : data.estimated_time_minutes);
  }
  if (data.external_google_task_id !== undefined) {
    fields.push("external_google_task_id = ?");
    params.push(data.external_google_task_id);
  }
  if (data.google_sync_at !== undefined) {
    fields.push("google_sync_at = ?");
    params.push(data.google_sync_at);
  }
  if (data.external_reclaim_task_id !== undefined) {
    fields.push("external_reclaim_task_id = ?");
    params.push(data.external_reclaim_task_id);
  }
  if (data.reclaim_sync_at !== undefined) {
    fields.push("reclaim_sync_at = ?");
    params.push(data.reclaim_sync_at);
  }
  params.push(id);
  db.prepare(`UPDATE todos SET ${fields.join(", ")} WHERE id = ?`).run(...params);
}

/** Delete a todo. */
export function deleteTodo(id: string): void {
  getDb().prepare("DELETE FROM todos WHERE id = ?").run(id);
}

/** Reorder todos by setting sort_order from ordered ids. */
export function reorderTodos(orderedIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare("UPDATE todos SET sort_order = ?, updated_at = ? WHERE id = ?");
  const t = now();
  orderedIds.forEach((id, index) => {
    stmt.run(index, t, id);
  });
}

/** Get count of open (not completed, not archived) todos per source_chat_id for given chatIds. */
export function getTodoCountByChat(chatIds: string[]): Record<string, number> {
  if (chatIds.length === 0) return {};
  const db = getDb();
  const placeholders = chatIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT source_chat_id AS chat_id, COUNT(*) AS cnt FROM todos WHERE source_chat_id IN (${placeholders}) AND completed = 0 AND archived = 0 GROUP BY source_chat_id`
    )
    .all(...chatIds) as Array<{ chat_id: string; cnt: number }>;
  const out: Record<string, number> = {};
  chatIds.forEach((id) => (out[id] = 0));
  rows.forEach((r) => (out[r.chat_id] = r.cnt));
  return out;
}
