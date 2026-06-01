/**
 * Client-side settings persisted in localStorage.
 * Keys are prefixed to avoid collisions.
 */

import { clampTinderMessagePreloadCount, MAX_CHAT_MESSAGES } from "@/lib/chat-message-limits";

const PREFIX = "beeper-crm:";

export const SETTING_KEYS = {
  colorTheme: PREFIX + "colorTheme",
  autoInsertFirstSuggestion: PREFIX + "autoInsertFirstSuggestion",
  shiftEnterJumpsToNextChat: PREFIX + "shiftEnterJumpsToNextChat",
  openChatWith: PREFIX + "openChatWith",
  tinderKeyboardLayout: PREFIX + "tinderKeyboardLayout",
  tinderMessagePreloadCount: PREFIX + "tinderMessagePreloadCount",
  chatViewFilter: PREFIX + "chatViewFilter",
  crmViewFilter: PREFIX + "crmViewFilter",
  crmSidebarMessagePanelHeightPx: PREFIX + "crmSidebarMessagePanelHeightPx",
  crmSidebarWidthPercent: PREFIX + "crmSidebarWidthPercent",
  crmFocusMode: PREFIX + "crmFocusMode",
  todoListAccountId: PREFIX + "todoListAccountId",
  todoAnalyzePrefs: PREFIX + "todoAnalyzePrefs",
  lastTodoAnalyzePreset: PREFIX + "lastTodoAnalyzePreset",
} as const;

/** Legacy keys (migrated into todoAnalyzePrefs). */
const LEGACY_TODO_ANALYZE_UI_KEY = PREFIX + "todo-analyze-ui";
const LEGACY_TODO_ANALYZE_ATTACHMENT_KEY = PREFIX + "todo-analyze-attachment-mode";
const LEGACY_TODO_SUGGESTIONS_VIEW_KEY = PREFIX + "todo-suggestions-view";

function getItem(key: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key);
}

function setItem(key: string, value: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, value);
}

export type ColorTheme = "light" | "dark";

/** Default UI theme is light (white), matching product ask. Legacy users can switch to dark in settings. */
export function getColorTheme(): ColorTheme {
  const v = getItem(SETTING_KEYS.colorTheme);
  return v === "dark" ? "dark" : "light";
}

export function setColorTheme(theme: ColorTheme): void {
  setItem(SETTING_KEYS.colorTheme, theme);
}

export function getAutoInsertFirstSuggestion(): boolean {
  const v = getItem(SETTING_KEYS.autoInsertFirstSuggestion);
  return v === "true";
}

export function setAutoInsertFirstSuggestion(value: boolean): void {
  setItem(SETTING_KEYS.autoInsertFirstSuggestion, String(value));
}

export function getShiftEnterJumpsToNextChat(): boolean {
  const v = getItem(SETTING_KEYS.shiftEnterJumpsToNextChat);
  return v === "true";
}

export function setShiftEnterJumpsToNextChat(value: boolean): void {
  setItem(SETTING_KEYS.shiftEnterJumpsToNextChat, String(value));
}

export type OpenChatWith = "browser" | "client";

export function getOpenChatWith(): OpenChatWith {
  const v = getItem(SETTING_KEYS.openChatWith);
  return v === "browser" || v === "client" ? v : "client";
}

export function setOpenChatWith(value: OpenChatWith): void {
  setItem(SETTING_KEYS.openChatWith, value);
}

export type TinderKeyboardLayout = "classic" | "touch";

export function getTinderKeyboardLayout(): TinderKeyboardLayout {
  const v = getItem(SETTING_KEYS.tinderKeyboardLayout);
  return v === "classic" || v === "touch" ? v : "classic";
}

export function setTinderKeyboardLayout(value: TinderKeyboardLayout): void {
  setItem(SETTING_KEYS.tinderKeyboardLayout, value);
}

export function getTinderMessagePreloadCount(): number {
  const raw = getItem(SETTING_KEYS.tinderMessagePreloadCount);
  const n = raw ? Number(raw) : NaN;
  if (Number.isNaN(n)) return 50;
  return clampTinderMessagePreloadCount(n);
}

export function setTinderMessagePreloadCount(value: number): void {
  const n = clampTinderMessagePreloadCount(value);
  setItem(SETTING_KEYS.tinderMessagePreloadCount, String(n));
}

export function getTodoListAccountId(): string | null {
  const v = getItem(SETTING_KEYS.todoListAccountId);
  return v && v.trim() ? v.trim() : null;
}

