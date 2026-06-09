"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import type { BeeperAccount, BeeperChat } from "@/lib/types";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import {
  getChatViewFilter,
  setChatViewFilter,
  getTodoListAccountId,
  setTodoListAccountId,
  getTodoAnalyzePrefs,
  setTodoAnalyzePrefs,
  type ChatListViewType,
  type SavedTodoAnalyzePrefs,
  type TodoAnalyzeAttachmentMode,
  type TodoAnalyzeMaxAgeUnit,
  type TodoAnalyzeScanMode,
} from "@/lib/settings";
import {
  pushTodoCompletionUndo,
  pushTodoSuggestionRejectUndo,
  pushTodoSuggestionAcceptUndo,
  pushTodoAcceptBatchUndo,
  registerTodoSuggestionUndoCallbacks,
  clearTodoSuggestionUndoFrames,
} from "@/lib/todo-completion-undo";
import { OnePromptResultsDialog } from "@/components/OnePromptResultsDialog";
import { DueDatePicker } from "@/components/DueDatePicker";
import { RichTextNotes } from "@/components/RichTextNotes";
import { TodoSyncBadge } from "@/components/todo/TodoSyncBadge";
import {
  buildAnalyzeRequestFields,
  type TodoAnalyzeSettingsValues,
} from "@/components/todo/TodoAnalyzeSettingsForm";
import {
  TodoAnalyzeSettingsDialog,
  type AnalyzeSettingsModalMode,
} from "@/components/todo/TodoAnalyzeSettingsDialog";
import { TodoAnalyzeCacheControl } from "@/components/todo/TodoAnalyzeCacheControl";
import { TodoInboxFilters } from "@/components/todo/TodoInboxFilters";
import {
  TodoSuggestionInlineEditor,
  type SuggestionEditFocus,
} from "@/components/todo/TodoSuggestionInlineEditor";
import {
  TodoSuggestionTriage,
  buildTriageQueue,
  type TriageQueueItem,
} from "@/components/todo/TodoSuggestionTriage";
import { SuggestionJumpToChatButton } from "@/components/todo/SuggestionJumpToChatButton";
import { TodoCommandPalette, WORK_MODE_LABELS, type TodoCommandAction } from "@/components/todo/TodoCommandPalette";
import {
  TodoGlassShell,
  TodoGlassPanel,
  TodoGlassPanelScroll,
  TodoGlassResizeHandle,
  TodoGlassSection,
  TodoGlassSegmentedControl,
  TodoGlassButton,
  TodoGlassInput,
  TodoGlassSelect,
  TodoGlassListRow,
} from "@/components/todo/glass";
import { buildAppUrl } from "@/lib/app-routes";
import {
  applyTodoAnalyzePreset,
  getLastTodoAnalyzePreset,
  suggestPresetForChat,
  type TodoAnalyzePresetId,
} from "@/lib/todo-analyze-presets";
import type { TodoBatchScope } from "@/lib/todo-batch-scope";
import { TODO_BATCH_SCOPE_LABELS } from "@/lib/todo-batch-scope";
import {
  chatMatchesInboxFilter,
  computeTodoChatInboxStatus,
  getChatLastActivityIso,
  INBOX_STATUS_DOT_CLASS,
  INBOX_STATUS_LABELS,
  type TodoChatInboxStatus,
  type TodoInboxFilterId,
} from "@/lib/todo-chat-inbox-status";
import { isTodoChatPinned, sortTodoChatIds, sortTodoChatsForDisplay } from "@/lib/todo-chat-sort";
import type { TodoSuggestionMeta } from "@/lib/todo-db";
import {
  getTodoInboxFilter,
  getTodoWorkMode,
  setTodoInboxFilter,
  setTodoWorkMode,
  type TodoWorkMode,
} from "@/lib/todo-work-mode";
import { chatMatchesSearchQuery } from "@/lib/chat-phone-search";
import { isEditableKeyboardTarget } from "@/lib/is-editable-keyboard-target";
import { suggestionToCreateTodoSyntax } from "@/lib/reclaim-task-syntax";
import {
  dueDateTimeToMs,
  formatDueDateTimeRelative,
  suggestionDueToDateTime,
  syncDueDateFromDateTime,
  todoDueToDateTime,
  type DueDateTime,
} from "@/lib/due-datetime";

type TodoSuggestionItem = {
  title: string;
  due: string | null;
  due_time?: string | null;
  priority?: number | string;
  notes?: string | null;
  category?: string | null;
  estimated_time_minutes?: number | null;
  estimated_time_hours?: number | null;
  mark_as_next?: boolean;
  reclaim_schedule_type?: "work" | "personal" | null;
  reclaim_not_before?: string | null;
  reclaim_no_split?: boolean;
};

type TodoItem = {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  due_at?: number | null;
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
  reminder_at?: number | null;
  snoozed?: number;
  pinned?: number;
  estimated_time_minutes?: number | null;
  external_google_task_id?: string | null;
  google_sync_at?: number | null;
  external_reclaim_task_id?: string | null;
  reclaim_sync_at?: number | null;
};

type OnePromptDialogResult = {
  chatId: string;
  chatName: string;
  matched: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  phones: string[];
  emails: string[];
  reason: string;
  output: string;
  outputType: "text" | "json";
  todo: {
    title: string;
    notes: string | null;
    due: string | null;
    priority: number | null;
  } | null;
};

type GoogleTasksStatus = {
  connected: boolean;
  needsReconnect?: boolean;
  expiry_date?: number | null;
};

type ReclaimStatus = {
  connected: boolean;
  tokenConfigured?: boolean;
  tokenHint?: string | null;
  email?: string | null;
};

type TodoListSettings = {
  todoSyncTarget?: "google" | "reclaim";
  autoSyncOnAccept?: boolean;
};

/** Compute reminder preset options (label + epoch ms). Uses local time for fixed clock times. */
function getReminderPresets(): { label: string; atMs: number }[] {
  const now = Date.now();
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");

  const setTime = (date: Date, hours: number, minutes: number) => {
    const x = new Date(date);
    x.setHours(hours, minutes, 0, 0);
    return x.getTime();
  };

  const tomorrow = new Date(d);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const in2 = new Date(d);
  in2.setDate(in2.getDate() + 2);
  const in3 = new Date(d);
  in3.setDate(in3.getDate() + 3);
  const in7 = new Date(d);
  in7.setDate(in7.getDate() + 7);

  const nextMonday = new Date(d);
  let day = nextMonday.getDay();
  const add = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  nextMonday.setDate(nextMonday.getDate() + add);
  const nextSunday = new Date(d);
  day = nextSunday.getDay();
  const addSun = day === 0 ? 7 : 7 - day;
  nextSunday.setDate(nextSunday.getDate() + addSun);

  const today20 = setTime(d, 20, 0);
  const presets: { label: string; atMs: number }[] = [
    { label: "In 5 Minuten", atMs: now + 5 * 60 * 1000 },
    { label: "In 30 Minuten", atMs: now + 30 * 60 * 1000 },
    { label: "In 1 Stunde", atMs: now + 60 * 60 * 1000 },
    { label: "Heute 20:00", atMs: today20 <= now ? setTime(tomorrow, 20, 0) : today20 },
    { label: "Morgen 6:00", atMs: setTime(tomorrow, 6, 0) },
    { label: "In 2 Tagen", atMs: in2.getTime() },
    { label: "In 3 Tagen", atMs: in3.getTime() },
    { label: "In 7 Tagen", atMs: in7.getTime() },
    { label: "Nächster Montag 6:00", atMs: setTime(nextMonday, 6, 0) },
    { label: "Nächster Sonntag 6:00", atMs: setTime(nextSunday, 6, 0) },
  ];
  return presets;
}

function formatReminderAt(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (isToday) return `Heute ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Morgen ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getDate()}.${pad(d.getMonth() + 1)}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Format AI-estimated time (minutes) for display: e.g. 15 -> "15 Min", 60 -> "1 h", 90 -> "1,5 h". */
function formatEstimatedTime(minutes: number): string {
  if (minutes < 60) return `${minutes} Min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  const decimal = h + m / 60;
  return `${decimal.toFixed(1).replace(".", ",")} h`;
}

type TodoListRecord = { id: string; name: string; sort_order: number };

function isTodoSuggestionItem(value: unknown): value is TodoSuggestionItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<TodoSuggestionItem>;
  return typeof item.title === "string";
}

function toTodoSuggestionList(value: unknown): TodoSuggestionItem[] {
  return Array.isArray(value) ? value.filter(isTodoSuggestionItem) : [];
}

type OpenAiUsageSummary = {
  days: number;
  sinceMs: number;
  totals: {
    category: string;
    model: string;
    request_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  byCategoryAndModel: Array<{
    category: string;
    model: string;
    request_count: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  }>;
};

function getAccountId(acc: BeeperAccount): string {
  return String((acc as { accountID?: string }).accountID ?? acc.id ?? "").trim();
}

/** Resolve display name for a todo's source chat: use stored name, or lookup from loaded chats when same account. */
function getTodoChatDisplayName(
  todo: TodoItem,
  currentAccountId: string | null,
  chats: BeeperChat[]
): string | null {
  const name = (todo.source_chat_name ?? "").trim();
  if (name) return name;
  if (!todo.source_chat_id || !currentAccountId || todo.source_account_id !== currentAccountId) return null;
  const chat = chats.find((c) => c.id === todo.source_chat_id);
  return (chat?.name ?? (chat as { participants?: Array<{ name?: string }> })?.participants?.[0]?.name) ?? null;
}

type ChatsPageResponse = { items?: BeeperChat[]; hasMore?: boolean; oldestCursor?: string; nextCursor?: string };

async function fetchChatsForAccount(accountId: string): Promise<BeeperChat[]> {
  const allItems: BeeperChat[] = [];
  let cursor: string | null = null;
  let hasMore = true;
  let pageCount = 0;
  const seenCursors = new Set<string>();
  while (hasMore) {
    pageCount += 1;
    const url =
      cursor == null
        ? `/api/chats?accountIDs=${encodeURIComponent(accountId)}`
        : `/api/chats?accountIDs=${encodeURIComponent(accountId)}&cursor=${encodeURIComponent(cursor)}&direction=before`;
    const res = await fetch(url);
    const data = (await res.json()) as ChatsPageResponse & { error?: string };
    if (!res.ok) {
      throw new Error(data?.error ?? "Chats konnten nicht geladen werden.");
    }
    const items = data.items ?? [];
    allItems.push(...items);
    const nextCursor = data.oldestCursor ?? data.nextCursor ?? null;
    const repeatedCursor = nextCursor != null && seenCursors.has(nextCursor);
    hasMore = (data.hasMore === true && nextCursor != null && !repeatedCursor) || false;
    if (nextCursor != null) seenCursors.add(nextCursor);
    cursor = nextCursor;
    // Safety guard if upstream cursor behavior is broken.
    if (pageCount >= 200) break;
  }
  const uniqueById = new Map<string, BeeperChat>();
  for (const chat of allItems) {
    if (chat?.id) uniqueById.set(chat.id, chat);
  }
  const singleAndGroup = Array.from(uniqueById.values()).filter((c) => {
    const t = (c.type ?? "").toLowerCase();
    return t === "single" || t === "group";
  });
  singleAndGroup.sort((a, b) => {
    const ta = a.lastActivity ?? (a.lastMessage as { timestamp?: string })?.timestamp ?? "";
    const tb = b.lastActivity ?? (b.lastMessage as { timestamp?: string })?.timestamp ?? "";
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
  return singleAndGroup;
}

async function fetchAccounts(): Promise<BeeperAccount[]> {
  const res = await fetch("/api/accounts");
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? "Accounts failed");
  const list = Array.isArray(data) ? data : (data as { items?: BeeperAccount[] }).items ?? [];
  return list;
}

const today = () => new Date().toISOString().slice(0, 10);

const IGNORED_CHATS_STORAGE_KEY = "beeper-crm:todo-ignored-chats";
const LEGACY_TODO_SUGGESTIONS_SESSION_KEY = "beeper-crm:todo-suggestions";
const ALL_CHATS_SENTINEL = "__all__";

function formatChatCountLabel(count: number): string {
  return count === 1 ? "1 Chat" : `${count} Chats`;
}

const TODO_SUGGESTIONS_VIEW_STORAGE_KEY = "beeper-crm:todo-suggestions-view";
const LAST_CHAT_STORAGE_KEY = "beeper-crm:todo-last-chat";
const META_FETCH_CHUNK = 200;
const MAX_VIEW_PROMPT_CHARS = 100_000;

type TodoSuggestionsViewStored = {
  promptSuffix: string;
  onePromptAllChats: string;
  leftTab: "dashboard" | "chats";
  chatSearchQuery: string;
};

const DEFAULT_TODO_SUGGESTIONS_VIEW: TodoSuggestionsViewStored = {
  promptSuffix: "",
  onePromptAllChats: "",
  leftTab: "chats",
  chatSearchQuery: "",
};

type TodoListPersistSnapshot = TodoSuggestionsViewStored;

function readStoredTodoSuggestionsView(): TodoSuggestionsViewStored {
  if (typeof window === "undefined") return DEFAULT_TODO_SUGGESTIONS_VIEW;
  try {
    const raw = localStorage.getItem(TODO_SUGGESTIONS_VIEW_STORAGE_KEY);
    if (!raw) return DEFAULT_TODO_SUGGESTIONS_VIEW;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: TodoSuggestionsViewStored = { ...DEFAULT_TODO_SUGGESTIONS_VIEW };
    if (typeof o.promptSuffix === "string") out.promptSuffix = o.promptSuffix.slice(0, MAX_VIEW_PROMPT_CHARS);
    if (typeof o.onePromptAllChats === "string") out.onePromptAllChats = o.onePromptAllChats.slice(0, MAX_VIEW_PROMPT_CHARS);
    if (o.leftTab === "dashboard" || o.leftTab === "chats") out.leftTab = o.leftTab;
    if (typeof o.chatSearchQuery === "string") out.chatSearchQuery = o.chatSearchQuery.slice(0, MAX_VIEW_PROMPT_CHARS);
    return out;
  } catch {
    return DEFAULT_TODO_SUGGESTIONS_VIEW;
  }
}

function writeStoredTodoSuggestionsView(form: TodoSuggestionsViewStored): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    TODO_SUGGESTIONS_VIEW_STORAGE_KEY,
    JSON.stringify({
      promptSuffix: form.promptSuffix.slice(0, MAX_VIEW_PROMPT_CHARS),
      onePromptAllChats: form.onePromptAllChats.slice(0, MAX_VIEW_PROMPT_CHARS),
      leftTab: form.leftTab,
      chatSearchQuery: form.chatSearchQuery.slice(0, MAX_VIEW_PROMPT_CHARS),
    })
  );
}

function formatSuggestionDue(s: TodoSuggestionItem): string {
  return formatDueDateTimeRelative(suggestionDueToDateTime(s.due, s.due_time));
}

function suggestionToDueApiFields(s: { due: string | null; due_time?: string | null }) {
  const dt = suggestionDueToDateTime(s.due, s.due_time);
  const due_at = dueDateTimeToMs(dt);
  return {
    due_date: syncDueDateFromDateTime(dt) ?? undefined,
    due_time: dt.time ?? undefined,
    due_at: due_at ?? undefined,
  };
}

/** Max concurrent todo-list analyze requests when loading suggestions for all visible chats. */
const TODO_ANALYZE_CONCURRENCY = 5;
/** Stop batch analyze after this many failures (remaining chats are skipped). */
const TODO_ANALYZE_MAX_FAILURES_BEFORE_STOP = 10;

