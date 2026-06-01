import type { BeeperChat } from "@/lib/types";

export type TodoChatInboxStatus =
  | "ignored"
  | "has_open"
  | "stale"
  | "analyzed_empty"
  | "never";

export type TodoSuggestionMetaRow = {
  suggestionCount: number;
  updatedAt: number | null;
  lastMessageSortKey: string | null;
  lastAnalyzedSortKey: string | null;
  todoPromptHash: string | null;
};

export function computeTodoChatInboxStatus(params: {
  chatId: string;
  ignored: boolean;
  openSuggestionCount: number;
  meta: TodoSuggestionMetaRow | undefined;
  chatLastActivity: string | null | undefined;
}): TodoChatInboxStatus {
  if (params.ignored) return "ignored";
  if (params.openSuggestionCount > 0) return "has_open";
  if (!params.meta) return "never";
  if (params.meta.suggestionCount === 0 && params.meta.lastMessageSortKey) {
    return "analyzed_empty";
  }
  if (params.meta.lastMessageSortKey && params.meta.lastAnalyzedSortKey) {
    if (params.meta.lastMessageSortKey !== params.meta.lastAnalyzedSortKey) return "stale";
  }
  if (params.chatLastActivity && params.meta.updatedAt) {
    try {
      const activityMs = new Date(params.chatLastActivity).getTime();
      const cacheMs = params.meta.updatedAt;
      if (!Number.isNaN(activityMs) && activityMs > cacheMs + 60_000) return "stale";
    } catch {
      /* ignore */
    }
  }
  if (params.meta.suggestionCount > 0) return "has_open";
  return params.meta.lastAnalyzedSortKey ? "analyzed_empty" : "never";
}

export const INBOX_STATUS_LABELS: Record<TodoChatInboxStatus, string> = {
  ignored: "Ignoriert",
  has_open: "Offene Vorschläge",
  stale: "Veraltet",
  analyzed_empty: "Analysiert, leer",
  never: "Noch nicht analysiert",
};

export const INBOX_STATUS_DOT_CLASS: Record<TodoChatInboxStatus, string> = {
  ignored: "bg-wa-text-secondary/40",
  has_open: "bg-wa-green",
  stale: "bg-amber-500",
  analyzed_empty: "bg-wa-text-secondary/60",
  never: "bg-blue-400",
};

export type TodoInboxFilterId = "all" | "has_open" | "stale" | "never";

export function chatMatchesInboxFilter(
  status: TodoChatInboxStatus,
  filter: TodoInboxFilterId
): boolean {
  if (filter === "all") return status !== "ignored";
  if (filter === "has_open") return status === "has_open";
  if (filter === "stale") return status === "stale";
  if (filter === "never") return status === "never" || status === "analyzed_empty";
  return true;
}

export function getChatLastActivityIso(chat: BeeperChat): string | null {
  const ta = chat.lastActivity ?? (chat.lastMessage as { timestamp?: string } | undefined)?.timestamp;
  return typeof ta === "string" && ta.trim() ? ta.trim() : null;
}