export function setTodoListAccountId(accountId: string | null): void {
  if (accountId && accountId.trim()) {
    setItem(SETTING_KEYS.todoListAccountId, accountId.trim());
  } else {
    if (typeof window !== "undefined") window.localStorage.removeItem(SETTING_KEYS.todoListAccountId);
  }
}

export type TodoAnalyzeScanMode = "count" | "age" | "both";
export type TodoAnalyzeMaxAgeUnit = "days" | "weeks" | "months";
export type TodoAnalyzeAttachmentMode = "fast" | "full";

export interface SavedTodoAnalyzePrefs {
  scanMode: TodoAnalyzeScanMode;
  maxAgeValue: number;
  maxAgeUnit: TodoAnalyzeMaxAgeUnit;
  maxMessages: number;
  attachmentMode: TodoAnalyzeAttachmentMode;
  analyzeForce: boolean;
  /** OpenAI usage dashboard lookback window (days). */
  usageDays: number;
}

const DEFAULT_TODO_ANALYZE_PREFS: SavedTodoAnalyzePrefs = {
  scanMode: "both",
  maxAgeValue: 30,
  maxAgeUnit: "days",
  maxMessages: MAX_CHAT_MESSAGES,
  attachmentMode: "fast",
  analyzeForce: false,
  usageDays: 30,
};

function normalizeTodoAnalyzePrefs(raw: Record<string, unknown>): SavedTodoAnalyzePrefs {
  const out = { ...DEFAULT_TODO_ANALYZE_PREFS };
  if (raw.scanMode === "count" || raw.scanMode === "age" || raw.scanMode === "both") out.scanMode = raw.scanMode;
  if (typeof raw.maxAgeValue === "number" && !Number.isNaN(raw.maxAgeValue)) {
    out.maxAgeValue = Math.min(3650, Math.max(1, Math.round(raw.maxAgeValue)));
  }
  if (raw.maxAgeUnit === "days" || raw.maxAgeUnit === "weeks" || raw.maxAgeUnit === "months") {
    out.maxAgeUnit = raw.maxAgeUnit;
  }
  if (typeof raw.maxMessages === "number" && !Number.isNaN(raw.maxMessages)) {
    out.maxMessages = Math.min(MAX_CHAT_MESSAGES, Math.max(0, Math.round(raw.maxMessages)));
  }
  if (raw.attachmentMode === "fast" || raw.attachmentMode === "full") out.attachmentMode = raw.attachmentMode;
  if (typeof raw.analyzeForce === "boolean") out.analyzeForce = raw.analyzeForce;
  else if (raw.analyzeForce === "true") out.analyzeForce = true;
  else if (raw.analyzeForce === "false") out.analyzeForce = false;
  if (typeof raw.usageDays === "number" && !Number.isNaN(raw.usageDays)) {
    out.usageDays = Math.min(365, Math.max(1, Math.round(raw.usageDays)));
  }
  return out;
}

function readLegacyTodoAnalyzePrefs(): Partial<SavedTodoAnalyzePrefs> | null {
  const merged: Record<string, unknown> = {};
  try {
    const uiRaw = getItem(LEGACY_TODO_ANALYZE_UI_KEY);
    if (uiRaw) Object.assign(merged, JSON.parse(uiRaw) as Record<string, unknown>);
  } catch {
    /* ignore */
  }
  try {
    const modeRaw = getItem(LEGACY_TODO_ANALYZE_ATTACHMENT_KEY);
    if (modeRaw === "full" || modeRaw === "fast") merged.attachmentMode = modeRaw;
  } catch {
    /* ignore */
  }
  return Object.keys(merged).length > 0 ? normalizeTodoAnalyzePrefs(merged) : null;
}

function readTodoAnalyzePrefsFromNewKey(): SavedTodoAnalyzePrefs | null {
  const raw = getItem(SETTING_KEYS.todoAnalyzePrefs);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as unknown;
    if (p && typeof p === "object") return normalizeTodoAnalyzePrefs(p as Record<string, unknown>);
  } catch {
    /* ignore */
  }
  return null;
}