export function TodoListView({ onOpenChat }: { onOpenChat: (chatId: string, accountId: string) => void }) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<"dashboard" | "chats">("chats");
  /** Multi-selection (Shift+click range). Empty when only single selection. */
  const [selectedChatIds, setSelectedChatIds] = useState<string[]>([]);
  const lastClickedIndexRef = useRef<number | null>(null);
  /** Chat id under the pointer in the suggestions list (for C shortcut in multi-chat views). */
  const hoveredSuggestionChatIdRef = useRef<string | null>(null);
  const { data: ignoredChatsData, mutate: mutateIgnoredChats } = useSWR<{ chatIds: string[] }>(
    "todo-ignored-chats",
    () => fetch("/api/settings/todo-ignored-chats").then((r) => r.json()),
    { revalidateOnFocus: true }
  );
  const ignoredChatIds = ignoredChatsData?.chatIds ?? [];

  const { data: pinnedChatsData, mutate: mutatePinnedChats } = useSWR<{ chatIds: string[] }>(
    "todo-pinned-chats",
    () => fetch("/api/settings/todo-pinned-chats").then((r) => r.json()),
    { revalidateOnFocus: true }
  );
  const pinnedChatIds = pinnedChatsData?.chatIds ?? [];

  const togglePinnedChat = useCallback(
    (chatId: string, pin: boolean) => {
      void mutatePinnedChats(async (current) => {
        try {
          const res = await fetch("/api/settings/todo-pinned-chats", {
            method: pin ? "POST" : "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId }),
          });
          if (!res.ok) return current;
          const data = (await res.json()) as { chatIds?: string[] };
          return { chatIds: data.chatIds ?? current?.chatIds ?? [] };
        } catch {
          return current;
        }
      }, false);
    },
    [mutatePinnedChats]
  );

  const updateIgnoredChatIds = useCallback(
    (updater: (prev: string[]) => string[]) => {
      void mutateIgnoredChats(async (current) => {
        const prev = current?.chatIds ?? [];
        const next = updater(prev);
        try {
          const res = await fetch("/api/settings/todo-ignored-chats", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatIds: next }),
          });
          if (!res.ok) return current;
          const data = (await res.json()) as { chatIds?: string[] };
          return { chatIds: data.chatIds ?? next };
        } catch {
          return current;
        }
      }, false);
    },
    [mutateIgnoredChats]
  );
  const [chatContextMenu, setChatContextMenu] = useState<{ chatId: string; x: number; y: number } | null>(null);
  /** Suggestions per chat — hydrated from SQLite via API; edits are persisted to disk. */
  const [suggestionsByChat, setSuggestionsByChat] = useState<Record<string, TodoSuggestionItem[]>>({});
  const suggestionsByChatRef = useRef(suggestionsByChat);
  suggestionsByChatRef.current = suggestionsByChat;
  const suggestionsHydratedRef = useRef(false);
  const persistDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const persistChatSuggestions = useCallback(async (chatId: string, todos: TodoSuggestionItem[]) => {
    try {
      const res = await fetch(`/api/todo-list/suggestions/${encodeURIComponent(chatId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todos }),
      });
      if (!res.ok) return;
      void globalMutate("todo-suggestions-disk");
    } catch {
      // best-effort; analyze route may have saved already
    }
  }, []);

  const schedulePersistChatSuggestions = useCallback(
    (chatId: string, todos: TodoSuggestionItem[]) => {
      const pending = persistDebounceRef.current.get(chatId);
      if (pending) clearTimeout(pending);
      persistDebounceRef.current.set(
        chatId,
        setTimeout(() => {
          persistDebounceRef.current.delete(chatId);
          void persistChatSuggestions(chatId, todos);
        }, 400)
      );
    },
    [persistChatSuggestions]
  );
  const schedulePersistRef = useRef(schedulePersistChatSuggestions);
  schedulePersistRef.current = schedulePersistChatSuggestions;
  const [analyzingChatIds, setAnalyzingChatIds] = useState<string[]>([]);
  const [analyzeErrorByChatId, setAnalyzeErrorByChatId] = useState<Record<string, string>>({});
  const [loadingAllSuggestions, setLoadingAllSuggestions] = useState(false);
  const [loadingAllProgress, setLoadingAllProgress] = useState<{ done: number; total: number; messagesLoaded: number } | null>(null);
  const [allSuggestionsQuery, setAllSuggestionsQuery] = useState("");
  /** Per-chat message fetch page count during analyze (for "Lade Nachrichten #N" display). */
  const [loadingMessagePagesByChatId, setLoadingMessagePagesByChatId] = useState<Record<string, number>>({});
  const [lastAnalyzedMessageCount, setLastAnalyzedMessageCount] = useState<number | null>(null);
  const [loadingAllError, setLoadingAllError] = useState<string | null>(null);
  const [acceptAllResult, setAcceptAllResult] = useState<{ inserted: number; skipped: number } | null>(null);
  const [todoStatus, setTodoStatus] = useState<"open" | "completed" | "archived" | "snoozed" | "all">("open");
  const [dueFilter, setDueFilter] = useState<"any" | "due_today" | "overdue">("any");
  const [searchQ, setSearchQ] = useState("");
  const [listIdFilter, setListIdFilter] = useState<string | null>(null);
  const [sourceAccountIdFilter, setSourceAccountIdFilter] = useState<string | null>(null);
  const [sourceChatIdFilter, setSourceChatIdFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<"due" | "priority" | "title" | "created" | "sort_order">("due");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [refreshingTodos, setRefreshingTodos] = useState(false);
  const [smartSortLoading, setSmartSortLoading] = useState(false);
  const [smartSortError, setSmartSortError] = useState<string | null>(null);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  /** Draft while editing todo notes (controlled textarea; Enter saves, Shift+Enter newline). */
  const [editingNotesDraft, setEditingNotesDraft] = useState("");
  /** Skip blur-save when Esc cancels inline todo field editing. */
  const todoTitleEscapeCancelRef = useRef(false);
  const todoDueEscapeCancelRef = useRef(false);
  const todoNotesEscapeCancelRef = useRef(false);
  const [editingDueId, setEditingDueId] = useState<string | null>(null);
  const [analyzeStep, setAnalyzeStep] = useState("");
  const [loadingAllStep, setLoadingAllStep] = useState("");
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [chatListView, setChatListView] = useState<ChatListViewType>("all");
  const [analyzePromptSuffix, setAnalyzePromptSuffix] = useState("");
  const [onePromptAllChats, setOnePromptAllChats] = useState("");
  const [onePromptDialogOpen, setOnePromptDialogOpen] = useState(false);
  const [onePromptResults, setOnePromptResults] = useState<OnePromptDialogResult[]>([]);
  const [onePromptRunLoading, setOnePromptRunLoading] = useState(false);
  const [onePromptRunError, setOnePromptRunError] = useState<string | null>(null);
  const [onePromptAcceptingByChatId, setOnePromptAcceptingByChatId] = useState<Record<string, boolean>>({});
  const [onePromptTargetCount, setOnePromptTargetCount] = useState(0);
  const [onePromptProcessedCount, setOnePromptProcessedCount] = useState(0);
  const [analyzeScanMode, setAnalyzeScanMode] = useState<TodoAnalyzeScanMode>(
    () => getTodoAnalyzePrefs().scanMode
  );
  const [analyzeMaxAgeValue, setAnalyzeMaxAgeValue] = useState<number>(
    () => getTodoAnalyzePrefs().maxAgeValue
  );
  const [analyzeMaxAgeUnit, setAnalyzeMaxAgeUnit] = useState<TodoAnalyzeMaxAgeUnit>(
    () => getTodoAnalyzePrefs().maxAgeUnit
  );
  const [analyzeMaxMessages, setAnalyzeMaxMessages] = useState<number>(
    () => getTodoAnalyzePrefs().maxMessages
  );
  const [analyzeAttachmentMode, setAnalyzeAttachmentMode] = useState<TodoAnalyzeAttachmentMode>(
    () => getTodoAnalyzePrefs().attachmentMode
  );
  const [analyzeForce, setAnalyzeForce] = useState(() => getTodoAnalyzePrefs().analyzeForce);
  const [usageDays, setUsageDays] = useState(() => getTodoAnalyzePrefs().usageDays);
  const [showAnalyzeSettingsModal, setShowAnalyzeSettingsModal] = useState(false);
  const [analyzeSettingsModalMode, setAnalyzeSettingsModalMode] = useState<AnalyzeSettingsModalMode>("all");
  const [analyzeSettingsDraft, setAnalyzeSettingsDraft] = useState<TodoAnalyzeSettingsValues | null>(null);
  const [modalInitialPreset, setModalInitialPreset] = useState<TodoAnalyzePresetId | null>(null);
  const [batchScope, setBatchScope] = useState<TodoBatchScope>("all_visible");
  const [inboxFilter, setInboxFilterState] = useState<TodoInboxFilterId>(() => getTodoInboxFilter());
  const [workMode, setWorkModeState] = useState<TodoWorkMode>(() => getTodoWorkMode());
  const [triageEnabled, setTriageEnabled] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [postAnalyzeBanner, setPostAnalyzeBanner] = useState<{
    suggestionCount: number;
    chatCount: number;
  } | null>(null);
  const [batchZeroResultsHint, setBatchZeroResultsHint] = useState(false);
  const [triageChatNameById, setTriageChatNameById] = useState<Record<string, string>>({});
  const [modalTargetChatIds, setModalTargetChatIds] = useState<string[]>([]);
  const [googleSyncLoadingByTodoId, setGoogleSyncLoadingByTodoId] = useState<Record<string, boolean>>({});
  const [googleSyncResultByTodoId, setGoogleSyncResultByTodoId] = useState<Record<string, { kind: "ok" | "error"; message: string }>>({});
  const [reclaimSyncLoadingByTodoId, setReclaimSyncLoadingByTodoId] = useState<Record<string, boolean>>({});
  const [reclaimSyncResultByTodoId, setReclaimSyncResultByTodoId] = useState<Record<string, { kind: "ok" | "error"; message: string }>>({});
  const [editingSuggestion, setEditingSuggestion] = useState<{
    chatId: string;
    index: number;
    focus?: SuggestionEditFocus;
  } | null>(null);
  /** Stable order for progressive batch suggestions (append-by-arrival) to avoid viewport jumps. */
  const [batchSuggestionChatOrder, setBatchSuggestionChatOrder] = useState<string[]>([]);
  const [suggestionContextMenu, setSuggestionContextMenu] = useState<{ chatId: string; x: number; y: number } | null>(null);
  const [col1Width, setCol1Width] = useState(256);
  const [col2Width, setCol2Width] = useState(420);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Scrollable column for suggestions. */
  const suggestionsColumnRef = useRef<HTMLDivElement>(null);
  /** AbortController for batch/selection analyze (Vorschläge für alle / Auswahl analysieren). */
  const analyzeBatchAbortRef = useRef<AbortController | null>(null);
  /** AbortController for single-chat analyze (Todo-Vorschläge laden). */
  const analyzeSingleAbortRef = useRef<AbortController | null>(null);
  /** Scroll container for "Alle Todos" list; used to preserve scroll when a todo is moved to remind-later. */
  const todosListScrollRef = useRef<HTMLUListElement>(null);
  /** Saved scrollTop to restore after reminder is set (item leaves open list). */
  const saveScrollTopAfterReminderRef = useRef<number | null>(null);
  const todoListPersistSnapshotRef = useRef<TodoListPersistSnapshot>(DEFAULT_TODO_SUGGESTIONS_VIEW);

  const patchAnalyzePrefs = useCallback((patch: Partial<SavedTodoAnalyzePrefs>) => {
    setTodoAnalyzePrefs(patch);
  }, []);

  const setAnalyzeCacheForce = useCallback(
    (force: boolean) => {
      setAnalyzeForce(force);
      patchAnalyzePrefs({ analyzeForce: force });
    },
    [patchAnalyzePrefs]
  );

  const getAnalyzeSettings = useCallback(
    (): TodoAnalyzeSettingsValues => ({
      promptSuffix: analyzePromptSuffix,
      onePromptAllChats: onePromptAllChats,
      scanMode: analyzeScanMode,
      maxAgeValue: analyzeMaxAgeValue,
      maxAgeUnit: analyzeMaxAgeUnit,
      maxMessages: analyzeMaxMessages,
      attachmentMode: analyzeAttachmentMode,
      analyzeForce: analyzeForce,
    }),
    [
      analyzePromptSuffix,
      onePromptAllChats,
      analyzeScanMode,
      analyzeMaxAgeValue,
      analyzeMaxAgeUnit,
      analyzeMaxMessages,
      analyzeAttachmentMode,
      analyzeForce,
    ]
  );

  const applyAnalyzeSettings = useCallback(
    (draft: TodoAnalyzeSettingsValues) => {
      setAnalyzePromptSuffix(draft.promptSuffix);
      setOnePromptAllChats(draft.onePromptAllChats);
      setAnalyzeScanMode(draft.scanMode);
      setAnalyzeMaxAgeValue(draft.maxAgeValue);
      setAnalyzeMaxAgeUnit(draft.maxAgeUnit);
      setAnalyzeMaxMessages(draft.maxMessages);
      setAnalyzeAttachmentMode(draft.attachmentMode);
      setAnalyzeForce(draft.analyzeForce);
      patchAnalyzePrefs({
        scanMode: draft.scanMode,
        maxAgeValue: draft.maxAgeValue,
        maxAgeUnit: draft.maxAgeUnit,
        maxMessages: draft.maxMessages,
        attachmentMode: draft.attachmentMode,
        analyzeForce: draft.analyzeForce,
      });
    },
    [patchAnalyzePrefs]
  );

  const openAnalyzeSettingsModal = useCallback(
    (
      mode: AnalyzeSettingsModalMode,
      options?: {
        presetId?: TodoAnalyzePresetId | null;
        targetChatIds?: string[];
        chat?: BeeperChat | null;
      }
    ) => {
      setAnalyzeSettingsModalMode(mode);
      let draft = getAnalyzeSettings();
      const preset =
        options?.presetId ??
        (mode === "single" && options?.chat
          ? suggestPresetForChat(options.chat)
          : getLastTodoAnalyzePreset()) ??
        "daily_fast";
      if (preset && preset !== "custom") draft = applyTodoAnalyzePreset(preset, draft);
      setModalInitialPreset(preset);
      setAnalyzeSettingsDraft(draft);
      setModalTargetChatIds(options?.targetChatIds ?? []);
      setShowAnalyzeSettingsModal(true);
    },
    [getAnalyzeSettings]
  );

  const closeAnalyzeSettingsModal = useCallback(() => {
    setShowAnalyzeSettingsModal(false);
    setAnalyzeSettingsDraft(null);
  }, []);

  const MIN_COL1 = 160;
  const MIN_COL2 = 240;
  const MIN_COL3 = 200;
  const HANDLE_WIDTH = 6;
  /** Shell padding (p-2×2) + flex gaps (gap-2×4) + resize handles */
  const SHELL_CHROME_WIDTH = 16 + 4 * 8 + 2 * HANDLE_WIDTH;

  const handleResizeMouseDown = useCallback((col: 1 | 2) => (e: React.MouseEvent) => {
    e.preventDefault();
    const startCol1 = col1Width;
    const startWidth = col === 1 ? col1Width : col2Width;
    const state = { col, startX: e.clientX, startWidth, startCol1Width: startCol1 };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (moveEvent: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const delta = moveEvent.clientX - state.startX;
      if (state.col === 1) {
        const maxCol1 = rect.width - MIN_COL2 - MIN_COL3 - SHELL_CHROME_WIDTH;
        setCol1Width(Math.min(maxCol1, Math.max(MIN_COL1, state.startWidth + delta)));
      } else {
        const maxCol2 = rect.width - state.startCol1Width - MIN_COL3 - SHELL_CHROME_WIDTH;
        setCol2Width(Math.min(maxCol2, Math.max(MIN_COL2, state.startWidth + delta)));
      }
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [col1Width, col2Width]);

  /** Esc: cancel inline editors / modals first (no blur-save), then reset chat UI. */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editingSuggestion) {
        return;
      }
      if (editingNotesId) {
        e.preventDefault();
        todoNotesEscapeCancelRef.current = true;
        setEditingNotesId(null);
        return;
      }
      if (editingTodoId) {
        e.preventDefault();
        todoTitleEscapeCancelRef.current = true;
        setEditingTodoId(null);
        return;
      }
      if (editingDueId) {
        e.preventDefault();
        todoDueEscapeCancelRef.current = true;
        setEditingDueId(null);
        return;
      }
      if (showAnalyzeSettingsModal) {
        e.preventDefault();
        closeAnalyzeSettingsModal();
        return;
      }
      if (onePromptDialogOpen) {
        e.preventDefault();
        setOnePromptDialogOpen(false);
        return;
      }
      setSelectedChatIds([]);
      setSelectedChatId(null);
      setLeftTab("chats");
      setChatContextMenu(null);
      setSuggestionContextMenu(null);
      lastClickedIndexRef.current = null;
      (document.activeElement as HTMLElement)?.blur?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editingSuggestion,
    editingNotesId,
    editingTodoId,
    editingDueId,
    showAnalyzeSettingsModal,
    onePromptDialogOpen,
    closeAnalyzeSettingsModal,
  ]);

  useEffect(() => {
    setChatListView(getChatViewFilter().chatListView);
  }, []);

  useEffect(() => {
    if (selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL && typeof window !== "undefined") {
      sessionStorage.setItem(LAST_CHAT_STORAGE_KEY, selectedChatId);
    }
  }, [selectedChatId]);

  /** Cmd/Ctrl+Z: restore rejected suggestions, un-accept single/batch (delete created todos + restore list). */
  useEffect(() => {
    registerTodoSuggestionUndoCallbacks({
      insertSuggestionAt: (chatId, index, item) => {
        setSuggestionsByChat((prev) => {
          const list = prev[chatId] ?? [];
          const next = [...list];
          const at = Math.min(Math.max(0, index), next.length);
          next.splice(at, 0, { ...item });
          schedulePersistRef.current(chatId, next);
          return { ...prev, [chatId]: next };
        });
      },
      setSuggestionsForChat: (chatId, items) => {
        const next = items.map((i) => ({ ...i }));
        schedulePersistRef.current(chatId, next);
        setSuggestionsByChat((prev) => ({
          ...prev,
          [chatId]: next,
        }));
      },
    });
    return () => {
      clearTodoSuggestionUndoFrames();
      registerTodoSuggestionUndoCallbacks(null);
    };
  }, []);

  /** Load persisted Vorschläge view fields (prompts, tab, search) before paint. */
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const view = readStoredTodoSuggestionsView();
    setAnalyzePromptSuffix(view.promptSuffix);
    setOnePromptAllChats(view.onePromptAllChats);
    setLeftTab(view.leftTab);
    setChatSearchQuery(view.chatSearchQuery);
    todoListPersistSnapshotRef.current = view;
  }, []);

  useLayoutEffect(() => {
    todoListPersistSnapshotRef.current = {
      promptSuffix: analyzePromptSuffix,
      onePromptAllChats,
      leftTab,
      chatSearchQuery,
    };
  }, [analyzePromptSuffix, onePromptAllChats, leftTab, chatSearchQuery]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const flushTodoSuggestionsView = () => {
      writeStoredTodoSuggestionsView(todoListPersistSnapshotRef.current);
    };
    window.addEventListener("pagehide", flushTodoSuggestionsView);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushTodoSuggestionsView();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flushTodoSuggestionsView);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const t = window.setTimeout(() => {
      writeStoredTodoSuggestionsView(todoListPersistSnapshotRef.current);
    }, 350);
    return () => clearTimeout(t);
  }, [analyzePromptSuffix, onePromptAllChats, leftTab, chatSearchQuery]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(IGNORED_CHATS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      localStorage.removeItem(IGNORED_CHATS_STORAGE_KEY);
      if (!Array.isArray(parsed)) return;
      const legacy = parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
      if (legacy.length === 0) return;
      void (async () => {
        try {
          const res = await fetch("/api/settings/todo-ignored-chats");
          const data = (await res.json()) as { chatIds?: string[] };
          const existing = data.chatIds ?? [];
          const merged = [...new Set([...existing, ...legacy])];
          await fetch("/api/settings/todo-ignored-chats", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatIds: merged }),
          });
          void mutateIgnoredChats();
        } catch {
          /* best-effort migration */
        }
      })();
    } catch {
      localStorage.removeItem(IGNORED_CHATS_STORAGE_KEY);
    }
  }, [mutateIgnoredChats]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    sessionStorage.removeItem(LEGACY_TODO_SUGGESTIONS_SESSION_KEY);
  }, []);

  useEffect(() => {
    if (!chatContextMenu && !suggestionContextMenu) return;
    const closeMenus = () => {
      setChatContextMenu(null);
      setSuggestionContextMenu(null);
    };
    window.addEventListener("click", closeMenus);
    return () => window.removeEventListener("click", closeMenus);
  }, [chatContextMenu, suggestionContextMenu]);

  const TODO_ANALYSIS_STEPS = ["Lade Nachrichten…", "Transkribiere & Bilder…", "KI extrahiert Todos…"];
  const isCurrentChatAnalyzing = selectedChatId != null && analyzingChatIds.includes(selectedChatId);
  const [analyzeStepIndex, setAnalyzeStepIndex] = useState(0);
  useEffect(() => {
    if (!isCurrentChatAnalyzing) {
      setAnalyzeStep("");
      setAnalyzeStepIndex(0);
      return;
    }
    setAnalyzeStep(TODO_ANALYSIS_STEPS[0]);
    setAnalyzeStepIndex(0);
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % TODO_ANALYSIS_STEPS.length;
      setAnalyzeStepIndex(i);
      setAnalyzeStep(TODO_ANALYSIS_STEPS[i]);
    }, 2500);
    return () => clearInterval(id);
  }, [isCurrentChatAnalyzing]);

  useEffect(() => {
    if (!loadingAllSuggestions) {
      setLoadingAllStep("");
      return;
    }
    setLoadingAllStep(TODO_ANALYSIS_STEPS[0]);
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % TODO_ANALYSIS_STEPS.length;
      setLoadingAllStep(TODO_ANALYSIS_STEPS[i]);
    }, 2500);
    return () => clearInterval(id);
  }, [loadingAllSuggestions]);

  const {
    data: accounts = [],
    error: accountsError,
    isLoading: accountsLoading,
    mutate: mutateAccounts,
  } = useSWR<BeeperAccount[]>("accounts", fetchAccounts);

  const hasRestoredAccountRef = useRef(false);
  useEffect(() => {
    if (accounts.length === 0 || hasRestoredAccountRef.current) return;
    const saved = getTodoListAccountId();
    if (!saved) return;
    const exists = accounts.some((a) => getAccountId(a) === saved);
    if (exists) {
      setSelectedAccountId(saved);
      hasRestoredAccountRef.current = true;
    }
  }, [accounts]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem("todoPromptChanged") === "1") {
      sessionStorage.removeItem("todoPromptChanged");
      setSuggestionsByChat({});
      setAcceptAllResult(null);
      void globalMutate("todo-suggestions-disk", {}, false);
    }
  }, []);

  useEffect(() => {
    setLastAnalyzedMessageCount(null);
  }, [selectedChatId]);

  const accountId = selectedAccountId ?? (accounts.length > 0 ? getAccountId(accounts[0]) : null);
  const isWhatsAppAccount =
    accounts.find((a) => getAccountId(a) === accountId)?.network?.toLowerCase() === "whatsapp";

  const {
    data: chats = [],
    error: chatsError,
    isLoading: chatsLoading,
    mutate: mutateChats,
  } = useSWR<BeeperChat[]>(
    accountId ? ["todo-chats", accountId] : null,
    () => (accountId ? fetchChatsForAccount(accountId) : [])
  );

  const chatIdsForSuggestions = chats.map((c) => c.id).filter(Boolean);
  const suggestionsSwrKey =
    chatIdsForSuggestions.length > 0
      ? (["todo-suggestions-disk", chatIdsForSuggestions.join(",")] as const)
      : ("todo-suggestions-disk" as const);

  const { data: diskSuggestions } = useSWR<Record<string, TodoSuggestionItem[]>>(
    suggestionsSwrKey,
    async () => {
      const query =
        chatIdsForSuggestions.length > 0
          ? `?chat_ids=${chatIdsForSuggestions.map(encodeURIComponent).join(",")}`
          : "";
      const res = await fetch(`/api/todo-list/suggestions${query}`);
      const data = (await res.json().catch(() => ({}))) as {
        suggestions?: Record<string, TodoSuggestionItem[]>;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Vorschläge-Cache konnte nicht geladen werden");
      return data.suggestions ?? {};
    },
    { revalidateOnFocus: true, dedupingInterval: 5000 }
  );

  useEffect(() => {
    if (!diskSuggestions) return;
    setSuggestionsByChat((prev) => ({ ...prev, ...diskSuggestions }));
    suggestionsHydratedRef.current = true;
  }, [diskSuggestions]);

  const { data: googleTasksStatus, mutate: mutateGoogleTasksStatus } = useSWR<GoogleTasksStatus>(
    "google-tasks-status",
    () => fetch("/api/google-tasks/status").then((r) => r.json()),
    { revalidateOnFocus: true }
  );
  const { data: reclaimStatus, mutate: mutateReclaimStatus } = useSWR<ReclaimStatus>(
    "reclaim-status",
    () => fetch("/api/reclaim/status").then((r) => r.json()),
    { revalidateOnFocus: true }
  );
  const { data: todoListSettings } = useSWR<TodoListSettings>(
    "todo-list-settings",
    () => fetch("/api/settings/todo-list").then((r) => r.json()),
    { revalidateOnFocus: true }
  );
  const todoSyncTarget = todoListSettings?.todoSyncTarget === "reclaim" ? "reclaim" : "google";

  const filteredChatsForList = useMemo(() => {
    let list = chats;
    switch (chatListView) {
      case "private":
        list = list.filter((c) => !c.isArchived && (c.type ?? "").toLowerCase() !== "group");
        break;
      case "groups":
        list = list.filter((c) => (c.type ?? "").toLowerCase() === "group");
        break;
      case "archived":
        list = list.filter((c) => !!c.isArchived);
        break;
      default:
        break;
    }
    const q = chatSearchQuery.trim();
    if (!q) return list;
    return list.filter((c) => chatMatchesSearchQuery(c, q, { searchPhones: isWhatsAppAccount }));
  }, [chats, chatListView, chatSearchQuery, isWhatsAppAccount]);

  const sortedChatsForList = useMemo(
    () => sortTodoChatsForDisplay(filteredChatsForList, pinnedChatIds),
    [filteredChatsForList, pinnedChatIds]
  );

  const chatsAvailableForAnalysis = useMemo(
    () => sortedChatsForList.filter((c) => !ignoredChatIds.includes(c.id)),
    [sortedChatsForList, ignoredChatIds]
  );

  const visibleChatIds = useMemo(
    () => sortedChatsForList.map((c) => c.id).filter(Boolean) as string[],
    [sortedChatsForList]
  );

  const { data: suggestionsMeta = {} } = useSWR<Record<string, TodoSuggestionMeta>>(
    visibleChatIds.length > 0 ? ["todo-suggestions-meta", visibleChatIds.length, accountId] : null,
    async () => {
      const merged: Record<string, TodoSuggestionMeta> = {};
      for (let i = 0; i < visibleChatIds.length; i += META_FETCH_CHUNK) {
        const chunk = visibleChatIds.slice(i, i + META_FETCH_CHUNK);
        const res = await fetch("/api/todo-list/suggestions/meta", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatIds: chunk }),
        });
        const data = (await res.json()) as { meta?: Record<string, TodoSuggestionMeta> };
        Object.assign(merged, data.meta ?? {});
      }
      return merged;
    },
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  );

  const chatInboxStatusById = useMemo(() => {
    const out: Record<string, TodoChatInboxStatus> = {};
    for (const chat of filteredChatsForList) {
      if (!chat.id) continue;
      const openCount = suggestionsByChat[chat.id]?.length ?? 0;
      out[chat.id] = computeTodoChatInboxStatus({
        chatId: chat.id,
        ignored: ignoredChatIds.includes(chat.id),
        openSuggestionCount: openCount,
        meta: suggestionsMeta[chat.id],
        chatLastActivity: getChatLastActivityIso(chat),
      });
    }
    return out;
  }, [filteredChatsForList, suggestionsByChat, suggestionsMeta, ignoredChatIds]);

  const inboxFilteredChats = useMemo(() => {
    return sortedChatsForList.filter((c) => {
      if (!c.id) return false;
      const status = chatInboxStatusById[c.id] ?? "never";
      return chatMatchesInboxFilter(status, inboxFilter);
    });
  }, [sortedChatsForList, chatInboxStatusById, inboxFilter]);

  const batchTargetChats = useMemo(() => {
    const base = chatsAvailableForAnalysis;
    if (batchScope === "all_visible") return base;
    if (batchScope === "inbox_filtered") {
      return base.filter((c) => c.id && inboxFilteredChats.some((x) => x.id === c.id));
    }
    if (batchScope === "stale") {
      return base.filter((c) => c.id && chatInboxStatusById[c.id] === "stale");
    }
    if (batchScope === "no_cache") {
      return base.filter((c) => c.id && (chatInboxStatusById[c.id] === "never" || chatInboxStatusById[c.id] === "stale"));
    }
    return base;
  }, [batchScope, chatsAvailableForAnalysis, inboxFilteredChats, chatInboxStatusById]);

  const batchTargetChatIds = useMemo(
    () => batchTargetChats.map((c) => c.id).filter(Boolean) as string[],
    [batchTargetChats]
  );

  const chatNameByIdMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of chats) {
      if (!c.id) continue;
      m.set(c.id, (c.name ?? c.participants?.[0]?.name ?? c.id.slice(0, 8)) as string);
    }
    return m;
  }, [chats]);

  const triageQueue = useMemo(() => {
    const chatsById = new Map(chats.map((c) => [c.id, c]));
    const queue = buildTriageQueue(suggestionsByChat, chatNameByIdMap, pinnedChatIds, chatsById);
    if (Object.keys(triageChatNameById).length === 0) return queue;
    return queue.map((item) => ({
      ...item,
      chatName: triageChatNameById[item.chatId] ?? item.chatName,
    }));
  }, [suggestionsByChat, chatNameByIdMap, triageChatNameById, pinnedChatIds, chats]);

  const setInboxFilter = useCallback((id: TodoInboxFilterId) => {
    setInboxFilterState(id);
    setTodoInboxFilter(id);
  }, []);

  const setWorkMode = useCallback((mode: TodoWorkMode) => {
    setWorkModeState(mode);
    setTodoWorkMode(mode);
    if (mode === "review") setTriageEnabled(true);
  }, []);

  useEffect(() => {
    if (workMode === "review") setTriageEnabled(true);
  }, [workMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resolveSuggestionJumpChatId = useCallback((): string | null => {
    if (hoveredSuggestionChatIdRef.current) return hoveredSuggestionChatIdRef.current;
    if (selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL) return selectedChatId;
    return null;
  }, [selectedChatId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "c") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableKeyboardTarget(e.target)) return;
      if (commandPaletteOpen || showAnalyzeSettingsModal || onePromptDialogOpen) return;
      if (editingSuggestion) return;
      if (triageEnabled && leftTab !== "dashboard" && triageQueue.length > 0) return;

      const chatId = resolveSuggestionJumpChatId();
      if (!chatId || !accountId) return;

      e.preventDefault();
      onOpenChat(chatId, accountId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    accountId,
    commandPaletteOpen,
    editingSuggestion,
    leftTab,
    onOpenChat,
    onePromptDialogOpen,
    resolveSuggestionJumpChatId,
    showAnalyzeSettingsModal,
    triageEnabled,
    triageQueue.length,
  ]);

  const resolveModalChatIds = useCallback((): string[] => {
    if (modalTargetChatIds.length > 0) return modalTargetChatIds;
    if (analyzeSettingsModalMode === "single" && selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL) {
      return [selectedChatId];
    }
    if (analyzeSettingsModalMode === "selection") {
      const baseIds =
        selectedChatIds.length > 0
          ? selectedChatIds
          : selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL
            ? [selectedChatId]
            : [];
      return baseIds.filter((id) => !ignoredChatIds.includes(id));
    }
    return batchTargetChatIds;
  }, [
    modalTargetChatIds,
    analyzeSettingsModalMode,
    selectedChatId,
    selectedChatIds,
    ignoredChatIds,
    batchTargetChatIds,
  ]);

  const analyzeMaxAgeDays = useMemo(() => {
    const value = Math.max(1, Math.round(analyzeMaxAgeValue || getTodoAnalyzePrefs().maxAgeValue));
    if (analyzeMaxAgeUnit === "weeks") return value * 7;
    if (analyzeMaxAgeUnit === "months") return value * 30;
    return value;
  }, [analyzeMaxAgeUnit, analyzeMaxAgeValue]);

  const selectedAnalyzeChatCount = useMemo(() => {
    const baseIds =
      selectedChatIds.length > 0
        ? selectedChatIds
        : selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL
          ? [selectedChatId]
          : [];
    return baseIds.filter((id) => !ignoredChatIds.includes(id)).length;
  }, [selectedChatIds, selectedChatId, ignoredChatIds]);

  const ignoreChatForFutureSuggestions = useCallback((chatId: string) => {
    updateIgnoredChatIds((prev) => (prev.includes(chatId) ? prev : [...prev, chatId]));
    setSuggestionsByChat((prev) => {
      schedulePersistRef.current(chatId, []);
      return { ...prev, [chatId]: [] };
    });
    setSuggestionContextMenu(null);
    if (selectedChatId === chatId) {
      setSelectedChatId(ALL_CHATS_SENTINEL);
      setSelectedChatIds([]);
    }
  }, [selectedChatId, updateIgnoredChatIds]);

  const chatIds = chats.map((c) => c.id).filter(Boolean);
  const { data: countByChat = {}, mutate: mutateCount } = useSWR<Record<string, number>>(
    chatIds.length > 0 ? ["todo-count-by-chat", chatIds.join(",")] : null,
    () =>
      fetch(`/api/todo-list/todos/count-by-chat?chatIds=${chatIds.map(encodeURIComponent).join(",")}`)
        .then((r) => r.json())
  );

  const todosParams = new URLSearchParams();
  todosParams.set("status", todoStatus);
  todosParams.set("dueFilter", dueFilter);
  todosParams.set("sort", sort);
  todosParams.set("order", order);
  if (searchQ.trim()) todosParams.set("q", searchQ.trim());
  if (listIdFilter) todosParams.set("list_id", listIdFilter);
  if (sourceAccountIdFilter) todosParams.set("source_account_id", sourceAccountIdFilter);
  if (sourceChatIdFilter) todosParams.set("source_chat_id", sourceChatIdFilter);
  const { data: todos = [], mutate: mutateTodos } = useSWR<TodoItem[]>(
    ["todo-list-todos", todosParams.toString()],
    () => fetch(`/api/todo-list/todos?${todosParams}`).then((r) => r.json())
  );

  /** Restore scroll position after a todo was moved to remind-later so the list doesn't jump. */
  useEffect(() => {
    const saved = saveScrollTopAfterReminderRef.current;
    const el = todosListScrollRef.current;
    if (el != null && saved != null) {
      el.scrollTop = saved;
      saveScrollTopAfterReminderRef.current = null;
    }
  }, [todos]);

  const { data: lists = [], mutate: mutateLists } = useSWR<TodoListRecord[]>(
    "todo-lists",
    () => fetch("/api/todo-list/lists").then((r) => r.json())
  );

  const { data: usageSummary } = useSWR<OpenAiUsageSummary>(
    ["openai-usage-summary", usageDays],
    () => fetch(`/api/openai-usage/summary?days=${encodeURIComponent(String(usageDays))}`).then((r) => r.json())
  );

  const runAnalyze = useCallback(async (settingsOverride?: TodoAnalyzeSettingsValues) => {
    if (!selectedChatId) return;
    const settings = settingsOverride ?? getAnalyzeSettings();
    const analyzeFields = buildAnalyzeRequestFields(settings);
    setSuggestionsByChat({});
    const chatId = selectedChatId;
    if (analyzeSingleAbortRef.current) analyzeSingleAbortRef.current.abort();
    const controller = new AbortController();
    analyzeSingleAbortRef.current = controller;
    const signal = controller.signal;
    const chat = chats.find((c) => c.id === chatId);
    const contactName =
      (chat?.name ?? (chat as { participants?: Array<{ name?: string }> })?.participants?.[0]?.name) ?? undefined;
    setAnalyzingChatIds((prev) => (prev.includes(chatId) ? prev : [...prev, chatId]));
    setLoadingMessagePagesByChatId((prev) => ({ ...prev, [chatId]: 0 }));
    setAnalyzeErrorByChatId((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    setAcceptAllResult(null);
    setLastAnalyzedMessageCount(null);
    try {
      const res = await fetch("/api/todo-list/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          accountId: accountId ?? undefined,
          contactName: contactName ?? undefined,
          promptSuffix: analyzeFields.promptSuffix,
          messageScanMode: analyzeFields.messageScanMode,
          maxMessages: analyzeFields.maxMessages,
          maxMessageAgeDays: analyzeFields.maxMessageAgeDays,
          attachmentMode: analyzeFields.attachmentMode,
          force: analyzeFields.force,
          stream: true,
        }),
        signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string })?.error ?? "Analyse fehlgeschlagen");
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/x-ndjson") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let result: { todos: unknown[]; message_count: number } | null = null;
        while (true) {
          if (signal.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const event = JSON.parse(trimmed) as { type: string; page?: number; todos?: unknown[]; message_count?: number; error?: string };
              if (event.type === "messages_page" && typeof event.page === "number") {
                setLoadingMessagePagesByChatId((prev) => ({ ...prev, [chatId]: event.page! }));
              } else if (event.type === "result") {
                result = { todos: event.todos ?? [], message_count: event.message_count ?? 0 };
              } else if (event.type === "error") {
                throw new Error(event.error ?? "Analyse fehlgeschlagen");
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
        if (result) {
          const list = toTodoSuggestionList(result.todos);
          setSuggestionsByChat((prev) => ({ ...prev, [chatId]: list }));
          if (typeof result.message_count === "number") setLastAnalyzedMessageCount(result.message_count);
        }
      } else {
        const data = await res.json();
        const list = toTodoSuggestionList((data as { todos?: unknown }).todos);
        setSuggestionsByChat((prev) => ({ ...prev, [chatId]: list }));
        const msgCount = typeof (data as { message_count?: number }).message_count === "number" ? (data as { message_count: number }).message_count : null;
        if (msgCount != null) setLastAnalyzedMessageCount(msgCount);
      }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setAnalyzeErrorByChatId((prev) => ({
        ...prev,
        [chatId]: e instanceof Error ? e.message : "Analyse fehlgeschlagen",
      }));
    } finally {
      setLoadingMessagePagesByChatId((prev) => {
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
      analyzeSingleAbortRef.current = null;
      setAnalyzingChatIds((prev) => prev.filter((id) => id !== chatId));
    }
  }, [selectedChatId, accountId, chats, getAnalyzeSettings]);

  const cancelAnalyzeSingle = useCallback(() => {
    if (analyzeSingleAbortRef.current) {
      analyzeSingleAbortRef.current.abort();
      analyzeSingleAbortRef.current = null;
    }
  }, []);

  const runAnalyzeForAllVisible = useCallback(
    async (
      settingsOverride?: TodoAnalyzeSettingsValues,
      onePromptOverride?: string,
      targetChats?: BeeperChat[]
    ) => {
    const chatList = targetChats ?? chatsAvailableForAnalysis;
    if (chatList.length === 0 || !accountId) return;
    const settings = settingsOverride ?? getAnalyzeSettings();
    const analyzeFields = buildAnalyzeRequestFields(settings);
    setSuggestionsByChat({});
    setBatchSuggestionChatOrder([]);
    if (analyzeBatchAbortRef.current) analyzeBatchAbortRef.current.abort();
    const controller = new AbortController();
    analyzeBatchAbortRef.current = controller;
    const signal = controller.signal;
    const onePrompt = (onePromptOverride ?? analyzeFields.onePrompt ?? "").trim() || undefined;
    const promptSuffix = onePrompt ? undefined : analyzeFields.promptSuffix;
    setLoadingAllSuggestions(true);
    setBatchZeroResultsHint(false);
    setLoadingAllError(null);
    setLoadingMessagePagesByChatId({});
    setLoadingAllProgress({ done: 0, total: chatList.length, messagesLoaded: 0 });
    const ids = chatList.map((c) => c.id).filter(Boolean) as string[];
    const doneRef = { current: 0 };
    const failedRef = { current: 0 };
    const stoppedEarlyAfterFailuresRef = { current: false };
    const messagesLoadedRef = { current: 0 };
    const chatNameById = new Map(
      chatList.map((c) => [c.id, (c.name ?? (c as { participants?: Array<{ name?: string }> })?.participants?.[0]?.name) ?? ""])
    );
    try {
      await runWithConcurrency(TODO_ANALYZE_CONCURRENCY, ids, async (chatId) => {
        if (signal.aborted || failedRef.current >= TODO_ANALYZE_MAX_FAILURES_BEFORE_STOP) return;
        const contactName = chatNameById.get(chatId) || undefined;
        try {
          const res = await fetch("/api/todo-list/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              accountId,
              contactName,
              promptSuffix,
              onePrompt,
              messageScanMode: analyzeFields.messageScanMode,
              maxMessages: analyzeFields.maxMessages,
              maxMessageAgeDays: analyzeFields.maxMessageAgeDays,
              attachmentMode: analyzeFields.attachmentMode,
              force: analyzeFields.force,
              stream: true,
            }),
            signal,
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error ?? "Analyse fehlgeschlagen");
          }
          const contentType = res.headers.get("content-type") ?? "";
          if (contentType.includes("application/x-ndjson") && res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let result: { todos: unknown[]; message_count: number } | null = null;
            while (true) {
              if (signal.aborted) break;
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const event = JSON.parse(trimmed) as { type: string; page?: number; todos?: unknown[]; message_count?: number; error?: string };
                  if (event.type === "messages_page" && typeof event.page === "number") {
                    setLoadingMessagePagesByChatId((prev) => ({ ...prev, [chatId]: event.page! }));
                  } else if (event.type === "result") {
                    result = { todos: event.todos ?? [], message_count: event.message_count ?? 0 };
                  } else if (event.type === "error") {
                    throw new Error(event.error ?? "Analyse fehlgeschlagen");
                  }
                } catch (err) {
                  if (!(err instanceof SyntaxError)) throw err;
                }
              }
            }
            if (result) {
              const todos = toTodoSuggestionList(result.todos);
              const msgCount = typeof result.message_count === "number" ? result.message_count : 0;
              messagesLoadedRef.current += msgCount;
              setBatchSuggestionChatOrder((prev) => (prev.includes(chatId) ? prev : [...prev, chatId]));
              setSuggestionsByChat((prev) => ({ ...prev, [chatId]: todos }));
            }
          } else {
            const data = await res.json();
            const todos = toTodoSuggestionList((data as { todos?: unknown }).todos);
            const msgCount = typeof (data as { message_count?: number }).message_count === "number" ? (data as { message_count: number }).message_count : 0;
            messagesLoadedRef.current += msgCount;
            setBatchSuggestionChatOrder((prev) => (prev.includes(chatId) ? prev : [...prev, chatId]));
            setSuggestionsByChat((prev) => ({ ...prev, [chatId]: todos }));
          }
        } catch (e) {
          if ((e as Error).name !== "AbortError") {
            failedRef.current += 1;
            if (failedRef.current >= TODO_ANALYZE_MAX_FAILURES_BEFORE_STOP) {
              stoppedEarlyAfterFailuresRef.current = true;
              controller.abort();
            }
          }
        } finally {
          if (!signal.aborted) {
            doneRef.current += 1;
            setLoadingAllProgress({ done: doneRef.current, total: ids.length, messagesLoaded: messagesLoadedRef.current });
            setLoadingMessagePagesByChatId((prev) => {
              const next = { ...prev };
              delete next[chatId];
              return next;
            });
          }
        }
      });
    } finally {
      analyzeBatchAbortRef.current = null;
      setLoadingAllSuggestions(false);
      setLoadingAllProgress(null);
      setLoadingMessagePagesByChatId({});
      const byChat = suggestionsByChatRef.current;
      let suggestionCount = 0;
      let chatCount = 0;
      for (const list of Object.values(byChat)) {
        if (list.length > 0) {
          chatCount += 1;
          suggestionCount += list.length;
        }
      }
      if (suggestionCount > 0) {
        setPostAnalyzeBanner({ suggestionCount, chatCount });
        setBatchZeroResultsHint(false);
      } else if (ids.length > 0) {
        setBatchZeroResultsHint(true);
      }
      void globalMutate((key) => typeof key === "string" && key.startsWith("todo-suggestions-meta"));
      if (failedRef.current > 0) {
        let msg = `${failedRef.current} von ${ids.length} Chats konnten nicht analysiert werden.`;
        if (stoppedEarlyAfterFailuresRef.current) {
          msg += ` Abgebrochen nach ${TODO_ANALYZE_MAX_FAILURES_BEFORE_STOP} Fehlern.`;
        }
        setLoadingAllError(msg);
      }
    }
  },
    [chatsAvailableForAnalysis, accountId, getAnalyzeSettings]
  );

  const runOnePromptForAllVisible = useCallback(async (settingsOverride?: TodoAnalyzeSettingsValues) => {
    const settings = settingsOverride ?? getAnalyzeSettings();
    const analyzeFields = buildAnalyzeRequestFields(settings);
    const onePrompt = analyzeFields.onePrompt;
    if (!onePrompt) {
      setLoadingAllError("Bitte zuerst den One-Prompt eintragen.");
      return;
    }
    if (!accountId || chatsAvailableForAnalysis.length === 0) {
      setLoadingAllError("Keine sichtbaren Chats für die Analyse.");
      return;
    }
    setOnePromptRunError(null);
    setOnePromptRunLoading(true);
    setOnePromptResults([]);
    setOnePromptProcessedCount(0);
    setOnePromptDialogOpen(true);
    try {
      const targets = chatsAvailableForAnalysis.map((chat) => ({
        chatId: chat.id,
        chatName: (chat.name ?? (chat as { participants?: Array<{ name?: string }> }).participants?.[0]?.name ?? "").trim(),
      }));
      setOnePromptTargetCount(targets.length);
      const res = await fetch("/api/todo-list/one-prompt-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          onePrompt,
          targets,
          messageScanMode: analyzeFields.messageScanMode,
          maxMessages: analyzeFields.maxMessages,
          maxMessageAgeDays: analyzeFields.maxMessageAgeDays,
          attachmentMode: analyzeFields.attachmentMode,
          force: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        results?: OnePromptDialogResult[];
        summary?: { processed?: number };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "One-Prompt Analyse fehlgeschlagen");
      }
      setOnePromptResults(Array.isArray(data.results) ? data.results : []);
      setOnePromptProcessedCount(typeof data.summary?.processed === "number" ? data.summary.processed : targets.length);
    } catch (error) {
      setOnePromptRunError(error instanceof Error ? error.message : "One-Prompt Analyse fehlgeschlagen");
    } finally {
      setOnePromptRunLoading(false);
    }
  }, [accountId, chatsAvailableForAnalysis, getAnalyzeSettings]);

  const acceptOnePromptResult = useCallback(
    async (result: OnePromptDialogResult) => {
      if (!result.todo) return;
      setOnePromptAcceptingByChatId((prev) => ({ ...prev, [result.chatId]: true }));
      try {
        const res = await fetch("/api/todo-list/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: result.todo.title,
            notes: result.todo.notes ?? result.output,
            ...suggestionToDueApiFields({ due: result.todo.due, due_time: null }),
            priority: result.todo.priority ?? 3,
            list_id: listIdFilter ?? undefined,
            source_chat_id: result.chatId,
            source_chat_name: result.chatName,
            source_account_id: accountId ?? undefined,
            skipDuplicates: true,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Todo konnte nicht erstellt werden");
        await Promise.all([mutateTodos(), mutateCount()]);
        setOnePromptResults((prev) => prev.filter((x) => x.chatId !== result.chatId));
      } catch (error) {
        setOnePromptRunError(error instanceof Error ? error.message : "Todo konnte nicht erstellt werden");
      } finally {
        setOnePromptAcceptingByChatId((prev) => ({ ...prev, [result.chatId]: false }));
      }
    },
    [accountId, listIdFilter, mutateCount, mutateTodos]
  );

  const acceptAllOnePromptResults = useCallback(async () => {
    const matchedOnly = onePromptResults.filter((r) => r.matched);
    if (matchedOnly.length === 0) return;
    try {
      const payload = matchedOnly
        .filter((r) => r.todo)
        .map((r) => ({
          title: r.todo!.title,
          notes: r.todo!.notes ?? r.output,
          ...suggestionToDueApiFields({ due: r.todo!.due, due_time: null }),
          priority: r.todo!.priority ?? 3,
          list_id: listIdFilter ?? undefined,
          source_chat_id: r.chatId,
          source_chat_name: r.chatName,
          source_account_id: accountId ?? undefined,
        }));
      if (payload.length === 0) return;
      const res = await fetch("/api/todo-list/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todos: payload, skipDuplicates: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Todos konnten nicht erstellt werden");
      await Promise.all([mutateTodos(), mutateCount()]);
      setOnePromptResults([]);
    } catch (error) {
      setOnePromptRunError(error instanceof Error ? error.message : "Todos konnten nicht erstellt werden");
    }
  }, [onePromptResults, listIdFilter, accountId, mutateTodos, mutateCount]);

  /** Analyze only the currently selected chat ids (multi-selection). */
  const runAnalyzeForSelection = useCallback(async (settingsOverride?: TodoAnalyzeSettingsValues) => {
    const settings = settingsOverride ?? getAnalyzeSettings();
    const analyzeFields = buildAnalyzeRequestFields(settings);
    const baseIds = selectedChatIds.length > 0 ? selectedChatIds : (selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL ? [selectedChatId] : []);
    const chatById = new Map(chats.map((c) => [c.id, c]));
    const ids = sortTodoChatIds(
      baseIds.filter((id) => !ignoredChatIds.includes(id)),
      chatById,
      pinnedChatIds
    );
    if (ids.length === 0 || !accountId) return;
    setSuggestionsByChat({});
    setBatchSuggestionChatOrder([]);
    if (analyzeBatchAbortRef.current) analyzeBatchAbortRef.current.abort();
    const controller = new AbortController();
    analyzeBatchAbortRef.current = controller;
    const signal = controller.signal;
    setLoadingAllSuggestions(true);
    setBatchZeroResultsHint(false);
    setLoadingAllError(null);
    setLoadingMessagePagesByChatId({});
    setLoadingAllProgress({ done: 0, total: ids.length, messagesLoaded: 0 });
    const doneRef = { current: 0 };
    const failedRef = { current: 0 };
    const stoppedEarlyAfterFailuresRef = { current: false };
    const messagesLoadedRef = { current: 0 };
    const chatNameById = new Map(
      chatsAvailableForAnalysis.map((c) => [c.id, (c.name ?? (c as { participants?: Array<{ name?: string }> })?.participants?.[0]?.name) ?? ""])
    );
    try {
      await runWithConcurrency(TODO_ANALYZE_CONCURRENCY, ids, async (chatId) => {
        if (signal.aborted || failedRef.current >= TODO_ANALYZE_MAX_FAILURES_BEFORE_STOP) return;
        const contactName = chatNameById.get(chatId) || undefined;
        try {
          const res = await fetch("/api/todo-list/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              accountId,
              contactName,
              promptSuffix: analyzeFields.promptSuffix,
              messageScanMode: analyzeFields.messageScanMode,
              maxMessages: analyzeFields.maxMessages,
              maxMessageAgeDays: analyzeFields.maxMessageAgeDays,
              attachmentMode: analyzeFields.attachmentMode,
              force: analyzeFields.force,
              stream: true,
            }),
            signal,
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error ?? "Analyse fehlgeschlagen");
          }
          const contentType = res.headers.get("content-type") ?? "";
          if (contentType.includes("application/x-ndjson") && res.body) {
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let result: { todos: unknown[]; message_count: number } | null = null;
            while (true) {
              if (signal.aborted) break;
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                  const event = JSON.parse(trimmed) as { type: string; page?: number; todos?: unknown[]; message_count?: number; error?: string };
                  if (event.type === "messages_page" && typeof event.page === "number") {
                    setLoadingMessagePagesByChatId((prev) => ({ ...prev, [chatId]: event.page! }));
                  } else if (event.type === "result") {
                    result = { todos: event.todos ?? [], message_count: event.message_count ?? 0 };
                  } else if (event.type === "error") {
                    throw new Error(event.error ?? "Analyse fehlgeschlagen");
                  }
                } catch (err) {
                  if (!(err instanceof SyntaxError)) throw err;
                }
              }
            }
            if (result) {
              const todos = toTodoSuggestionList(result.todos);
              const msgCount = typeof result.message_count === "number" ? result.message_count : 0;
              messagesLoadedRef.current += msgCount;
              setBatchSuggestionChatOrder((prev) => (prev.includes(chatId) ? prev : [...prev, chatId]));
              setSuggestionsByChat((prev) => ({ ...prev, [chatId]: todos }));
            }
          } else {
            const data = await res.json();
            const todos = toTodoSuggestionList((data as { todos?: unknown }).todos);
            const msgCount = typeof (data as { message_count?: number }).message_count === "number" ? (data as { message_count: number }).message_count : 0;
            messagesLoadedRef.current += msgCount;
            setBatchSuggestionChatOrder((prev) => (prev.includes(chatId) ? prev : [...prev, chatId]));
            setSuggestionsByChat((prev) => ({ ...prev, [chatId]: todos }));
          }
        } catch (e) {
          if ((e as Error).name !== "AbortError") {
            failedRef.current += 1;
            if (failedRef.current >= TODO_ANALYZE_MAX_FAILURES_BEFORE_STOP) {
              stoppedEarlyAfterFailuresRef.current = true;
              controller.abort();
            }
          }
        } finally {
          if (!signal.aborted) {
            doneRef.current += 1;
            setLoadingAllProgress({ done: doneRef.current, total: ids.length, messagesLoaded: messagesLoadedRef.current });
            setLoadingMessagePagesByChatId((prev) => {
              const next = { ...prev };
              delete next[chatId];
              return next;
            });
          }
        }
      });
    } finally {
      analyzeBatchAbortRef.current = null;
      setLoadingAllSuggestions(false);
      setLoadingAllProgress(null);
      setLoadingMessagePagesByChatId({});
      const byChat = suggestionsByChatRef.current;
      let suggestionCount = 0;
      for (const list of Object.values(byChat)) suggestionCount += list.length;
      if (suggestionCount === 0 && ids.length > 0) setBatchZeroResultsHint(true);
      if (failedRef.current > 0) {
        let msg = `${failedRef.current} von ${ids.length} Chats konnten nicht analysiert werden.`;
        if (stoppedEarlyAfterFailuresRef.current) {
          msg += ` Abgebrochen nach ${TODO_ANALYZE_MAX_FAILURES_BEFORE_STOP} Fehlern.`;
        }
        setLoadingAllError(msg);
      }
    }
  }, [selectedChatIds, selectedChatId, accountId, chatsAvailableForAnalysis, chats, ignoredChatIds, pinnedChatIds, getAnalyzeSettings]);

  const cancelAnalyzeBatch = useCallback(() => {
    if (analyzeBatchAbortRef.current) {
      analyzeBatchAbortRef.current.abort();
      analyzeBatchAbortRef.current = null;
    }
  }, []);

  const confirmAnalyzeSettingsModal = useCallback(() => {
    if (!analyzeSettingsDraft) return;
    const draft = analyzeSettingsDraft;
    const mode = analyzeSettingsModalMode;
    applyAnalyzeSettings(draft);
    closeAnalyzeSettingsModal();
    if (mode === "all") {
      void runAnalyzeForAllVisible(draft);
    } else if (mode === "selection") {
      void runAnalyzeForSelection(draft);
    } else if (mode === "single") {
      void runAnalyze(draft);
    } else {
      void runOnePromptForAllVisible(draft);
    }
  }, [
    analyzeSettingsDraft,
    analyzeSettingsModalMode,
    applyAnalyzeSettings,
    closeAnalyzeSettingsModal,
    runAnalyzeForAllVisible,
    runAnalyzeForSelection,
    runAnalyze,
    runOnePromptForAllVisible,
  ]);

  const analyzeSettingsModalPreview = useMemo(() => {
    const visibleChatCount = chatsAvailableForAnalysis.length;
    let selectedChatCount = selectedAnalyzeChatCount;
    if (analyzeSettingsModalMode === "all" || analyzeSettingsModalMode === "one-prompt") {
      selectedChatCount = batchTargetChats.length;
    } else if (analyzeSettingsModalMode === "single") {
      selectedChatCount = 1;
    }
    return { selectedChatCount, visibleChatCount };
  }, [analyzeSettingsModalMode, chatsAvailableForAnalysis.length, selectedAnalyzeChatCount, batchTargetChats.length]);

  const quickRunWithPreset = useCallback(
    (mode: AnalyzeSettingsModalMode, presetId: TodoAnalyzePresetId, targetChats?: BeeperChat[]) => {
      const draft =
        presetId === "custom"
          ? getAnalyzeSettings()
          : applyTodoAnalyzePreset(presetId, getAnalyzeSettings());
      applyAnalyzeSettings(draft);
      if (mode === "all" || mode === "one-prompt") {
        void runAnalyzeForAllVisible(draft, undefined, targetChats ?? batchTargetChats);
      } else if (mode === "selection") {
        void runAnalyzeForSelection(draft);
      } else {
        void runAnalyze(draft);
      }
    },
    [
      applyAnalyzeSettings,
      getAnalyzeSettings,
      batchTargetChats,
      runAnalyzeForAllVisible,
      runAnalyzeForSelection,
      runAnalyze,
    ]
  );

  const selectedChat = selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL ? chats.find((c) => c.id === selectedChatId) : null;
  const selectedChatName = selectedChat
    ? (selectedChat.name ?? selectedChat.participants?.[0]?.name ?? null)
    : null;

  const suggestions = selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL ? (suggestionsByChat[selectedChatId] ?? null) : null;

  const allSuggestionsFlat = useMemo(() => {
    if (selectedChatId !== ALL_CHATS_SENTINEL) return [];
    const out: { chatId: string; chatName: string; suggestion: TodoSuggestionItem; indexInChat: number }[] = [];
    for (const chat of chats) {
      const chatId = chat.id;
      const list = suggestionsByChat[chatId];
      if (!list?.length) continue;
      const chatName = (chat.name ?? (chat as { participants?: Array<{ name?: string }> })?.participants?.[0]?.name ?? chatId?.slice(0, 8) ?? "Chat") as string;
      list.forEach((suggestion, indexInChat) => out.push({ chatId, chatName, suggestion, indexInChat }));
    }
    return out;
  }, [selectedChatId, chats, suggestionsByChat]);

  const filteredAllSuggestionsFlat = useMemo(() => {
    const q = allSuggestionsQuery.trim().toLowerCase();
    if (!q) return allSuggestionsFlat;
    return allSuggestionsFlat.filter(({ chatName, suggestion }) => {
      const haystack = `${chatName}\n${suggestion.title}\n${suggestion.notes ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [allSuggestionsFlat, allSuggestionsQuery]);

  /** During batch load: flat list of suggestions in completion order (append-only), so viewport doesn't jump. */
  const batchSuggestionsFlat = useMemo(() => {
    if (!loadingAllSuggestions || !loadingAllProgress) return [];
    const out: { chatId: string; chatName: string; suggestion: TodoSuggestionItem; indexInChat: number }[] = [];
    for (const chatId of batchSuggestionChatOrder) {
      const list = suggestionsByChat[chatId];
      if (!list?.length) continue;
      const chat = filteredChatsForList.find((c) => c.id === chatId);
      const chatName = (chat?.name ?? (chat as { participants?: Array<{ name?: string }> })?.participants?.[0]?.name ?? chatId?.slice(0, 8) ?? "Chat") as string;
      list.forEach((s, indexInChat) => {
        out.push({ chatId, chatName, suggestion: s, indexInChat });
      });
    }
    return out;
  }, [loadingAllSuggestions, loadingAllProgress, suggestionsByChat, filteredChatsForList, batchSuggestionChatOrder]);

  const rejectSuggestion = useCallback((chatId: string, index: number) => {
    const list = suggestionsByChatRef.current[chatId];
    if (!list || index < 0 || index >= list.length) return;
    const item = list[index];
    pushTodoSuggestionRejectUndo({ chatId, index, item: { ...item } });
    setSuggestionsByChat((prev) => {
      const cur = prev[chatId];
      if (!cur || index < 0 || index >= cur.length) return prev;
      const next = [...cur];
      next.splice(index, 1);
      schedulePersistRef.current(chatId, next);
      return { ...prev, [chatId]: next };
    });
    if (editingSuggestion?.chatId === chatId) setEditingSuggestion(null);
  }, [editingSuggestion]);

  const updateSuggestion = useCallback((chatId: string, index: number, patch: Partial<TodoSuggestionItem>) => {
    setSuggestionsByChat((prev) => {
      const list = prev[chatId];
      if (!list || index < 0 || index >= list.length) return prev;
      const next = [...list];
      next[index] = { ...next[index], ...patch };
      schedulePersistRef.current(chatId, next);
      return { ...prev, [chatId]: next };
    });
  }, []);

  const acceptSuggestion = useCallback(
    async (
      item: TodoSuggestionItem,
      skipDuplicates: boolean,
      sourceChatIdOverride?: string | null,
      sourceChatNameOverride?: string | null,
      removeFromChatId?: string | null,
      removeIndex?: number
    ) => {
      const sid = sourceChatIdOverride ?? selectedChatId;
      const sname = sourceChatNameOverride ?? selectedChatName;
      const res = await fetch("/api/todo-list/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: item.title,
          ...suggestionToDueApiFields(item),
          ...suggestionToCreateTodoSyntax(item),
          priority: typeof item.priority === "number" ? item.priority : undefined,
          notes: item.notes ?? undefined,
          estimated_time_minutes: item.estimated_time_minutes ?? undefined,
          list_id: listIdFilter ?? undefined,
          source_chat_id: sid ?? undefined,
          source_chat_name: sname ?? undefined,
          source_account_id: accountId ?? undefined,
          skipDuplicates,
        }),
      });
      const data = await res.json();
      if (res.status === 409) return { duplicate: true };
      if (res.ok && data.id) {
        mutateTodos();
        mutateCount();
        if (removeFromChatId != null && removeIndex != null && removeIndex >= 0) {
          pushTodoSuggestionAcceptUndo({
            chatId: removeFromChatId,
            index: removeIndex,
            item: { ...item },
            todoId: String(data.id),
          });
          setSuggestionsByChat((prev) => {
            const list = prev[removeFromChatId];
            if (!list || removeIndex >= list.length) return prev;
            const next = [...list];
            next.splice(removeIndex, 1);
            schedulePersistRef.current(removeFromChatId, next);
            return { ...prev, [removeFromChatId]: next };
          });
        }
        return { duplicate: false };
      }
      return { duplicate: false };
    },
    [selectedChatId, selectedChatName, accountId, listIdFilter, mutateTodos, mutateCount]
  );

  const commandPaletteActions = useMemo((): TodoCommandAction[] => {
    const last = getLastTodoAnalyzePreset() ?? "daily_fast";
    return [
      {
        id: "batch-quick",
        label: "Batch mit letztem Preset starten",
        hint: last,
        run: () => quickRunWithPreset("all", last, batchTargetChats),
      },
      {
        id: "open-dialog",
        label: "Analyse-Einstellungen öffnen",
        run: () => openAnalyzeSettingsModal("all", { targetChatIds: batchTargetChatIds }),
      },
      {
        id: "triage",
        label: triageEnabled ? "Triage aus" : "Triage ein",
        run: () => setTriageEnabled((v) => !v),
      },
      {
        id: "work-inbox",
        label: "Modus: Inbox",
        run: () => setWorkMode("inbox"),
      },
      {
        id: "work-review",
        label: "Modus: Review",
        run: () => setWorkMode("review"),
      },
      {
        id: "work-bulk",
        label: "Modus: Bulk",
        run: () => setWorkMode("bulk"),
      },
      {
        id: "settings",
        label: "Todo-Einstellungen",
        run: () => {
          window.location.href = buildAppUrl({ view: "settings", tab: "todo" });
        },
      },
    ];
  }, [
    batchTargetChats,
    batchTargetChatIds,
    triageEnabled,
    quickRunWithPreset,
    openAnalyzeSettingsModal,
    setWorkMode,
  ]);

  const acceptAll = useCallback(async () => {
    if (!suggestions || suggestions.length === 0) return;
    if (selectedChatId) {
      setAnalyzeErrorByChatId((prev) => {
        const next = { ...prev };
        delete next[selectedChatId];
        return next;
      });
    }
    try {
      const previousSuggestions = suggestions.map((s) => ({ ...s }));
      const res = await fetch("/api/todo-list/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          todos: suggestions.map((s) => ({
            title: s.title,
            ...suggestionToDueApiFields(s),
            ...suggestionToCreateTodoSyntax(s),
            priority: typeof s.priority === "number" ? s.priority : 3,
            notes: s.notes ?? undefined,
            category: s.category ?? undefined,
            estimated_time_minutes: s.estimated_time_minutes ?? undefined,
            list_id: listIdFilter ?? undefined,
            source_chat_id: selectedChatId ?? undefined,
            source_chat_name: selectedChatName ?? undefined,
            source_account_id: accountId ?? undefined,
          })),
          skipDuplicates: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Übernehmen fehlgeschlagen");
      setAcceptAllResult({ inserted: data.inserted ?? 0, skipped: data.skipped ?? 0 });
      mutateTodos();
      mutateCount();
      if (selectedChatId) {
        const todosPayload = Array.isArray(data.todos)
          ? (data.todos as { id?: string }[])
              .map((t) => t.id)
              .filter((id): id is string => typeof id === "string" && id.length > 0)
          : [];
        pushTodoAcceptBatchUndo({
          chatId: selectedChatId,
          previousSuggestions,
          todoIds: todosPayload,
        });
        setSuggestionsByChat((prev) => {
          schedulePersistRef.current(selectedChatId, []);
          return { ...prev, [selectedChatId]: [] };
        });
        setEditingSuggestion(null);
      }
    } catch (e) {
      if (selectedChatId) {
        setAnalyzeErrorByChatId((prev) => ({
          ...prev,
          [selectedChatId]: e instanceof Error ? e.message : "Übernehmen fehlgeschlagen",
        }));
      }
    }
  }, [suggestions, selectedChatId, selectedChatName, accountId, listIdFilter, mutateTodos, mutateCount]);

  const toggleComplete = useCallback(
    async (todo: TodoItem) => {
      const prevCompleted = todo.completed;
      const nextCompleted = prevCompleted ? 0 : 1;
      const res = await fetch(`/api/todo-list/todos/${todo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: nextCompleted }),
      });
      if (res.ok) {
        if (prevCompleted === 0 && nextCompleted === 1) {
          pushTodoCompletionUndo({ id: todo.id, previousCompleted: 0 });
        }
        mutateTodos();
      }
    },
    [mutateTodos]
  );

  const updateTodo = useCallback(
    async (id: string, patch: Partial<TodoItem>) => {
      await fetch(`/api/todo-list/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      mutateTodos();
      setEditingTodoId(null);
      setEditingNotesId(null);
    },
    [mutateTodos]
  );

  const reorderTodos = useCallback(
    async (orderedIds: string[]) => {
      const res = await fetch("/api/todo-list/todos/reorder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });
      if (!res.ok) throw new Error("Reihenfolge konnte nicht gespeichert werden");
      mutateTodos();
    },
    [mutateTodos]
  );

  const handleTodoDragStart = useCallback((e: React.DragEvent, todoId: string) => {
    setDraggedTodoId(todoId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", todoId);
    e.dataTransfer.setData("application/json", JSON.stringify({ todoId }));
  }, []);

  const handleTodoDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropIndex(index);
  }, []);

  const handleTodoDragLeave = useCallback((e: React.DragEvent) => {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropIndex(null);
    }
  }, []);

  const handleTodoDrop = useCallback(
    async (e: React.DragEvent, dropIndex: number) => {
      e.preventDefault();
      setDropIndex(null);
      const id = draggedTodoId ?? e.dataTransfer.getData("text/plain");
      setDraggedTodoId(null);
      if (!id || !todos.length) return;
      const ids = todos.map((t) => t.id);
      const fromIdx = ids.indexOf(id);
      if (fromIdx === -1) return;
      const [movedId] = ids.splice(fromIdx, 1);
      let toIdx = dropIndex;
      if (fromIdx < toIdx) toIdx -= 1;
      ids.splice(toIdx, 0, movedId);
      await reorderTodos(ids);
    },
    [draggedTodoId, todos, reorderTodos]
  );

  const handleTodoDragEnd = useCallback(() => {
    setDraggedTodoId(null);
    setDropIndex(null);
  }, []);

  const refreshTodoCache = useCallback(async () => {
    setRefreshingTodos(true);
    try {
      await Promise.all([mutateTodos(), mutateCount(), mutateLists()]);
    } finally {
      setRefreshingTodos(false);
    }
  }, [mutateTodos, mutateCount, mutateLists]);

  /** Send current todo list to ChatGPT for urgency-based sort (title/notes first, deadline second), then apply new order. */
  const runSmartSort = useCallback(async () => {
    if (todos.length === 0) return;
    setSmartSortError(null);
    setSmartSortLoading(true);
    try {
      const res = await fetch("/api/todo-list/todos/smart-sort", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          todos: todos.map((t) => ({ id: t.id, title: t.title, notes: t.notes, due_date: t.due_date })),
        }),
      });
      const data = (await res.json()) as { orderedIds?: string[]; error?: string };
      if (!res.ok) {
        setSmartSortError(data?.error ?? "Smart Sort fehlgeschlagen");
        return;
      }
      const orderedIds = Array.isArray(data.orderedIds) ? data.orderedIds : [];
      if (orderedIds.length > 0) {
        const reorderRes = await fetch("/api/todo-list/todos/reorder", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderedIds }),
        });
        if (!reorderRes.ok) {
          setSmartSortError("Reihenfolge konnte nicht gespeichert werden.");
          return;
        }
        setSort("sort_order");
        setOrder("asc");
        await mutateTodos();
      }
    } catch (e) {
      setSmartSortError(e instanceof Error ? e.message : "Smart Sort fehlgeschlagen");
    } finally {
      setSmartSortLoading(false);
    }
  }, [todos, mutateTodos]);

  const deleteTodo = useCallback(
    async (id: string) => {
      await fetch(`/api/todo-list/todos/${id}`, { method: "DELETE" });
      mutateTodos();
      mutateCount();
    },
    [mutateTodos, mutateCount]
  );

  const connectGoogleTasks = useCallback(() => {
    window.location.href = "/api/google-tasks/connect";
  }, []);

  const connectReclaim = useCallback(() => {
    window.location.href = buildAppUrl({ view: "settings", tab: "todo" });
  }, []);

  const syncTodoToGoogle = useCallback(
    async (todoId: string) => {
      setGoogleSyncLoadingByTodoId((prev) => ({ ...prev, [todoId]: true }));
      setGoogleSyncResultByTodoId((prev) => {
        const next = { ...prev };
        delete next[todoId];
        return next;
      });
      try {
        const res = await fetch(`/api/todo-list/todos/${encodeURIComponent(todoId)}/google-sync`, { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          alreadySynced?: boolean;
        };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Google Tasks Sync fehlgeschlagen");
        await mutateTodos();
        setGoogleSyncResultByTodoId((prev) => ({
          ...prev,
          [todoId]: { kind: "ok", message: data.alreadySynced ? "Bereits synchronisiert" : "Synchronisiert" },
        }));
      } catch (e) {
        const message = e instanceof Error ? e.message : "Google Tasks Sync fehlgeschlagen";
        setGoogleSyncResultByTodoId((prev) => ({ ...prev, [todoId]: { kind: "error", message } }));
        await mutateGoogleTasksStatus();
      } finally {
        setGoogleSyncLoadingByTodoId((prev) => ({ ...prev, [todoId]: false }));
      }
    },
    [mutateGoogleTasksStatus, mutateTodos]
  );

  const syncTodoToReclaim = useCallback(
    async (todoId: string) => {
      setReclaimSyncLoadingByTodoId((prev) => ({ ...prev, [todoId]: true }));
      setReclaimSyncResultByTodoId((prev) => {
        const next = { ...prev };
        delete next[todoId];
        return next;
      });
      try {
        const res = await fetch(`/api/todo-list/todos/${encodeURIComponent(todoId)}/reclaim-sync`, { method: "POST" });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          alreadySynced?: boolean;
        };
        if (!res.ok || !data.ok) throw new Error(data.error ?? "Reclaim Sync fehlgeschlagen");
        await mutateTodos();
        setReclaimSyncResultByTodoId((prev) => ({
          ...prev,
          [todoId]: { kind: "ok", message: data.alreadySynced ? "Bereits synchronisiert" : "Synchronisiert" },
        }));
      } catch (e) {
        const message = e instanceof Error ? e.message : "Reclaim Sync fehlgeschlagen";
        setReclaimSyncResultByTodoId((prev) => ({ ...prev, [todoId]: { kind: "error", message } }));
        await mutateReclaimStatus();
      } finally {
        setReclaimSyncLoadingByTodoId((prev) => ({ ...prev, [todoId]: false }));
      }
    },
    [mutateReclaimStatus, mutateTodos]
  );

  const archiveTodo = useCallback(
    async (id: string) => {
      await fetch(`/api/todo-list/todos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: 1 }),
      });
      mutateTodos();
      mutateCount();
    },
    [mutateTodos, mutateCount]
  );

  const isOverdue = (due: string | null) => due && due < today();
  const isDueToday = (due: string | null) => due === today();

  const layoutCol1Width =
    workMode === "review" ? Math.min(col1Width, 220) : workMode === "bulk" ? Math.max(col1Width, 300) : col1Width;
  const layoutCol2Width =
    workMode === "review" ? Math.max(col2Width, 520) : workMode === "bulk" ? Math.min(col2Width, 260) : col2Width;

  const handleBatchAnalyzeClick = (
    e: React.MouseEvent,
    mode: AnalyzeSettingsModalMode
  ) => {
    if (batchTargetChats.length === 0) return;
    if (e.shiftKey) {
      openAnalyzeSettingsModal(mode, { targetChatIds: batchTargetChatIds });
      return;
    }
    const preset = getLastTodoAnalyzePreset() ?? "daily_fast";
    quickRunWithPreset(mode, preset, batchTargetChats);
  };

  const handleSingleAnalyzeClick = (e: React.MouseEvent) => {
    if (!selectedChat) return;
    if (e.shiftKey) {
      openAnalyzeSettingsModal("single", { chat: selectedChat });
      return;
    }
    const preset = suggestPresetForChat(selectedChat);
    quickRunWithPreset("single", preset);
  };

  return (
    <>
      <TodoAnalyzeSettingsDialog
        open={showAnalyzeSettingsModal && !!analyzeSettingsDraft}
        mode={analyzeSettingsModalMode}
        draft={analyzeSettingsDraft ?? getAnalyzeSettings()}
        onDraftChange={(patch) => setAnalyzeSettingsDraft((prev) => (prev ? { ...prev, ...patch } : prev))}
        onClose={closeAnalyzeSettingsModal}
        onConfirm={confirmAnalyzeSettingsModal}
        selectedChatName={selectedChatName}
        previewScope={analyzeSettingsModalPreview}
        chatIdsForPreview={resolveModalChatIds()}
        initialPresetId={modalInitialPreset}
        emphasizeOnePrompt={analyzeSettingsModalMode === "one-prompt"}
      />
      <TodoCommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        actions={commandPaletteActions}
      />
      <div ref={containerRef} className="todo-glass-root flex h-full min-h-0 flex-col">
      <TodoGlassShell>
      {/* Column 1: Chats */}
      <TodoGlassPanel
        style={{ width: layoutCol1Width, minWidth: MIN_COL1 }}
        header={
          <>
          <TodoGlassSection className="mb-0" muted>
          <TodoGlassSegmentedControl
            value={workMode}
            onChange={setWorkMode}
            options={(["inbox", "review", "bulk"] as TodoWorkMode[]).map((m) => ({
              value: m,
              label: WORK_MODE_LABELS[m],
              title: `Arbeitsmodus: ${WORK_MODE_LABELS[m]}`,
            }))}
          />
          </TodoGlassSection>
          <TodoGlassSection className="mb-0 mt-2" muted>
          <TodoGlassSegmentedControl
            value={leftTab}
            onChange={setLeftTab}
            options={[
              { value: "dashboard" as const, label: "Dashboard", title: "Usage-Statistik und Einstellungen" },
              { value: "chats" as const, label: "Chats", title: "Chat-Liste und Vorschläge" },
            ]}
          />
          </TodoGlassSection>
          <div className="mt-3">
          {accountsLoading ? (
            <p className="text-sm text-wa-text-secondary">Lade Accounts…</p>
          ) : accountsError ? (
            <div className="tg-alert tg-alert-warning">
              <p className="font-medium">Accounts nicht geladen</p>
              <p className="mt-0.5 text-xs">{accountsError.message}</p>
              <TodoGlassButton
                variant="ghost"
                className="mt-2 text-xs text-red-600 underline"
                onClick={() => mutateAccounts()}
                title="Accounts erneut laden"
              >
                Erneut versuchen
              </TodoGlassButton>
            </div>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-amber-600">
              Keine Accounts. Beeper Desktop starten und verbinden.
            </p>
          ) : (
            <TodoGlassSelect
              label="Account"
              value={accountId ?? ""}
              onChange={(e) => {
                const id = e.target.value || null;
                setSelectedAccountId(id);
                setTodoListAccountId(id);
                setSelectedChatId(null);
              }}
              title="Beeper-Account auswählen"
            >
              {accounts.map((acc) => {
                const id = getAccountId(acc);
                const label = (acc.user as { name?: string })?.name ?? id?.slice(0, 8) ?? "Account";
                return (
                  <option key={id} value={id}>
                    {label}
                  </option>
                );
              })}
            </TodoGlassSelect>
          )}
          </div>
          </>
        }
      >
        <TodoGlassPanelScroll>
          {leftTab === "dashboard" ? (
            <div className="tg-surface p-3">
              <p className="text-sm font-semibold text-wa-text-primary">Dashboard</p>
              <p className="mt-1 text-xs text-wa-text-secondary">
                Links oben kannst du jederzeit zurück zu „Chats“ wechseln.
              </p>
            </div>
          ) : null}
          {chatsLoading && accountId ? (
            <p className="text-sm text-wa-text-secondary">Lade Chats…</p>
          ) : chatsError ? (
            <div className="rounded-lg border border-red-400/50 bg-red-500/10 p-2 text-sm text-red-600">
              <p className="font-medium">Chats nicht geladen</p>
              <p className="mt-0.5 text-xs">{chatsError.message}</p>
              <button
                type="button"
                onClick={() => mutateChats()}
                title="Chats erneut laden"
                className="mt-2 text-xs font-medium text-red-600 underline hover:no-underline"
              >
                Erneut versuchen
              </button>
            </div>
          ) : !accountId ? (
            <p className="text-sm text-wa-text-secondary">Account wählen.</p>
          ) : chats.length === 0 ? (
            <p className="text-sm text-wa-text-secondary">
              Keine Chats in diesem Account (oder nur archivierte/Gruppen).
            </p>
          ) : null}
          {leftTab === "chats" && !chatsLoading && !chatsError && chats.length > 0 && (
            <>
              <TodoGlassSection label="Suche & Filter" muted>
              <TodoGlassInput
                type="search"
                placeholder={isWhatsAppAccount ? "Chat suchen (Name, Nummer, ID)" : "Chat suchen (Name, ID)"}
                value={chatSearchQuery}
                onChange={(e) => setChatSearchQuery(e.target.value)}
                title={
                  isWhatsAppAccount
                    ? "Name, Chat-ID oder Telefonnummer (Leerzeichen in Nummern werden ignoriert)"
                    : "Chat-Liste nach Name oder ID filtern"
                }
              />
              <div className="mt-2">
              <TodoInboxFilters value={inboxFilter} onChange={setInboxFilter} />
              </div>
              <TodoAnalyzeCacheControl
                className="mt-2"
                id="todo-analyze-cache-chats"
                analyzeForce={analyzeForce}
                onChange={setAnalyzeCacheForce}
              />
              <TodoGlassSelect
                label="Batch-Scope"
                value={batchScope}
                onChange={(e) => setBatchScope(e.target.value as TodoBatchScope)}
                title="Welche Chats für Batch-Analyse gelten"
                className="mt-2"
              >
                {(Object.keys(TODO_BATCH_SCOPE_LABELS) as TodoBatchScope[]).map((scope) => (
                  <option key={scope} value={scope}>
                    {TODO_BATCH_SCOPE_LABELS[scope]}
                  </option>
                ))}
              </TodoGlassSelect>
              <TodoGlassSelect
                label="Chat-Ansicht"
                value={chatListView}
                onChange={(e) => {
                  const v = e.target.value as ChatListViewType;
                  setChatListView(v);
                  const saved = getChatViewFilter();
                  setChatViewFilter({ ...saved, chatListView: v });
                }}
                title="Welche Chats in der Liste anzeigen"
                className="mt-2"
              >
                <option value="all">Alle (inkl. archiviert)</option>
                <option value="private">Private Chats</option>
                <option value="groups">Nur Gruppen</option>
                <option value="archived">Nur archivierte</option>
              </TodoGlassSelect>
              </TodoGlassSection>
              {selectedChatIds.length > 1 && (
                <TodoGlassSection label="Auswahl" className="tg-alert tg-alert-info !p-2.5">
                  <p className="text-xs font-medium text-wa-text-primary">
                    {selectedChatIds.length} Chats ausgewählt <span className="font-normal text-wa-text-secondary">(Esc zum Aufheben)</span>
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    <TodoGlassButton
                      variant="primary"
                      className="flex-1 text-xs"
                      onClick={(e) => {
                        if (e.shiftKey) {
                          const ids = selectedChatIds.filter((id) => !ignoredChatIds.includes(id));
                          openAnalyzeSettingsModal("selection", { targetChatIds: ids });
                        } else {
                          const preset = getLastTodoAnalyzePreset() ?? "daily_fast";
                          quickRunWithPreset("selection", preset);
                        }
                      }}
                      disabled={loadingAllSuggestions}
                      title="Ausgewählte Chats analysieren (Shift+Klick: Einstellungen)"
                    >
                      {loadingAllSuggestions && loadingAllProgress
                        ? `Analysiere ${loadingAllProgress.done}/${loadingAllProgress.total} Chats…`
                        : "Auswahl analysieren"}
                    </TodoGlassButton>
                    {loadingAllSuggestions && (
                      <TodoGlassButton
                        variant="destructive"
                        className="shrink-0 text-xs"
                        onClick={cancelAnalyzeBatch}
                        title="Analyse abbrechen"
                      >
                        Abbrechen
                      </TodoGlassButton>
                    )}
                  </div>
                </TodoGlassSection>
              )}
              <TodoGlassSection label="Aktionen">
                <TodoGlassButton
                  variant="secondary"
                  fullWidth
                  onClick={(e) => handleBatchAnalyzeClick(e, "all")}
                  disabled={loadingAllSuggestions || batchTargetChats.length === 0}
                  title={`Todo-Vorschläge für ${formatChatCountLabel(batchTargetChats.length)} laden (${TODO_BATCH_SCOPE_LABELS[batchScope]}). Shift+Klick: Einstellungen.`}
                  className="text-xs"
                >
                  {loadingAllSuggestions && loadingAllProgress
                    ? `Analysiere ${loadingAllProgress.done}/${loadingAllProgress.total} Chats…`
                    : `Vorschläge für ${formatChatCountLabel(batchTargetChats.length)} laden`}
                </TodoGlassButton>
                <TodoGlassButton
                  variant="secondary"
                  fullWidth
                  className="mt-1.5 text-xs text-blue-700 dark:text-blue-300"
                  onClick={() => {
                    if (batchTargetChats.length === 0) return;
                    openAnalyzeSettingsModal("one-prompt", { targetChatIds: batchTargetChatIds });
                  }}
                  disabled={loadingAllSuggestions || batchTargetChats.length === 0}
                  title={`One-Prompt für ${formatChatCountLabel(batchTargetChats.length)} (${TODO_BATCH_SCOPE_LABELS[batchScope]})`}
                >
                  One-Prompt für {formatChatCountLabel(batchTargetChats.length)}
                </TodoGlassButton>
                {loadingAllSuggestions && loadingAllProgress && (
                  <>
                    <p className="mt-2 text-xs text-wa-text-secondary">
                      {loadingAllProgress.done} von {loadingAllProgress.total} Chats analysiert
                      {" · "}
                      {loadingAllProgress.messagesLoaded} Nachrichten in fertigen Chats
                      {loadingAllStep
                        ? ` · ${loadingAllStep === TODO_ANALYSIS_STEPS[0]
                            ? `Lade Nachrichten #${Object.keys(loadingMessagePagesByChatId).length ? Math.max(...Object.values(loadingMessagePagesByChatId)) : 0}`
                            : loadingAllStep}`
                        : ""}
                    </p>
                    <TodoGlassButton
                      variant="destructive"
                      fullWidth
                      className="mt-1.5 text-xs"
                      onClick={cancelAnalyzeBatch}
                      title="Analyse abbrechen"
                    >
                      Abbrechen
                    </TodoGlassButton>
                  </>
                )}
              </TodoGlassSection>
              {loadingAllError && (
                <p className="tg-alert tg-alert-warning mb-2 text-xs">{loadingAllError}</p>
              )}
              {chatSearchQuery.trim() && filteredChatsForList.length === 0 && (
                <p className="text-sm text-wa-text-secondary">Keine Chats passen zur Suche.</p>
              )}
            </>
          )}
          {!chatsLoading && !chatsError && chats.length > 0 && filteredChatsForList.length > 0 && (
            <TodoGlassSection label="Chats">
              <TodoGlassListRow
                selected={selectedChatId === ALL_CHATS_SENTINEL}
                onClick={() => {
                  setSelectedChatIds([]);
                  setSelectedChatId(ALL_CHATS_SENTINEL);
                }}
                title="Alle bereits geladenen Vorschläge anzeigen"
              >
                <span className="truncate font-medium">ALLE Vorschläge</span>
                <span className="tg-badge ml-1">
                  {Object.values(suggestionsByChat).reduce((acc, list) => acc + list.length, 0)}
                </span>
              </TodoGlassListRow>
              {sortedChatsForList.map((chat, index) => {
            const id = chat.id;
            const name = (chat.name ?? chat.participants?.[0]?.name ?? id?.slice(0, 8) ?? "Chat") as string;
            const count = countByChat[id] ?? 0;
            const selected = selectedChatId === id;
            const inSelection = selectedChatIds.length > 0 && selectedChatIds.includes(id);
            const suggestionCount = suggestionsByChat[id]?.length ?? 0;
            const ignoredForAnalysis = ignoredChatIds.includes(id);
            const pinnedForAnalysis = isTodoChatPinned(chat, pinnedChatIds);
            const locallyPinned = pinnedChatIds.includes(id);
            const inboxStatus = id ? chatInboxStatusById[id] : undefined;
            return (
              <TodoGlassListRow
                key={id}
                selected={selected}
                inSelection={inSelection}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSuggestionContextMenu(null);
                  setChatContextMenu({ chatId: id, x: e.clientX, y: e.clientY });
                }}
                onClick={(e) => {
                  if (e.shiftKey) {
                    const anchor = lastClickedIndexRef.current ?? index;
                    const low = Math.min(anchor, index);
                    const high = Math.max(anchor, index);
                    const ids = sortedChatsForList.slice(low, high + 1).map((c) => c.id).filter(Boolean);
                    setSelectedChatIds(ids);
                    setSelectedChatId(id);
                    lastClickedIndexRef.current = index;
                  } else if (e.metaKey || e.ctrlKey) {
                    if (selectedChatIds.includes(id)) {
                      const next = selectedChatIds.filter((x) => x !== id);
                      setSelectedChatIds(next);
                      setSelectedChatId(selectedChatId === id ? (next[0] ?? null) : selectedChatId);
                    } else {
                      setSelectedChatIds([...selectedChatIds, id]);
                      setSelectedChatId(id);
                    }
                    lastClickedIndexRef.current = index;
                  } else {
                    setSelectedChatIds([id]);
                    setSelectedChatId(id);
                    lastClickedIndexRef.current = index;
                  }
                  setAnalyzeErrorByChatId((prev) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                  });
                  setAcceptAllResult(null);
                }}
                title={`${name}${suggestionCount > 0 ? ` · ${suggestionCount} Vorschlag/Vorschläge` : ""} · Klick: auswählen, Strg/Kmd: Mehrfachauswahl, Rechtsklick: Kontextmenü`}
              >
                <span className="truncate">
                  {pinnedForAnalysis ? (
                    <span className="mr-1" title={locallyPinned ? "Angepinnt" : "In Beeper angepinnt"}>
                      📌
                    </span>
                  ) : null}
                  {name}
                  {ignoredForAnalysis ? (
                    <span className="tg-badge ml-1 text-[10px] text-amber-700 dark:text-amber-400" title="Für Todo-Analyse ignoriert">
                      ignoriert
                    </span>
                  ) : null}
                </span>
                <span className="ml-1 flex shrink-0 items-center gap-1">
                  {inboxStatus && (
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${INBOX_STATUS_DOT_CLASS[inboxStatus]}`}
                      title={INBOX_STATUS_LABELS[inboxStatus]}
                    />
                  )}
                  {suggestionCount > 0 && (
                    <span className="tg-badge" title="Vorschläge geladen">
                      {suggestionCount}
                    </span>
                  )}
                  {count > 0 && (
                    <span className="tg-badge font-medium text-wa-green">
                      {count}
                    </span>
                  )}
                </span>
              </TodoGlassListRow>
            );
          })}
              <p className="mt-2 text-xs text-wa-text-secondary" title="Tastatur und Maus">
                Shift+Klick = Bereich wählen, Strg/Cmd+Klick = einzeln an-/abwählen, Esc = Auswahl aufheben.
              </p>
            </TodoGlassSection>
          )}
        </TodoGlassPanelScroll>
      </TodoGlassPanel>

      <TodoGlassResizeHandle
        aria-label="Spaltenbreite Chats anpassen"
        onMouseDown={handleResizeMouseDown(1)}
      />

      {/* Column 2: Vorschläge (largest) */}
      <TodoGlassPanel
        style={{ width: layoutCol2Width, minWidth: MIN_COL2 }}
        header={
        <div className="shrink-0">
          {leftTab !== "dashboard" && (
            <div className="mb-2 flex items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-wa-text-secondary">
                <input
                  type="checkbox"
                  checked={triageEnabled}
                  onChange={(e) => setTriageEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-wa-border text-wa-green"
                />
                Triage-Modus
              </label>
              <TodoGlassButton
                variant="ghost"
                className="text-xs"
                onClick={() => setCommandPaletteOpen(true)}
                title="Command Palette (⌘K)"
              >
                ⌘K
              </TodoGlassButton>
            </div>
          )}
          {batchZeroResultsHint && !loadingAllSuggestions && leftTab !== "dashboard" && (
            <div className="tg-alert tg-alert-warning mb-2">
              <p>Batch abgeschlossen ohne neue Vorschläge.</p>
              <p className="mt-1">Preset oder Inbox-Filter anpassen, oder mit Shift+Klick „Alles neu“ analysieren.</p>
              <button
                type="button"
                className="mt-2 text-wa-green hover:underline"
                onClick={() => {
                  setBatchZeroResultsHint(false);
                  openAnalyzeSettingsModal("all", { presetId: "force_refresh", targetChatIds: batchTargetChatIds });
                }}
              >
                Einstellungen öffnen
              </button>
            </div>
          )}
          {postAnalyzeBanner && leftTab !== "dashboard" && (
            <div className="tg-alert tg-alert-info mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-wa-text-primary">
                {postAnalyzeBanner.suggestionCount} neue Vorschläge in {postAnalyzeBanner.chatCount} Chats
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="font-medium text-wa-green hover:underline"
                  onClick={() => {
                    setTriageEnabled(true);
                    setPostAnalyzeBanner(null);
                  }}
                >
                  Jetzt durchgehen
                </button>
                <button
                  type="button"
                  className="text-wa-text-secondary hover:underline"
                  onClick={() => setPostAnalyzeBanner(null)}
                >
                  Später
                </button>
              </span>
            </div>
          )}
          {leftTab === "dashboard" ? (
            <>
              <h2 className="text-sm font-semibold text-wa-text-primary">Dashboard</h2>
              <div className="mt-2 tg-surface p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-wa-text-primary">OpenAI-Usage</p>
                  <label className="inline-flex items-center gap-2 text-[11px] text-wa-text-secondary">
                    Zeitraum
                    <select
                      value={usageDays}
                      onChange={(e) => {
                        const days = Math.max(1, Math.min(365, parseInt(e.target.value || "30", 10) || 30));
                        setUsageDays(days);
                        patchAnalyzePrefs({ usageDays: days });
                      }}
                      title="Zeitraum für OpenAI-Usage-Statistik"
                      className="rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-xs text-wa-text-primary"
                    >
                      <option value={7}>7 Tage</option>
                      <option value={30}>30 Tage</option>
                      <option value={90}>90 Tage</option>
                    </select>
                  </label>
                </div>
                {usageSummary ? (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-wa-text-secondary">
                      <span>
                        Requests:{" "}
                        <span className="font-semibold text-wa-text-primary">{usageSummary.totals.request_count}</span>
                      </span>
                      <span>
                        Tokens gesamt:{" "}
                        <span className="font-semibold text-wa-text-primary">{usageSummary.totals.total_tokens}</span>
                      </span>
                      <span>
                        Prompt:{" "}
                        <span className="font-semibold text-wa-text-primary">{usageSummary.totals.prompt_tokens}</span>
                      </span>
                      <span>
                        Completion:{" "}
                        <span className="font-semibold text-wa-text-primary">
                          {usageSummary.totals.completion_tokens}
                        </span>
                      </span>
                    </div>
                    <div className="max-h-64 overflow-y-auto tg-surface">
                      <table className="w-full text-left text-[11px]">
                        <thead className="sticky top-0 bg-wa-panel">
                          <tr className="text-wa-text-secondary">
                            <th className="px-2 py-1">Kategorie</th>
                            <th className="px-2 py-1">Model</th>
                            <th className="px-2 py-1">Req</th>
                            <th className="px-2 py-1">Tokens</th>
                          </tr>
                        </thead>
                        <tbody>
                          {usageSummary.byCategoryAndModel.map((r) => (
                            <tr key={`${r.category}:${r.model}`} className="border-t border-wa-border/70">
                              <td className="px-2 py-1 text-wa-text-primary">{r.category}</td>
                              <td className="px-2 py-1 text-wa-text-secondary">{r.model}</td>
                              <td className="px-2 py-1 text-wa-text-secondary">{r.request_count}</td>
                              <td className="px-2 py-1 text-wa-text-secondary">{r.total_tokens}</td>
                            </tr>
                          ))}
                          {usageSummary.byCategoryAndModel.length === 0 && (
                            <tr>
                              <td className="px-2 py-2 text-wa-text-secondary" colSpan={4}>
                                Noch keine Usage-Daten im Zeitraum.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-[10px] text-wa-text-secondary">
                      Hinweis: Whisper liefert keine Token-Usage; hier zählen wir Requests (Tokens = 0).
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-wa-text-secondary">Lade Usage…</p>
                )}
              </div>
            </>
          ) : (
            <div>
              <h2 className="text-sm font-semibold text-wa-text-primary">Vorschläge</h2>
              {accountId && !(triageEnabled && triageQueue.length > 0) && (
                <p className="mt-0.5 text-[11px] text-wa-text-secondary">C zum Chat springen</p>
              )}
            </div>
          )}
          {loadingAllSuggestions && loadingAllProgress && (
            <p className="mt-1 text-xs font-medium text-wa-text-secondary">
              Analysiere {loadingAllProgress.done}/{loadingAllProgress.total} Chats
              {" · "}
              {loadingAllProgress.messagesLoaded} Nachrichten in fertigen Chats
            </p>
          )}
          {selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL && lastAnalyzedMessageCount != null && suggestions && suggestions.length > 0 && (
            <p className="mt-1 text-xs text-wa-text-secondary">
              {lastAnalyzedMessageCount} Nachrichten ausgewertet
            </p>
          )}
          {leftTab !== "dashboard" && selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL && !loadingAllSuggestions && (
            <div className="mt-2 space-y-2">
              <TodoAnalyzeCacheControl
                id="todo-analyze-cache-suggestions"
                analyzeForce={analyzeForce}
                onChange={setAnalyzeCacheForce}
              />
              <div className="flex gap-2">
                <TodoGlassButton
                  variant="primary"
                  className="flex-1"
                  onClick={handleSingleAnalyzeClick}
                  disabled={isCurrentChatAnalyzing}
                  title="Diesen Chat analysieren (Shift+Klick: Einstellungen)"
                >
                  {isCurrentChatAnalyzing ? "Analysiere…" : "Todo-Vorschläge laden"}
                </TodoGlassButton>
                {isCurrentChatAnalyzing && (
                  <button
                    type="button"
                    onClick={cancelAnalyzeSingle}
                    title="Analyse abbrechen"
                    className="shrink-0 rounded-lg border border-red-400/60 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-500/20"
                  >
                    Abbrechen
                  </button>
                )}
              </div>
              {isCurrentChatAnalyzing && analyzeStep && (
                <p className="mt-1 text-xs text-wa-text-secondary">
                  {selectedChatName ?? "Chat"}: Schritt {analyzeStepIndex + 1}/3:{" "}
                  {analyzeStepIndex === 0
                    ? (selectedChatId && typeof loadingMessagePagesByChatId[selectedChatId] === "number"
                        ? `Lade Nachrichten #${loadingMessagePagesByChatId[selectedChatId]}`
                        : "Lade Nachrichten…")
                    : analyzeStep}
                </p>
              )}
              {analyzeErrorByChatId[selectedChatId] && (
                <p className="mt-1 text-xs text-red-400">{analyzeErrorByChatId[selectedChatId]}</p>
              )}
            </div>
          )}
        </div>
        }
      >
        <TodoGlassPanelScroll ref={suggestionsColumnRef}>
          {triageEnabled && leftTab !== "dashboard" && triageQueue.length > 0 ? (
            <TodoSuggestionTriage
              items={triageQueue}
              onReject={(item) => rejectSuggestion(item.chatId, item.indexInChat)}
              onAccept={(item) => {
                void acceptSuggestion(
                  item.suggestion,
                  true,
                  item.chatId,
                  item.chatName,
                  item.chatId,
                  item.indexInChat
                );
              }}
              onOpenChat={
                accountId ? (chatId) => onOpenChat(chatId, accountId) : undefined
              }
              onPersistSuggestion={(item, patch) =>
                updateSuggestion(item.chatId, item.indexInChat, patch)
              }
              onChatNameChange={(chatId, chatName) =>
                setTriageChatNameById((prev) => ({ ...prev, [chatId]: chatName }))
              }
            />
          ) : loadingAllSuggestions && batchSuggestionsFlat.length > 0 ? (
            <div>
              <p className="mb-2 text-xs text-wa-text-secondary">
                Vorschläge von {batchSuggestionsFlat.length > 0 ? new Set(batchSuggestionsFlat.map((x) => x.chatId)).size : 0} Chats (während der Analyse)
              </p>
              <ul className="space-y-2">
                {batchSuggestionsFlat.map(({ chatId, chatName, suggestion: s, indexInChat }, idx) => {
                  const isEditing = editingSuggestion?.chatId === chatId && editingSuggestion?.index === indexInChat;
                  return (
                    <li
                      key={`${chatId}-${indexInChat}-${idx}`}
                      onMouseEnter={() => {
                        hoveredSuggestionChatIdRef.current = chatId;
                      }}
                      onMouseLeave={() => {
                        if (hoveredSuggestionChatIdRef.current === chatId) {
                          hoveredSuggestionChatIdRef.current = null;
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setChatContextMenu(null);
                        setSuggestionContextMenu({ chatId, x: e.clientX, y: e.clientY });
                      }}
                      className="flex items-start justify-between gap-2 tg-surface p-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <SuggestionJumpToChatButton
                          chatId={chatId}
                          chatName={chatName}
                          accountId={accountId}
                          onOpenChat={onOpenChat}
                          variant="chip"
                        />
                        {isEditing ? (
                          <TodoSuggestionInlineEditor
                            key={`ed-${chatId}-${indexInChat}`}
                            suggestion={s}
                            initialFocus={
                              editingSuggestion?.chatId === chatId && editingSuggestion?.index === indexInChat
                                ? editingSuggestion.focus
                                : undefined
                            }
                            onPersist={(patch) => updateSuggestion(chatId, indexInChat, patch)}
                            onFinish={() => setEditingSuggestion(null)}
                            onAccept={(item) =>
                              void acceptSuggestion(item, false, chatId, chatName, chatId, indexInChat).then((r) => {
                                if (r?.duplicate) alert("Bereits in der Liste");
                              })
                            }
                          />
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "title" })}
                              title="Titel bearbeiten (Fokus direkt im Feld, Enter speichert)"
                              className="mt-1 block text-left font-medium text-wa-text-primary hover:underline"
                            >
                              {s.title}
                            </button>
                            {s.due ? (
                              <button
                                type="button"
                                onClick={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "due" })}
                                className="mt-0.5 block text-left text-wa-text-secondary hover:underline"
                                title={`${s.due} – Kalender öffnen`}
                              >
                                Frist: {formatSuggestionDue(s)}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "due" })}
                                className="mt-0.5 block text-left text-xs text-wa-green hover:underline"
                                title="Frist setzen"
                              >
                                + Frist setzen
                              </button>
                            )}
                            {s.estimated_time_minutes != null && s.estimated_time_minutes > 0 && (
                              <div className="mt-0.5 text-wa-text-secondary" title="Geschätzte Zeit (KI)">
                                ⏱ ~{formatEstimatedTime(s.estimated_time_minutes)}
                              </div>
                            )}
                            {s.notes ? (
                              <RichTextNotes
                                text={s.notes}
                                className="mt-1 text-sm text-wa-text-secondary"
                                title="Details bearbeiten (Shift+Enter = Zeilenumbruch)"
                                onActivate={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "notes" })}
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "notes" })}
                                className="mt-1 block text-left text-xs text-wa-green hover:underline"
                                title="Beschreibung hinzufügen"
                              >
                                + Details / Notizen
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {!isEditing && (
                        <div className="flex shrink-0 gap-1.5">
                          <SuggestionJumpToChatButton
                            chatId={chatId}
                            accountId={accountId}
                            onOpenChat={onOpenChat}
                          />
                          <button
                            type="button"
                            onClick={() => rejectSuggestion(chatId, indexInChat)}
                            title="Vorschlag ablehnen"
                            className="rounded border border-wa-border bg-transparent px-3 py-1.5 text-sm font-medium text-wa-text-secondary hover:bg-wa-panel hover:text-wa-text-primary"
                          >
                            Ablehnen
                          </button>
                          <button
                            type="button"
                            onClick={() => acceptSuggestion(s, false, chatId, chatName, chatId, indexInChat).then((r) => r?.duplicate && alert("Bereits in der Liste"))}
                            title="Vorschlag in Todo-Liste übernehmen"
                            className="rounded bg-wa-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                          >
                            Akzeptieren
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : loadingAllSuggestions && loadingAllProgress ? (
            <p className="text-sm text-wa-text-secondary">
              Analysiere {loadingAllProgress.done}/{loadingAllProgress.total} Chats
              {" · "}
              {loadingAllProgress.messagesLoaded} Nachrichten in fertigen Chats
              . Vorschläge erscheinen hier, sobald Chats fertig sind.
            </p>
          ) : selectedChatId === ALL_CHATS_SENTINEL ? (
            allSuggestionsFlat.length > 0 ? (
              <div>
                <p className="mb-2 text-xs text-wa-text-secondary">
                  Alle Vorschläge aus {new Set(allSuggestionsFlat.map((x) => x.chatId)).size} Chats
                </p>
                <input
                  type="text"
                  value={allSuggestionsQuery}
                  onChange={(e) => setAllSuggestionsQuery(e.target.value)}
                  placeholder="Volltextsuche in Chat, Titel, Notizen…"
                  className="mb-3 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary"
                />
                {allSuggestionsQuery.trim() && (
                  <p className="mb-2 text-xs text-wa-text-secondary">
                    Treffer: {filteredAllSuggestionsFlat.length} / {allSuggestionsFlat.length}
                  </p>
                )}
                <ul className="space-y-2">
                  {filteredAllSuggestionsFlat.map(({ chatId, chatName, suggestion: s, indexInChat }, idx) => {
                    const isEditing = editingSuggestion?.chatId === chatId && editingSuggestion?.index === indexInChat;
                    return (
                      <li
                        key={`all-${chatId}-${indexInChat}-${idx}`}
                        onMouseEnter={() => {
                          hoveredSuggestionChatIdRef.current = chatId;
                        }}
                        onMouseLeave={() => {
                          if (hoveredSuggestionChatIdRef.current === chatId) {
                            hoveredSuggestionChatIdRef.current = null;
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setChatContextMenu(null);
                          setSuggestionContextMenu({ chatId, x: e.clientX, y: e.clientY });
                        }}
                        className="flex items-start justify-between gap-2 tg-surface p-3 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <SuggestionJumpToChatButton
                            chatId={chatId}
                            chatName={chatName}
                            accountId={accountId}
                            onOpenChat={onOpenChat}
                            variant="chip"
                          />
                          {isEditing ? (
                            <TodoSuggestionInlineEditor
                              key={`ed-all-${chatId}-${indexInChat}`}
                              suggestion={s}
                              initialFocus={
                                editingSuggestion?.chatId === chatId && editingSuggestion?.index === indexInChat
                                  ? editingSuggestion.focus
                                  : undefined
                              }
                              onPersist={(patch) => updateSuggestion(chatId, indexInChat, patch)}
                              onFinish={() => setEditingSuggestion(null)}
                              onAccept={(item) =>
                                void acceptSuggestion(item, false, chatId, chatName, chatId, indexInChat).then((r) => {
                                  if (r?.duplicate) alert("Bereits in der Liste");
                                })
                              }
                            />
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "title" })}
                                title="Titel bearbeiten"
                                className="mt-1 block text-left font-medium text-wa-text-primary hover:underline"
                              >
                                {s.title}
                              </button>
                              {s.due ? (
                                <button
                                  type="button"
                                  onClick={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "due" })}
                                  className="mt-0.5 block text-left text-wa-text-secondary hover:underline"
                                  title={`${s.due} – Kalender öffnen`}
                                >
                                  Frist: {formatSuggestionDue(s)}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "due" })}
                                  className="mt-0.5 block text-left text-xs text-wa-green hover:underline"
                                >
                                  + Frist setzen
                                </button>
                              )}
                              {s.estimated_time_minutes != null && s.estimated_time_minutes > 0 && (
                                <div className="mt-0.5 text-wa-text-secondary" title="Geschätzte Zeit (KI)">
                                  ⏱ ~{formatEstimatedTime(s.estimated_time_minutes)}
                                </div>
                              )}
                              {s.notes ? (
                                <RichTextNotes
                                  text={s.notes}
                                  className="mt-1 text-sm text-wa-text-secondary"
                                  title="Details bearbeiten"
                                  onActivate={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "notes" })}
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setEditingSuggestion({ chatId, index: indexInChat, focus: "notes" })}
                                  className="mt-1 block text-left text-xs text-wa-green hover:underline"
                                >
                                  + Details / Notizen
                                </button>
                              )}
                            </>
                          )}
                        </div>
                        {!isEditing && (
                          <div className="flex shrink-0 gap-1.5">
                            <SuggestionJumpToChatButton
                              chatId={chatId}
                              accountId={accountId}
                              onOpenChat={onOpenChat}
                            />
                            <button
                              type="button"
                              onClick={() => rejectSuggestion(chatId, indexInChat)}
                              title="Vorschlag ablehnen"
                              className="rounded border border-wa-border bg-transparent px-3 py-1.5 text-sm font-medium text-wa-text-secondary hover:bg-wa-panel hover:text-wa-text-primary"
                            >
                              Ablehnen
                            </button>
                            <button
                              type="button"
                              onClick={() => acceptSuggestion(s, false, chatId, chatName, chatId, indexInChat).then((r) => r?.duplicate && alert("Bereits in der Liste"))}
                              title="Vorschlag in Todo-Liste übernehmen"
                              className="rounded bg-wa-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                            >
                              Akzeptieren
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {allSuggestionsQuery.trim() && filteredAllSuggestionsFlat.length === 0 && (
                  <p className="mt-3 text-sm text-wa-text-secondary">Keine Treffer für die Suche.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-wa-text-secondary">Keine Vorschläge in allen Chats vorhanden.</p>
            )
          ) : !selectedChatId && !loadingAllSuggestions ? (
            <div className="space-y-2 text-sm text-wa-text-secondary">
              <p>Chat links wählen oder Batch starten.</p>
              {typeof window !== "undefined" && sessionStorage.getItem(LAST_CHAT_STORAGE_KEY) && (
                <button
                  type="button"
                  className="text-wa-green hover:underline"
                  onClick={() => {
                    const last = sessionStorage.getItem(LAST_CHAT_STORAGE_KEY);
                    if (last) setSelectedChatId(last);
                  }}
                >
                  Letzten Chat öffnen
                </button>
              )}
            </div>
          ) : suggestions && suggestions.length > 0 ? (
            <div>
              {selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL && accountId && (
                <SuggestionJumpToChatButton
                  chatId={selectedChatId}
                  chatName={selectedChatName ?? undefined}
                  accountId={accountId}
                  onOpenChat={onOpenChat}
                  variant="triage"
                  className="mb-2"
                />
              )}
              <button
                type="button"
                onClick={acceptAll}
                title="Alle Vorschläge dieses Chats in die Todo-Liste übernehmen"
                className="mb-3 w-full rounded-lg border border-wa-green bg-wa-green/10 px-2 py-1.5 text-sm font-medium text-wa-green"
              >
                Alle übernehmen
              </button>
              {acceptAllResult && (
                <p className="mb-2 text-xs text-wa-text-secondary">
                  Übernommen: {acceptAllResult.inserted}, übersprungen: {acceptAllResult.skipped}
                </p>
              )}
              <ul className="space-y-2">
                {suggestions.map((s, i) => {
                  const isEditing = selectedChatId && editingSuggestion?.chatId === selectedChatId && editingSuggestion?.index === i;
                  return (
                    <li
                      key={`${s.title}-${i}`}
                      onMouseEnter={() => {
                        if (selectedChatId && selectedChatId !== ALL_CHATS_SENTINEL) {
                          hoveredSuggestionChatIdRef.current = selectedChatId;
                        }
                      }}
                      onMouseLeave={() => {
                        if (
                          selectedChatId &&
                          selectedChatId !== ALL_CHATS_SENTINEL &&
                          hoveredSuggestionChatIdRef.current === selectedChatId
                        ) {
                          hoveredSuggestionChatIdRef.current = null;
                        }
                      }}
                      onContextMenu={(e) => {
                        if (!selectedChatId || selectedChatId === ALL_CHATS_SENTINEL) return;
                        e.preventDefault();
                        setChatContextMenu(null);
                        setSuggestionContextMenu({ chatId: selectedChatId, x: e.clientX, y: e.clientY });
                      }}
                      className="flex items-start justify-between gap-2 tg-surface p-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        {isEditing && selectedChatId ? (
                          <TodoSuggestionInlineEditor
                            key={`ed-single-${selectedChatId}-${i}`}
                            suggestion={s}
                            initialFocus={
                              editingSuggestion?.chatId === selectedChatId && editingSuggestion?.index === i
                                ? editingSuggestion.focus
                                : undefined
                            }
                            onPersist={(patch) => updateSuggestion(selectedChatId, i, patch)}
                            onFinish={() => setEditingSuggestion(null)}
                            onAccept={(item) =>
                              void acceptSuggestion(item, false, undefined, undefined, selectedChatId ?? undefined, i).then(
                                (r) => {
                                  if (r?.duplicate) alert("Bereits in der Liste");
                                }
                              )
                            }
                          />
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => selectedChatId && setEditingSuggestion({ chatId: selectedChatId, index: i, focus: "title" })}
                              title="Titel bearbeiten"
                              className="block text-left font-medium text-wa-text-primary hover:underline"
                            >
                              {s.title}
                            </button>
                            {s.due ? (
                              <button
                                type="button"
                                onClick={() => selectedChatId && setEditingSuggestion({ chatId: selectedChatId, index: i, focus: "due" })}
                                className="mt-0.5 block text-left text-wa-text-secondary hover:underline"
                                title={`${s.due} – Kalender öffnen`}
                              >
                                Frist: {formatSuggestionDue(s)}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => selectedChatId && setEditingSuggestion({ chatId: selectedChatId, index: i, focus: "due" })}
                                className="mt-0.5 block text-left text-xs text-wa-green hover:underline"
                              >
                                + Frist setzen
                              </button>
                            )}
                            {s.estimated_time_minutes != null && s.estimated_time_minutes > 0 && (
                              <div className="mt-0.5 text-wa-text-secondary" title="Geschätzte Zeit (KI)">
                                ⏱ ~{formatEstimatedTime(s.estimated_time_minutes)}
                              </div>
                            )}
                            {s.notes ? (
                              <RichTextNotes
                                text={s.notes}
                                className="mt-1 text-sm text-wa-text-secondary"
                                onActivate={() =>
                                  selectedChatId && setEditingSuggestion({ chatId: selectedChatId, index: i, focus: "notes" })
                                }
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => selectedChatId && setEditingSuggestion({ chatId: selectedChatId, index: i, focus: "notes" })}
                                className="mt-1 block text-left text-xs text-wa-green hover:underline"
                              >
                                + Details / Notizen
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {!isEditing && selectedChatId && (
                        <div className="flex shrink-0 gap-1.5">
                          <SuggestionJumpToChatButton
                            chatId={selectedChatId}
                            accountId={accountId}
                            onOpenChat={onOpenChat}
                          />
                          <button
                            type="button"
                            onClick={() => selectedChatId && rejectSuggestion(selectedChatId, i)}
                            title="Vorschlag ablehnen (aus Liste entfernen)"
                            className="rounded border border-wa-border bg-transparent px-3 py-1.5 text-sm font-medium text-wa-text-secondary hover:bg-wa-panel hover:text-wa-text-primary"
                          >
                            Ablehnen
                          </button>
                          <button
                            type="button"
                            onClick={() => acceptSuggestion(s, false, undefined, undefined, selectedChatId ?? undefined, i).then((r) => r?.duplicate && alert("Bereits in der Liste"))}
                            title="Vorschlag in Todo-Liste übernehmen"
                            className="rounded bg-wa-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
                          >
                            Akzeptieren
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-wa-text-secondary">
              <p>Keine Vorschläge für diesen Chat.</p>
              <button
                type="button"
                onClick={handleSingleAnalyzeClick}
                className="rounded-lg bg-wa-green px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Erneut analysieren
              </button>
              <button
                type="button"
                onClick={() =>
                  openAnalyzeSettingsModal("single", {
                    chat: selectedChat ?? undefined,
                    presetId: "force_refresh",
                  })
                }
                className="block text-xs text-wa-text-secondary underline"
              >
                Cache ignorieren (Einstellungen)
              </button>
            </div>
          )}
        </TodoGlassPanelScroll>
      </TodoGlassPanel>

      <TodoGlassResizeHandle
        aria-label="Spaltenbreite Vorschläge anpassen"
        onMouseDown={handleResizeMouseDown(2)}
      />

      {/* Column 3: Alle Todos */}
      <TodoGlassPanel
        className="min-w-0 flex-1"
        style={{ minWidth: MIN_COL3 }}
        header={
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h2 className="shrink-0 text-sm font-semibold text-wa-text-primary">Alle Todos</h2>
            <TodoGlassInput
              type="search"
              placeholder="Suchen…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="min-w-0 flex-1 py-1.5 text-xs"
              aria-label="Todo-Liste durchsuchen"
              title="Todos durchsuchen (Titel, Notizen, Chat-Name)"
            />
          </div>
          <div className="tg-surface-muted flex flex-wrap items-center gap-1 p-2">
            {[
              { emoji: "📋", label: "Offen", title: "Nur offene Todos (ohne Remind later)", status: "open" as const, due: "any" as const },
              { emoji: "📅", label: "Heute", title: "Offene mit Frist heute", status: "open" as const, due: "due_today" as const },
              { emoji: "⚠️", label: "Überfällig", title: "Offene mit überfälliger Frist", status: "open" as const, due: "overdue" as const },
              { emoji: "📂", label: "Alle", title: "Alle Todos (offen, erledigt, Archiv, Remind later)", status: "all" as const, due: "any" as const },
            ].map(({ emoji, label, title: btnTitle, status, due }) => {
              const active = todoStatus === status && dueFilter === due;
              return (
                <button
                  key={`${status}-${due}`}
                  type="button"
                  onClick={() => { setTodoStatus(status); setDueFilter(due); }}
                  title={btnTitle}
                  className={`tg-chip ${active ? "tg-chip-active" : ""}`}
                >
                  {emoji}
                </button>
              );
            })}
            <span className="mx-0.5 h-4 w-px bg-wa-border" aria-hidden />
            <select
              value={sourceAccountIdFilter ?? ""}
              onChange={(e) => setSourceAccountIdFilter(e.target.value || null)}
              className="tg-input max-w-[7rem] py-1 pl-1 pr-5 text-xs"
              title="Nach Account filtern"
            >
              <option value="">👤 Alle</option>
              {accounts.map((acc) => {
                const id = getAccountId(acc);
                const label = (acc.user as { name?: string })?.name ?? id?.slice(0, 8) ?? "Account";
                return <option key={id} value={id}>👤 {label}</option>;
              })}
            </select>
            <select
              value={sourceChatIdFilter ?? ""}
              onChange={(e) => setSourceChatIdFilter(e.target.value || null)}
              className="tg-input max-w-[7rem] py-1 pl-1 pr-5 text-xs"
              title="Nach Chat filtern"
            >
              <option value="">💬 Alle</option>
              {chats.map((c) => {
                const name = (c.name ?? c.participants?.[0]?.name ?? c.id?.slice(0, 8) ?? "Chat") as string;
                return <option key={c.id} value={c.id}>💬 {name}</option>;
              })}
            </select>
            <select
              value={todoStatus}
              onChange={(e) => setTodoStatus(e.target.value as typeof todoStatus)}
              className="max-w-[6rem] rounded border border-wa-border bg-wa-input-bg py-1 pl-1 pr-5 text-xs text-wa-text-primary"
              title="Status: Offen, Erledigt, Archiv, Remind later, Alle"
            >
              <option value="open">📋 Offen</option>
              <option value="snoozed">⏰ Remind</option>
              <option value="completed">✅ Erledigt</option>
              <option value="archived">📦 Archiv</option>
              <option value="all">📂 Alle</option>
            </select>
            <select
              value={dueFilter}
              onChange={(e) => setDueFilter(e.target.value as typeof dueFilter)}
              className="w-auto min-w-0 rounded border border-wa-border bg-wa-input-bg py-1 pl-1 pr-5 text-xs text-wa-text-primary"
              title="Frist-Filter"
            >
              <option value="any">📅 Alle</option>
              <option value="due_today">Heute</option>
              <option value="overdue">Überfällig</option>
            </select>
            <select
              value={listIdFilter ?? ""}
              onChange={(e) => setListIdFilter(e.target.value || null)}
              className="max-w-[6rem] rounded border border-wa-border bg-wa-input-bg py-1 pl-1 pr-5 text-xs text-wa-text-primary"
              title="Nach Liste filtern"
            >
              <option value="">📁 Alle</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>📁 {l.name}</option>
              ))}
            </select>
            <select
              value={`${sort}-${order}`}
              onChange={(e) => {
                const [s, o] = (e.target.value.split("-") as [typeof sort, typeof order]);
                setSort(s); setOrder(o);
              }}
              className="tg-input max-w-[7rem] py-1 pl-1 pr-5 text-xs"
              title="Sortierung"
            >
              <option value="due-asc">↗️ Frist ↑</option>
              <option value="due-desc">↘️ Frist ↓</option>
              <option value="priority-desc">⭐ Priorität</option>
              <option value="title-asc">🔤 A–Z</option>
              <option value="created-desc">🕐 Neueste</option>
              <option value="sort_order-asc">⋮⋮ Manuell</option>
            </select>
            <span className="mx-0.5 h-4 w-px bg-wa-border" aria-hidden />
            <button
              type="button"
              onClick={refreshTodoCache}
              disabled={refreshingTodos}
              title="Liste neu laden (Cache leeren)"
              className="rounded px-1.5 py-1 text-base leading-none text-wa-text-secondary hover:bg-wa-panel hover:text-wa-text-primary disabled:opacity-50"
            >
              🔄
            </button>
            <button
              type="button"
              onClick={runSmartSort}
              disabled={smartSortLoading || todos.length === 0}
              title="Smart Sort: Liste per KI nach Dringlichkeit sortieren (Titel/Text zuerst, Frist zweitrangig)"
              className="rounded px-1.5 py-1 text-base leading-none text-wa-text-secondary hover:bg-wa-panel hover:text-wa-text-primary disabled:opacity-50"
            >
              ✨
            </button>
            {smartSortError && (
              <span className="text-xs text-red-500" role="alert" title={smartSortError}>
                ⚠️
              </span>
            )}
            <a
              href={`/api/todo-list/todos/export?format=csv&status=${todoStatus}&dueFilter=${dueFilter}&sort=${sort}&order=${order}${searchQ ? `&q=${encodeURIComponent(searchQ)}` : ""}${listIdFilter ? `&list_id=${encodeURIComponent(listIdFilter)}` : ""}${sourceAccountIdFilter ? `&source_account_id=${encodeURIComponent(sourceAccountIdFilter)}` : ""}${sourceChatIdFilter ? `&source_chat_id=${encodeURIComponent(sourceChatIdFilter)}` : ""}`}
              download="todos.csv"
              title="Als CSV exportieren"
              className="rounded px-1.5 py-1 text-base leading-none text-wa-text-secondary hover:bg-wa-panel hover:text-wa-text-primary"
            >
              📥
            </a>
          </div>
        </div>
        }
      >
        <TodoGlassPanelScroll>
        <ul ref={todosListScrollRef} className="space-y-2">
          {todos.map((todo, index) => (
            <li
              key={todo.id}
              draggable
              onDragStart={(e) => handleTodoDragStart(e, todo.id)}
              onDragOver={(e) => handleTodoDragOver(e, index)}
              onDragLeave={handleTodoDragLeave}
              onDrop={(e) => handleTodoDrop(e, index)}
              onDragEnd={handleTodoDragEnd}
              className={`tg-list-row cursor-grab active:cursor-grabbing items-start gap-2 p-2 transition-opacity ${
                draggedTodoId === todo.id ? "opacity-50" : ""
              } ${
                isOverdue(todo.due_date)
                  ? "border-red-400/60 bg-red-500/10"
                  : isDueToday(todo.due_date)
                    ? "border-amber-400/60 bg-amber-500/10"
                    : ""
              } ${dropIndex === index ? "ring-2 ring-wa-green ring-inset" : ""}`}
            >
              <span className="mr-1 shrink-0 text-wa-text-secondary/60" aria-hidden title="Zum Umsortieren ziehen">
                ⋮⋮
              </span>
              <input
                type="checkbox"
                checked={todo.completed === 1}
                onChange={() => toggleComplete(todo)}
                title={
                  todo.completed === 1
                    ? "Als offen markieren"
                    : "Als erledigt markieren · Rückgängig: Strg+Z (Windows) oder ⌘Z (Mac)"
                }
                className="mt-1 shrink-0 rounded border-wa-border text-wa-green focus:ring-wa-green"
              />
              <div className="min-w-0 flex-1">
                {editingTodoId === todo.id ? (
                  <input
                    type="text"
                    defaultValue={todo.title}
                    onBlur={(e) => {
                      if (todoTitleEscapeCancelRef.current) {
                        todoTitleEscapeCancelRef.current = false;
                        return;
                      }
                      const v = e.target.value.trim();
                      if (v && v !== todo.title) {
                        void updateTodo(todo.id, { title: v });
                      } else {
                        setEditingTodoId(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") return;
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    title="Enter: speichern · Esc: abbrechen"
                    className="w-full rounded border border-wa-border bg-wa-input-bg px-2 py-0.5 text-sm text-wa-text-primary"
                    autoFocus
                  />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingTodoId(todo.id)}
                      title="Titel bearbeiten (Klick)"
                      className={`text-left text-sm font-medium text-wa-text-primary ${todo.completed ? "line-through opacity-70" : ""}`}
                    >
                      {todo.title}
                    </button>
                    <TodoSyncBadge
                      todoSyncTarget={todoSyncTarget}
                      externalGoogleTaskId={todo.external_google_task_id}
                      externalReclaimTaskId={todo.external_reclaim_task_id}
                    />
                  </div>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-wa-text-secondary">
                  {(todo.source_chat_id || getTodoChatDisplayName(todo, accountId, chats)) && (
                    todo.source_chat_id && (todo.source_account_id ?? accountId) ? (
                      <button
                        type="button"
                        onClick={() => onOpenChat(todo.source_chat_id!, todo.source_account_id ?? accountId!)}
                        title="Zum Chat springen (in neuem Tab öffnen)"
                        className="rounded bg-wa-panel-secondary/80 px-1.5 py-0.5 text-left text-wa-text-secondary hover:bg-wa-panel hover:text-wa-green hover:underline"
                      >
                        Chat: {getTodoChatDisplayName(todo, accountId, chats) ?? todo.source_chat_id?.slice(0, 8) ?? "—"}
                      </button>
                    ) : (
                      <span className="rounded bg-wa-panel-secondary/80 px-1.5 py-0.5" title={todo.source_chat_id ?? undefined}>
                        Chat: {getTodoChatDisplayName(todo, accountId, chats) ?? todo.source_chat_id?.slice(0, 8) ?? "—"}
                      </span>
                    )
                  )}
                  {editingDueId === todo.id ? (
                    <DueDatePicker
                      variant="compact"
                      defaultOpen
                      commitOnSelect
                      value={todoDueToDateTime(todo)}
                      onChange={(dt) => {
                        void updateTodo(todo.id, {
                          due_date: syncDueDateFromDateTime(dt),
                          due_at: dueDateTimeToMs(dt),
                          due_time: dt.time,
                        } as Partial<TodoItem> & { due_time?: string | null });
                        setEditingDueId(null);
                      }}
                      onClose={() => {
                        if (todoDueEscapeCancelRef.current) {
                          todoDueEscapeCancelRef.current = false;
                        }
                        setEditingDueId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingDueId(todo.id)}
                      className="text-left hover:underline"
                      title={
                        todo.due_date || todo.due_at
                          ? `Frist bearbeiten`
                          : "Frist setzen"
                      }
                    >
                      {todo.due_date || todo.due_at
                        ? `Frist: ${formatDueDateTimeRelative(todoDueToDateTime(todo))}`
                        : "Frist setzen"}
                    </button>
                  )}
                  {todo.priority != null && <span>P{todo.priority}</span>}
                  {(todo.estimated_time_minutes ?? null) != null && (
                    <span className="rounded bg-wa-panel-secondary/80 px-1.5 py-0.5 text-wa-text-secondary" title="Geschätzte Umsatzzeit (KI)">
                      ⏱ ~{formatEstimatedTime(todo.estimated_time_minutes!)}
                    </span>
                  )}
                  {(todo.reminder_at ?? null) != null && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-700 dark:text-amber-400" title={`Erinnerung: ${formatReminderAt(todo.reminder_at!)}`}>
                      🔔 {formatReminderAt(todo.reminder_at!)}
                    </span>
                  )}
                  {(todo.pinned ?? 0) === 1 && (
                    <button
                      type="button"
                      onClick={() => updateTodo(todo.id, { pinned: 0 })}
                      className="tg-btn-ghost px-1.5 py-0.5 text-xs"
                      title="Als gesehen markieren (Pin entfernen)"
                    >
                      Gesehen
                    </button>
                  )}
                  <select
                    value=""
                    onChange={(e) => {
                      const v = e.target.value;
                      e.target.value = "";
                      if (v === "") return;
                      if (v === "clear") {
                        updateTodo(todo.id, { reminder_at: null, snoozed: 0, pinned: 0, archived: 0 });
                        return;
                      }
                      const ms = parseInt(v, 10);
                      if (Number.isNaN(ms)) return;
                      // Preserve scroll position so list doesn't jump when todo leaves open list.
                      const el = todosListScrollRef.current;
                      if (el) saveScrollTopAfterReminderRef.current = el.scrollTop;
                      updateTodo(todo.id, { reminder_at: ms, snoozed: 1, pinned: 0, archived: 1 });
                    }}
                    className="tg-btn-ghost px-1.5 py-0.5 text-xs"
                    title="Erinnerung setzen"
                  >
                    <option value="">Erinnern…</option>
                    {getReminderPresets().map((p, idx) => (
                      <option key={`${p.label}-${p.atMs}-${idx}`} value={p.atMs}>
                        {p.label}
                      </option>
                    ))}
                    <option value="clear">Erinnerung entfernen</option>
                  </select>
                  {todo.source_chat_id && (todo.source_account_id ?? accountId) && (
                    <button
                      type="button"
                      onClick={() => onOpenChat(todo.source_chat_id!, todo.source_account_id ?? accountId!)}
                      title="Quell-Chat in neuem Tab öffnen"
                      className="text-wa-green hover:underline"
                    >
                      Chat öffnen
                    </button>
                  )}
                  {todo.notes && (
                    <RichTextNotes
                      text={todo.notes}
                      className="mt-0.5 text-sm text-wa-text-secondary"
                    />
                  )}
                </div>
                {editingNotesId === todo.id && (
                  <textarea
                    value={editingNotesDraft}
                    onChange={(e) => setEditingNotesDraft(e.target.value)}
                    onBlur={(e) => {
                      if (todoNotesEscapeCancelRef.current) {
                        todoNotesEscapeCancelRef.current = false;
                        return;
                      }
                      const v = e.target.value.trim() || null;
                      if (v !== (todo.notes ?? null)) {
                        void updateTodo(todo.id, { notes: v });
                      } else {
                        setEditingNotesId(null);
                      }
                    }}
                    onKeyDown={(e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
                      if (e.key === "Escape") return;
                      if (e.key !== "Enter") return;
                      if (e.shiftKey) {
                        e.preventDefault();
                        const el = e.currentTarget;
                        const start = el.selectionStart ?? 0;
                        const end = el.selectionEnd ?? 0;
                        setEditingNotesDraft((prev) => prev.slice(0, start) + "\n" + prev.slice(end));
                        queueMicrotask(() => {
                          const pos = start + 1;
                          try {
                            el.setSelectionRange(pos, pos);
                          } catch {
                            /* ignore */
                          }
                        });
                        return;
                      }
                      e.preventDefault();
                      const v = e.currentTarget.value.trim() || null;
                      if (v !== (todo.notes ?? null)) {
                        void updateTodo(todo.id, { notes: v });
                      } else {
                        setEditingNotesId(null);
                      }
                    }}
                    rows={3}
                    title="Enter: speichern und schließen · Shift+Enter: Zeilenumbruch · Esc: abbrechen"
                    aria-label="Notizen bearbeiten, Enter speichern, Shift-Enter neue Zeile, Esc abbrechen"
                    className="mt-1 w-full rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-xs text-wa-text-primary"
                    placeholder="Notizen"
                    autoFocus
                  />
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {todoSyncTarget === "google" ? (
                  googleTasksStatus?.connected ? (
                    <button
                      type="button"
                      onClick={() => syncTodoToGoogle(todo.id)}
                      disabled={!!googleSyncLoadingByTodoId[todo.id]}
                      title="Todo als Google Task synchronisieren"
                      className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary disabled:opacity-50"
                    >
                      {googleSyncLoadingByTodoId[todo.id] ? "…" : "⬆︎G"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={connectGoogleTasks}
                      title="Google Tasks verbinden"
                      className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary"
                    >
                      G+
                    </button>
                  )
                ) : reclaimStatus?.connected ? (
                  <button
                    type="button"
                    onClick={() => syncTodoToReclaim(todo.id)}
                    disabled={!!reclaimSyncLoadingByTodoId[todo.id]}
                    title="Todo als Reclaim-Task synchronisieren"
                    className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary disabled:opacity-50"
                  >
                    {reclaimSyncLoadingByTodoId[todo.id] ? "…" : "⬆︎R"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={connectReclaim}
                    title="Reclaim verbinden (API-Token in Einstellungen)"
                    className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary"
                  >
                    R+
                  </button>
                )}
                {!editingNotesId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNotesDraft(todo.notes ?? "");
                      setEditingNotesId(todo.id);
                    }}
                    title="Notizen"
                    className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary"
                  >
                    📝
                  </button>
                )}
                {todoStatus === "open" && (
                  <button
                    type="button"
                    onClick={() => archiveTodo(todo.id)}
                    title="Archivieren"
                    className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary"
                  >
                    Archiv
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => deleteTodo(todo.id)}
                  title="Löschen"
                  className="rounded p-1 text-red-400 hover:bg-red-500/10"
                >
                  ×
                </button>
              </div>
              {todoSyncTarget === "google" && googleSyncResultByTodoId[todo.id] && (
                <div
                  className={`ml-2 text-xs ${
                    googleSyncResultByTodoId[todo.id].kind === "ok" ? "text-green-600 dark:text-green-400" : "text-red-500"
                  }`}
                  title={googleSyncResultByTodoId[todo.id].message}
                >
                  {googleSyncResultByTodoId[todo.id].kind === "ok" ? "Google Tasks: OK" : "Google Tasks: Fehler"}
                </div>
              )}
              {todoSyncTarget === "reclaim" && reclaimSyncResultByTodoId[todo.id] && (
                <div
                  className={`ml-2 text-xs ${
                    reclaimSyncResultByTodoId[todo.id].kind === "ok" ? "text-green-600 dark:text-green-400" : "text-red-500"
                  }`}
                  title={reclaimSyncResultByTodoId[todo.id].message}
                >
                  {reclaimSyncResultByTodoId[todo.id].kind === "ok" ? "Reclaim: OK" : "Reclaim: Fehler"}
                </div>
              )}
            </li>
          ))}
        </ul>
        </TodoGlassPanelScroll>
      </TodoGlassPanel>
      </TodoGlassShell>
      {chatContextMenu && (
        <div
          className="tg-popover fixed z-[100] min-w-56"
          style={{ left: chatContextMenu.x, top: chatContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <TodoGlassButton
            variant="ghost"
            fullWidth
            className="justify-start text-sm"
            onClick={() => {
              const id = chatContextMenu.chatId;
              togglePinnedChat(id, !pinnedChatIds.includes(id));
              setChatContextMenu(null);
            }}
          >
            {pinnedChatIds.includes(chatContextMenu.chatId) ? "Pin entfernen" : "Anpinnen"}
          </TodoGlassButton>
          <TodoGlassButton
            variant="ghost"
            fullWidth
            className="justify-start text-sm"
            onClick={() => {
              const id = chatContextMenu.chatId;
              updateIgnoredChatIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
              setChatContextMenu(null);
            }}
          >
            {ignoredChatIds.includes(chatContextMenu.chatId) ? "Von Ignorieren entfernen" : "Für Analyse ignorieren"}
          </TodoGlassButton>
        </div>
      )}
      {suggestionContextMenu && (
        <div
          className="tg-popover fixed z-[100] min-w-72"
          style={{ left: suggestionContextMenu.x, top: suggestionContextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <TodoGlassButton
            variant="ghost"
            fullWidth
            className="justify-start text-sm"
            onClick={() => ignoreChatForFutureSuggestions(suggestionContextMenu.chatId)}
          >
            Kontakt für zukünftige Analysen ignorieren und alle Vorschläge dieses Kontakts löschen
          </TodoGlassButton>
        </div>
      )}
    </div>
    <OnePromptResultsDialog
      open={onePromptDialogOpen}
      results={onePromptResults}
      loading={onePromptRunLoading}
      error={onePromptRunError}
      targetCount={onePromptTargetCount}
      processedCount={onePromptProcessedCount}
      acceptingByChatId={onePromptAcceptingByChatId}
      onClose={() => setOnePromptDialogOpen(false)}
      onOpenChat={(chatId) => {
        if (!accountId) return;
        onOpenChat(chatId, accountId);
      }}
      onAcceptOne={acceptOnePromptResult}
      onAcceptAll={acceptAllOnePromptResults}
      onIgnoreOne={(chatId) => setOnePromptResults((prev) => prev.filter((x) => x.chatId !== chatId))}
    />
    </>
  );
}
