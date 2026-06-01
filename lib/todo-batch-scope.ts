export type TodoBatchScope = "all_visible" | "inbox_filtered" | "no_cache" | "stale";

export const TODO_BATCH_SCOPE_LABELS: Record<TodoBatchScope, string> = {
  all_visible: "Alle sichtbaren Chats",
  inbox_filtered: "Nur gefilterte Inbox",
  no_cache: "Nur ohne Cache",
  stale: "Nur veraltet",
};