function readTodoAnalyzePrefsWithLegacyFallback(): SavedTodoAnalyzePrefs {
  const legacy = readLegacyTodoAnalyzePrefs();
  if (legacy) return { ...DEFAULT_TODO_ANALYZE_PREFS, ...legacy };
  try {
    const viewRaw = getItem(LEGACY_TODO_SUGGESTIONS_VIEW_KEY);
    if (viewRaw) {
      const v = JSON.parse(viewRaw) as Record<string, unknown>;
      if (typeof v.analyzeForce === "boolean") {
        return { ...DEFAULT_TODO_ANALYZE_PREFS, analyzeForce: v.analyzeForce };
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_TODO_ANALYZE_PREFS;
}

function persistTodoAnalyzePrefsFull(prefs: SavedTodoAnalyzePrefs): void {
  setItem(SETTING_KEYS.todoAnalyzePrefs, JSON.stringify(prefs));
}

export function getTodoAnalyzePrefs(): SavedTodoAnalyzePrefs {
  const stored = readTodoAnalyzePrefsFromNewKey();
  if (stored) return stored;

  const migrated = readTodoAnalyzePrefsWithLegacyFallback();
  const hasLegacy =
    readLegacyTodoAnalyzePrefs() != null ||
    (() => {
      try {
        const viewRaw = getItem(LEGACY_TODO_SUGGESTIONS_VIEW_KEY);
        if (!viewRaw) return false;
        const v = JSON.parse(viewRaw) as Record<string, unknown>;
        return typeof v.analyzeForce === "boolean";
      } catch {
        return false;
      }
    })();
  if (hasLegacy) persistTodoAnalyzePrefsFull(migrated);
  return migrated;
}

export function setTodoAnalyzePrefs(partial: Partial<SavedTodoAnalyzePrefs>): void {
  const current = readTodoAnalyzePrefsFromNewKey() ?? readTodoAnalyzePrefsWithLegacyFallback();
  persistTodoAnalyzePrefsFull({ ...current, ...partial });
}

export type ChatListViewType = "all" | "private" | "groups" | "archived";

export interface SavedChatViewFilter {
  chatListFilter: "all" | "waiting" | "unanswered";
  chatListFilterMinDays: number | null;
  showArchivedChats: boolean;
  hideGroupChats: boolean;
  /** What to show in the left chat list: all, only private, only groups, or only archived. */
  chatListView: ChatListViewType;
}

const DEFAULT_CHAT_VIEW_FILTER: SavedChatViewFilter = {
  chatListFilter: "all",
  chatListFilterMinDays: null,
  showArchivedChats: true,
  hideGroupChats: false,
  chatListView: "all",
};

export function getChatViewFilter(): SavedChatViewFilter {
  const raw = getItem(SETTING_KEYS.chatViewFilter);
  if (!raw) return DEFAULT_CHAT_VIEW_FILTER;
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return DEFAULT_CHAT_VIEW_FILTER;
    const x = p as Record<string, unknown>;
    const chatListFilter =
      x.chatListFilter === "waiting" || x.chatListFilter === "unanswered"
        ? x.chatListFilter
        : "all";
    const chatListFilterMinDays =
      typeof x.chatListFilterMinDays === "number" && x.chatListFilterMinDays >= 0
        ? x.chatListFilterMinDays
        : x.chatListFilterMinDays === null
          ? null
          : DEFAULT_CHAT_VIEW_FILTER.chatListFilterMinDays;
    const showArchivedChats =
      x.showArchivedChats === false ? false : (x.showArchivedChats === true || DEFAULT_CHAT_VIEW_FILTER.showArchivedChats);
    const hideGroupChats = x.hideGroupChats === true;
    const chatListView =
      x.chatListView === "private" || x.chatListView === "groups" || x.chatListView === "archived"
        ? x.chatListView
        : "all";
    return { chatListFilter, chatListFilterMinDays, showArchivedChats, hideGroupChats, chatListView };
  } catch {
    return DEFAULT_CHAT_VIEW_FILTER;
  }
}

export function setChatViewFilter(f: SavedChatViewFilter): void {
  setItem(
    SETTING_KEYS.chatViewFilter,
    JSON.stringify({
      chatListFilter: f.chatListFilter,
      chatListFilterMinDays: f.chatListFilterMinDays,
      showArchivedChats: f.showArchivedChats,
      hideGroupChats: f.hideGroupChats,
      chatListView: f.chatListView,
    })
  );
}

export interface SavedCrmViewFilter {
  activityFilter: string;
  activityFilterDays: number;
  accountFilterId: string;
  fupSort: string;
  search: string;
  brancheFilter: string;
}

const DEFAULT_CRM_VIEW_FILTER: SavedCrmViewFilter = {
  activityFilter: "all",
  activityFilterDays: 7,
  accountFilterId: "",
  fupSort: "default",
  search: "",
  brancheFilter: "",
};

export function getCrmViewFilter(): SavedCrmViewFilter {
  const raw = getItem(SETTING_KEYS.crmViewFilter);
  if (!raw) return DEFAULT_CRM_VIEW_FILTER;
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== "object") return DEFAULT_CRM_VIEW_FILTER;
    const x = p as Record<string, unknown>;
    return {
      activityFilter: typeof x.activityFilter === "string" ? x.activityFilter : DEFAULT_CRM_VIEW_FILTER.activityFilter,
      activityFilterDays:
        typeof x.activityFilterDays === "number" && x.activityFilterDays >= 1 && x.activityFilterDays <= 365
          ? x.activityFilterDays
          : DEFAULT_CRM_VIEW_FILTER.activityFilterDays,
      accountFilterId: typeof x.accountFilterId === "string" ? x.accountFilterId : "",
      fupSort: typeof x.fupSort === "string" ? x.fupSort : DEFAULT_CRM_VIEW_FILTER.fupSort,
      search: typeof x.search === "string" ? x.search : "",
      brancheFilter: typeof x.brancheFilter === "string" ? x.brancheFilter : "",
    };
  } catch {
    return DEFAULT_CRM_VIEW_FILTER;
  }
}

