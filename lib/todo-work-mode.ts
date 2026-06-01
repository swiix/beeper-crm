export type TodoWorkMode = "inbox" | "review" | "bulk";

const STORAGE_KEY = "beeper-crm:todoWorkMode";

export function getTodoWorkMode(): TodoWorkMode {
  if (typeof window === "undefined") return "inbox";
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === "review" || v === "bulk") return v;
  return "inbox";
}

export function setTodoWorkMode(mode: TodoWorkMode): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, mode);
}

export const TODO_INBOX_FILTER_KEY = "beeper-crm:todoInboxFilter";

export type TodoInboxFilterStored = "all" | "has_open" | "stale" | "never";

export function getTodoInboxFilter(): TodoInboxFilterStored {
  if (typeof window === "undefined") return "all";
  const v = localStorage.getItem(TODO_INBOX_FILTER_KEY);
  if (v === "has_open" || v === "stale" || v === "never") return v;
  return "all";
}

export function setTodoInboxFilter(filter: TodoInboxFilterStored): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TODO_INBOX_FILTER_KEY, filter);
}