export function setCrmViewFilter(f: SavedCrmViewFilter): void {
  setItem(SETTING_KEYS.crmViewFilter, JSON.stringify(f));
}

/**
 * Preset for VA daily workflow:
 * - CRM: contacts where I have not written for at least 7 days, sorted by follow-up intensity.
 * - Chat: waiting chats from at least 1 day ago.
 */
export function applyFollowUpModePresets(): void {
  setCrmViewFilter({
    ...getCrmViewFilter(),
    activityFilter: "i_not_written_since",
    activityFilterDays: 7,
    fupSort: "fupDesc",
  });
  setChatViewFilter({
    ...getChatViewFilter(),
    chatListFilter: "waiting",
    chatListFilterMinDays: 1,
  });
}

const CRM_SIDEBAR_MESSAGE_PANEL_MIN_PX = 140;
const CRM_SIDEBAR_MESSAGE_PANEL_MAX_PX = 560;
const CRM_SIDEBAR_MESSAGE_PANEL_DEFAULT_PX = 260;
const CRM_SIDEBAR_WIDTH_MIN_PERCENT = 35;
const CRM_SIDEBAR_WIDTH_MAX_PERCENT = 75;
const CRM_SIDEBAR_WIDTH_DEFAULT_PERCENT = 50;

export function getCrmSidebarMessagePanelHeightPx(): number {
  const raw = getItem(SETTING_KEYS.crmSidebarMessagePanelHeightPx);
  const n = raw ? Number(raw) : NaN;
  if (Number.isNaN(n)) return CRM_SIDEBAR_MESSAGE_PANEL_DEFAULT_PX;
  return Math.max(
    CRM_SIDEBAR_MESSAGE_PANEL_MIN_PX,
    Math.min(CRM_SIDEBAR_MESSAGE_PANEL_MAX_PX, Math.round(n))
  );
}

export function setCrmSidebarMessagePanelHeightPx(value: number): void {
  const n = Math.max(
    CRM_SIDEBAR_MESSAGE_PANEL_MIN_PX,
    Math.min(CRM_SIDEBAR_MESSAGE_PANEL_MAX_PX, Math.round(value))
  );
  setItem(SETTING_KEYS.crmSidebarMessagePanelHeightPx, String(n));
}

export function getCrmSidebarWidthPercent(): number {
  const raw = getItem(SETTING_KEYS.crmSidebarWidthPercent);
  const n = raw ? Number(raw) : NaN;
  if (Number.isNaN(n)) return CRM_SIDEBAR_WIDTH_DEFAULT_PERCENT;
  return Math.max(
    CRM_SIDEBAR_WIDTH_MIN_PERCENT,
    Math.min(CRM_SIDEBAR_WIDTH_MAX_PERCENT, Math.round(n))
  );
}

export function setCrmSidebarWidthPercent(value: number): void {
  const n = Math.max(
    CRM_SIDEBAR_WIDTH_MIN_PERCENT,
    Math.min(CRM_SIDEBAR_WIDTH_MAX_PERCENT, Math.round(value))
  );
  setItem(SETTING_KEYS.crmSidebarWidthPercent, String(n));
}

export function getCrmFocusMode(): boolean {
  const v = getItem(SETTING_KEYS.crmFocusMode);
  return v === "true";
}

export function setCrmFocusMode(value: boolean): void {
  setItem(SETTING_KEYS.crmFocusMode, String(value));
}
