"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { useSettings } from "@/components/SettingsContext";
import type { OpenChatWith } from "@/lib/settings";
import type {
  BeeperAccount,
  BeeperChat,
  BeeperMessage,
  BeeperMessageAttachment,
  BeeperMessagesResponse,
  ContactAnalysis,
} from "@/lib/types";
import { getNetworkLabel } from "@/lib/types";
import { getAssetUrl } from "@/lib/asset-url";
import { SWR_CONFIG } from "@/lib/swr-config";
import { resolveBeeperMessagesBeforeCursor } from "@/lib/beeper-messages-cursor";
import { dispatchCrmAnalysisUpdated } from "@/lib/crm-analysis-sync";

function indexOfKeyboardKey(keys: readonly string[], key: string): number {
  return keys.indexOf(key);
}

function isImageAttachment(a: BeeperMessageAttachment): boolean {
  const t = (a.type ?? "").toLowerCase();
  return t === "img" || t === "image" || !!a.isSticker || !!a.isGif;
}

function isVideoAttachment(a: BeeperMessageAttachment): boolean {
  return (a.type ?? "").toLowerCase() === "video";
}

function isAudioAttachment(a: BeeperMessageAttachment): boolean {
  return (a.type ?? "").toLowerCase() === "audio";
}

function attachmentMediaUrl(a: BeeperMessageAttachment): string | undefined {
  return getAssetUrl(a.srcURL ?? a.id);
}

function attachmentRawUrl(a: BeeperMessageAttachment): string | undefined {
  const raw = a.srcURL ?? a.id;
  return raw && typeof raw === "string" ? raw : undefined;
}

function isFileAttachment(a: BeeperMessageAttachment): boolean {
  const t = (a.type ?? "").toLowerCase();
  return t !== "img" && t !== "image" && t !== "video" && t !== "audio";
}

function getAccountId(acc: BeeperAccount): string {
  return String((acc as { accountID?: string }).accountID ?? acc.id ?? "").trim();
}

async function fetchAccounts(): Promise<BeeperAccount[]> {
  const res = await fetch("/api/accounts");
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? "Accounts failed");
  const list = Array.isArray(data) ? data : (data as { items?: BeeperAccount[] }).items ?? [];
  return list;
}

const MIN_CHATS_TARGET = 50;

export interface TinderChatFilter {
  includePrivate: boolean;
  includeGroups: boolean;
  includeArchived: boolean;
}

const DEFAULT_TINDER_CHAT_FILTER: TinderChatFilter = {
  includePrivate: true,
  includeGroups: true,
  includeArchived: false,
};

function applyChatFilter(items: BeeperChat[], filter: TinderChatFilter): BeeperChat[] {
  let list = items.filter((c) => {
    const t = (c.type ?? "").toLowerCase();
    const isSingle = t === "single";
    const isGroup = t === "group";
    const isArchived = !!(c as BeeperChat & { isArchived?: boolean }).isArchived;
    if (!isSingle && !isGroup) return false;
    const typeMatch =
      (filter.includePrivate && isSingle) || (filter.includeGroups && isGroup);
    const archivedOnly =
      !filter.includePrivate && !filter.includeGroups && filter.includeArchived;
    const typeOk = typeMatch || (archivedOnly && (isSingle || isGroup));
    const archivedOk = filter.includeArchived
      ? archivedOnly
        ? isArchived
        : true
      : !isArchived;
    return typeOk && archivedOk;
  });
  list = list.filter((c) => {
    const last = c.lastMessage as { isSender?: boolean } | undefined;
    return last ? last.isSender !== true : false;
  });
  list.sort((a, b) => {
    const ta = a.lastActivity ?? (a.lastMessage as { timestamp?: string })?.timestamp ?? "";
    const tb = b.lastActivity ?? (b.lastMessage as { timestamp?: string })?.timestamp ?? "";
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
  return list;
}

type ChatsPageResponse = { items?: BeeperChat[]; hasMore?: boolean; oldestCursor?: string; nextCursor?: string };

async function fetchChatsForAccount(accountId: string, filter: TinderChatFilter): Promise<BeeperChat[]> {
  const allItems: BeeperChat[] = [];
  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore) {
    const url =
      cursor == null
        ? `/api/chats?accountIDs=${encodeURIComponent(accountId)}`
        : `/api/chats?accountIDs=${encodeURIComponent(accountId)}&cursor=${encodeURIComponent(cursor)}&direction=before`;
    const res = await fetch(url);
    const data = (await res.json()) as ChatsPageResponse;
    if (!res.ok) break;
    const items = data.items ?? [];
    allItems.push(...items);
    const nextCursor = data.oldestCursor ?? data.nextCursor ?? null;
    hasMore = (data.hasMore === true && nextCursor != null) || false;
    cursor = nextCursor;

    const filtered = applyChatFilter(allItems, filter);
    if (filtered.length >= MIN_CHATS_TARGET) break;
  }

  return applyChatFilter(allItems, filter);
}

const TINDER_PINK = "#FE3C72";
const TINDER_ORANGE = "#FF6B35";
const TINDER_PEACH = "#FF8E53";
/** Background gradient (restored) */
const GRADIENT_TOP = TINDER_PINK;
const GRADIENT_MID = TINDER_ORANGE;
const GRADIENT_BOTTOM = TINDER_PEACH;
/** Buttons: harmonious with gradient – white/light, soft borders */
const BTN_SUGGESTION_BG = "rgba(255,255,255,0.98)";
const BTN_SUGGESTION_BORDER = "rgba(255,255,255,0.85)";
const BTN_ARCHIVE_BG = "rgba(255,255,255,0.98)";
const BTN_ARCHIVE_BORDER = "rgba(255,255,255,0.85)";
const BTN_REMINDER_BG = "rgba(255,255,255,0.92)";
const BTN_REMINDER_BORDER = "rgba(255,255,255,0.7)";

const INITIAL_ANALYZE_COUNT = 50;
const BACKGROUND_BATCH_SIZE = 50;

/**
 * Run analyze-chat for all given chat IDs in parallel.
 * Returns analysis data (incl. nextMessageSuggestions) per chat so the client can populate SWR cache.
 */
async function runAnalyzeForChats(
  chatIds: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Array<{ chatId: string; data: ContactAnalysis | null }>> {
  const total = chatIds.length;
  let done = 0;
  const runOne = async (id: string): Promise<ContactAnalysis | null> => {
    try {
      const res = await fetch("/api/analyze-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: id, view: "tinder", source: "tinder-batch-prefetch" }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data as ContactAnalysis;
    } catch {
      return null;
    } finally {
      done += 1;
      onProgress?.(done, total);
    }
  };
  const allResults = await Promise.all(chatIds.map((id) => runOne(id)));
  if (allResults.some((r) => r != null)) {
    dispatchCrmAnalysisUpdated();
  }
  return chatIds.map((chatId, idx) => ({ chatId, data: allResults[idx] ?? null }));
}

/** Audio player + transcript (fetched via API; cache is warmed by analyze-chat). */
function AudioWithTranscript({
  att,
  autoPlay = false,
}: {
  att: BeeperMessageAttachment;
  autoPlay?: boolean;
}) {
  const playSrc = getAssetUrl(att.srcURL ?? att.id);
  const rawUrl = attachmentRawUrl(att);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!rawUrl);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!rawUrl) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/transcribe?url=${encodeURIComponent(rawUrl)}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(true);
          setLoading(false);
          return;
        }
        const data = await res.json();
        setTranscript(typeof data?.text === "string" ? data.text : "");
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawUrl]);

  if (!playSrc) {
    return (
      <p className="text-xs text-gray-500 mt-1">[Audio: {att.fileName ?? "—"}]</p>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1">
      <audio
        controls
        preload="metadata"
        autoPlay={autoPlay}
        className="max-w-full min-w-[160px] h-8"
      >
        <source src={playSrc} type={att.mimeType ?? "audio/mpeg"} />
      </audio>
      {rawUrl && (
        <div className="text-xs text-gray-600 border-l-2 border-amber-300 pl-2">
          {loading && "Wird transkribiert…"}
          {error && !loading && "Transkript nicht verfügbar"}
          {!loading && !error && transcript !== null && transcript !== "" && transcript}
        </div>
      )}
    </div>
  );
}

interface TinderChatViewProps {
  onOpenChat?: (chatId: string, accountId: string) => void;
}

const DEFAULT_PRIORITY = 5;

function isTypingInEditableElement(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = (el.tagName ?? "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return el.isContentEditable === true;
}

function KeyCap({ k }: { k: string }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-md border border-white/35 bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-gray-900 shadow-sm"
      aria-hidden="true"
    >
      {k}
    </span>
  );
}

function toThreeSentences(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const parts = normalized.match(/[^.!?]+[.!?]?/g) ?? [];
  const firstThree = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 3);
  return firstThree.join(" ").trim();
}

export function TinderChatView({ onOpenChat }: TinderChatViewProps) {
  const { settings } = useSettings();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [tinderChatFilterAll, setTinderChatFilterAll] = useState(true);
  const [tinderChatFilterPrivate, setTinderChatFilterPrivate] = useState(true);
  const [tinderChatFilterGroups, setTinderChatFilterGroups] = useState(true);
  const [tinderChatFilterArchived, setTinderChatFilterArchived] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [readyToStart, setReadyToStart] = useState(false);
  const [initialProgress, setInitialProgress] = useState<{ current: number; total: number } | null>(null);
  const [analyzedUntilIndex, setAnalyzedUntilIndex] = useState(0);
  const [priorityMap, setPriorityMap] = useState<Record<string, number>>({});
  const [manualMessage, setManualMessage] = useState("");
  const [rawMessages, setRawMessages] = useState<BeeperMessage[]>([]);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [messagesLoadingInitial, setMessagesLoadingInitial] = useState(false);
  const [messagesLoadingMore, setMessagesLoadingMore] = useState(false);
  const manualMessageRef = useRef<HTMLTextAreaElement | null>(null);
  const olderPagingAnchorRef = useRef<{ height: number; top: number } | null>(null);
  const initialAnalysisStartedRef = useRef(false);
  const backgroundAnalysisStartedRef = useRef(false);

  const { data: accounts = [], error: accountsError, isLoading: accountsLoading } = useSWR<BeeperAccount[]>(
    "tinder:accounts",
    fetchAccounts,
    SWR_CONFIG
  );
  const tinderChatFilter = useMemo((): TinderChatFilter => {
    if (tinderChatFilterAll) {
      return { includePrivate: true, includeGroups: true, includeArchived: false };
    }
    return {
      includePrivate: tinderChatFilterPrivate,
      includeGroups: tinderChatFilterGroups,
      includeArchived: tinderChatFilterArchived,
    };
  }, [tinderChatFilterAll, tinderChatFilterPrivate, tinderChatFilterGroups, tinderChatFilterArchived]);

  const tinderChatFilterKey = tinderChatFilterAll
    ? "all"
    : [tinderChatFilterPrivate, tinderChatFilterGroups, tinderChatFilterArchived].join(",");

  const { data: chats = [], isLoading: chatsLoading, mutate } = useSWR<BeeperChat[]>(
    selectedAccountId ? `tinder:chats:${selectedAccountId}:${tinderChatFilterKey}` : null,
    () => fetchChatsForAccount(selectedAccountId!, tinderChatFilter),
    SWR_CONFIG
  );

  /** Chats sorted by priority (10 first), then by lastActivity. Used for display and processing order. */
  const sortedChats = useMemo(() => {
    if (chats.length === 0) return [];
    return [...chats].sort((a, b) => {
      const pa = priorityMap[a.id] ?? DEFAULT_PRIORITY;
      const pb = priorityMap[b.id] ?? DEFAULT_PRIORITY;
      if (pb !== pa) return pb - pa;
      const ta = a.lastActivity ?? (a.lastMessage as { timestamp?: string })?.timestamp ?? "";
      const tb = b.lastActivity ?? (b.lastMessage as { timestamp?: string })?.timestamp ?? "";
      return new Date(tb).getTime() - new Date(ta).getTime();
    });
  }, [chats, priorityMap]);

  useEffect(() => {
    if (!selectedAccountId) {
      setReadyToStart(false);
      setInitialProgress(null);
      setAnalyzedUntilIndex(0);
      setPriorityMap({});
      initialAnalysisStartedRef.current = false;
      backgroundAnalysisStartedRef.current = false;
    }
  }, [selectedAccountId]);

  /** Load stored priorities when chats are available (e.g. on re-open). */
  useEffect(() => {
    if (chats.length === 0) return;
    const chatIds = chats.map((c) => c.id).filter(Boolean);
    if (chatIds.length === 0) return;
    fetch(`/api/tinder-priority?chatIds=${chatIds.map((id) => encodeURIComponent(id)).join(",")}`)
      .then((r) => (r.ok ? r.json() : { priorities: {} }))
      .then((data: { priorities?: Record<string, number> }) => {
        const p = data.priorities ?? {};
        setPriorityMap((prev) => ({ ...p, ...prev }));
      })
      .catch(() => {});
  }, [chats]);

  useEffect(() => {
    if (!selectedAccountId || sortedChats.length === 0 || readyToStart || initialAnalysisStartedRef.current) return;
    initialAnalysisStartedRef.current = true;
    const count = Math.min(INITIAL_ANALYZE_COUNT, sortedChats.length);
    const ids = sortedChats.slice(0, count).map((c) => c.id).filter(Boolean);
    setInitialProgress({ current: 0, total: count });
    (async () => {
      try {
        await fetch("/api/transcribe-chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatIds: ids }),
        });
        const results = await runAnalyzeForChats(ids, (current, total) =>
          setInitialProgress({ current, total })
        );
        results.forEach(({ chatId, data }) => {
          if (data) globalMutate(`tinder:analysis:${chatId}`, data);
        });
        const fromResults = Object.fromEntries(
          results
            .filter((r) => r.data?.priorityIndex != null)
            .map((r) => [r.chatId, r.data!.priorityIndex!])
        );
        if (Object.keys(fromResults).length > 0) {
          setPriorityMap((prev) => ({ ...prev, ...fromResults }));
        }
        setReadyToStart(true);
        setAnalyzedUntilIndex(count);
        setInitialProgress(null);
      } catch {
        setReadyToStart(true);
        setAnalyzedUntilIndex(count);
        setInitialProgress(null);
      }
    })();
  }, [selectedAccountId, sortedChats, readyToStart]);

  useEffect(() => {
    if (!readyToStart || sortedChats.length === 0) return;
    if (currentIndex < analyzedUntilIndex - 1 || analyzedUntilIndex >= sortedChats.length) return;
    const nextStart = analyzedUntilIndex;
    const nextEnd = Math.min(analyzedUntilIndex + BACKGROUND_BATCH_SIZE, sortedChats.length);
    if (nextStart >= nextEnd) return;
    if (backgroundAnalysisStartedRef.current) return;
    backgroundAnalysisStartedRef.current = true;
    const ids = sortedChats.slice(nextStart, nextEnd).map((c) => c.id).filter(Boolean);
    (async () => {
      try {
        await fetch("/api/transcribe-chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatIds: ids }),
        });
        const results = await runAnalyzeForChats(ids);
        results.forEach(({ chatId, data }) => {
          if (data) globalMutate(`tinder:analysis:${chatId}`, data);
        });
        const fromResults = Object.fromEntries(
          results
            .filter((r) => r.data?.priorityIndex != null)
            .map((r) => [r.chatId, r.data!.priorityIndex!])
        );
        if (Object.keys(fromResults).length > 0) {
          setPriorityMap((prev) => ({ ...prev, ...fromResults }));
        }
        setAnalyzedUntilIndex(nextEnd);
      } finally {
        backgroundAnalysisStartedRef.current = false;
      }
    })();
  }, [readyToStart, sortedChats, currentIndex, analyzedUntilIndex]);

  const currentChat = sortedChats[currentIndex];
  const chatId = currentChat?.id;
  const accountId = currentChat?.accountID ?? selectedAccountId ?? "";

  const { data: analysis, isLoading: analysisLoading } = useSWR<ContactAnalysis | null>(
    chatId ? `tinder:analysis:${chatId}` : null,
    chatId
      ? async () => {
          const getRes = await fetch(`/api/analyze-chat?chatId=${encodeURIComponent(chatId)}&view=tinder`);
          if (getRes.ok) return getRes.json() as Promise<ContactAnalysis>;
          if (getRes.status === 404) {
            const postRes = await fetch("/api/analyze-chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chatId, view: "tinder", source: "tinder-view-current-chat" }),
            });
            if (postRes.ok) return postRes.json() as Promise<ContactAnalysis>;
          }
          return null;
        }
      : null,
    { ...SWR_CONFIG, revalidateOnFocus: false, revalidateOnMount: true }
  );

  const fetchMessagesPage = useCallback(
    async (cid: string, cursor?: string | null) => {
      const params = new URLSearchParams();
      if (cursor) {
        params.set("cursor", cursor);
        params.set("direction", "before");
      }
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/chats/${encodeURIComponent(cid)}/messages${suffix}`);
      if (!res.ok) return { items: [] as BeeperMessage[], hasMore: false, nextCursor: null as string | null };
      const data = (await res.json()) as BeeperMessagesResponse;
      const items = Array.isArray(data.items) ? data.items : [];
      const nextCursor = resolveBeeperMessagesBeforeCursor({ ...data, items });
      return { items, hasMore: data.hasMore === true, nextCursor };
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    if (!chatId) {
      setRawMessages([]);
      setMessagesHasMore(false);
      setMessagesCursor(null);
      return;
    }
    const preloadTarget = Math.max(10, Math.min(300, settings.tinderMessagePreloadCount || 50));
    setMessagesLoadingInitial(true);
    (async () => {
      try {
        const seen = new Set<string>();
        let all: BeeperMessage[] = [];
        let cursor: string | null = null;
        let hasMore = true;
        while (hasMore && all.length < preloadTarget) {
          const page = await fetchMessagesPage(chatId, cursor);
          if (cancelled) return;
          const fresh = page.items.filter((m) => {
            if (!m?.id || seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
          });
          all = [...all, ...fresh];
          cursor = page.nextCursor;
          hasMore = page.hasMore && !!cursor;
          if (fresh.length === 0) break;
        }
        if (cancelled) return;
        setRawMessages(all);
        setMessagesHasMore(hasMore);
        setMessagesCursor(cursor);
      } finally {
        if (!cancelled) setMessagesLoadingInitial(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, fetchMessagesPage, settings.tinderMessagePreloadCount]);

  const loadOlderMessages = useCallback(async () => {
    if (!chatId || !messagesHasMore || !messagesCursor || messagesLoadingMore) return;
    const viewport = chatVerlaufRef.current;
    if (viewport) {
      olderPagingAnchorRef.current = { height: viewport.scrollHeight, top: viewport.scrollTop };
    }
    setMessagesLoadingMore(true);
    try {
      const page = await fetchMessagesPage(chatId, messagesCursor);
      setRawMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const merged = [...prev];
        for (const m of page.items) {
          if (m?.id && !seen.has(m.id)) {
            merged.push(m);
            seen.add(m.id);
          }
        }
        return merged;
      });
      setMessagesHasMore(page.hasMore && !!page.nextCursor);
      setMessagesCursor(page.nextCursor);
    } finally {
      setMessagesLoadingMore(false);
    }
  }, [chatId, fetchMessagesPage, messagesCursor, messagesHasMore, messagesLoadingMore]);
  const messages = useMemo(() => {
    const hasText = (m: BeeperMessage) => (m.text ?? "").trim().length > 0;
    const hasAttachments = (m: BeeperMessage) => (m.attachments ?? []).length > 0;
    const list = [...rawMessages].filter((m) => hasText(m) || hasAttachments(m));
    list.sort((a, b) => (new Date(a.timestamp ?? 0).getTime() - new Date(b.timestamp ?? 0).getTime()));
    return list;
  }, [rawMessages]);

  const chatVerlaufRef = useRef<HTMLDivElement>(null);
  const lastMessageRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (olderPagingAnchorRef.current && chatVerlaufRef.current) {
      const el = chatVerlaufRef.current;
      const anchor = olderPagingAnchorRef.current;
      el.scrollTop = el.scrollHeight - anchor.height + anchor.top;
      olderPagingAnchorRef.current = null;
      return;
    }
    if (messages.length === 0 || !chatId) return;
    const scrollToBottom = () => {
      const el = chatVerlaufRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    requestAnimationFrame(() => {
      scrollToBottom();
      requestAnimationFrame(() => scrollToBottom());
    });
    const t = setTimeout(scrollToBottom, 100);
    return () => clearTimeout(t);
  }, [chatId, messages.length]);

  type ReminderPresetItem = { id: string; label: string; type: "hours" | "days"; value: number; time?: string };
  const { data: reminderPresetsData } = useSWR<{ presets: ReminderPresetItem[] }>(
    "tinder:reminder-presets",
    () => fetch("/api/settings/reminder-presets").then((r) => r.json()),
    { ...SWR_CONFIG, revalidateOnFocus: false }
  );
  const reminderPresets = reminderPresetsData?.presets ?? [];
  const effectiveReminderPresets = useMemo<ReminderPresetItem[]>(
    () =>
      reminderPresets.length > 0
        ? reminderPresets
        : [
            { id: "1", label: "In 1 h", type: "hours", value: 1 },
            { id: "2", label: "Morgen 6:00", type: "days", value: 1, time: "06:00" },
            { id: "3", label: "In 7 Tagen 6:00", type: "days", value: 7, time: "06:00" },
          ],
    [reminderPresets]
  );

  const keyboardLayout = useMemo(() => {
    if (settings.tinderKeyboardLayout === "touch") {
      return {
        suggestionKeys: ["q", "w", "e", "r", "t"] as const,
        archiveKey: "a",
        openKey: "o",
        /** Logical keys for reminder slots; DE keyboard sends "ö" for same key as US ";" */
        reminderKeys: ["j", "k", "l", ";", "u", "i", "p", "n"] as const,
        reminderKeysDE: ["j", "k", "l", "ö", "u", "i", "p", "n"] as const,
        suggestionLabel: "Q/W/E/R/T",
        reminderLabel: "J/K/L/Ö …",
      };
    }
    return {
      suggestionKeys: ["1", "2", "3", "4", "5"] as const,
      archiveKey: "a",
      openKey: "o",
      reminderKeys: ["s", "d", "f", "g", "h", "j", "k", "l"] as const,
      reminderKeysDE: null as null,
      suggestionLabel: "1–5",
      reminderLabel: "S/D/F/…",
    };
  }, [settings.tinderKeyboardLayout]);

  /** AI-generated suggestions (from analysis). Normalize string[] or object[] with .text. Up to 5 in Tinder view. */
  const suggestions = useMemo(() => {
    const raw = analysis?.nextMessageSuggestions ?? [];
    return raw
      .map((s) => (typeof s === "string" ? s : (s as { text?: string })?.text))
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  }, [analysis]);

  const chatSummary3 = useMemo(() => {
    const raw = analysis?.summary;
    if (typeof raw !== "string") return "";
    return toThreeSentences(raw);
  }, [analysis?.summary]);

  const showFeedback = useCallback((message: string) => {
    setActionFeedback(message);
    const t = setTimeout(() => setActionFeedback(null), 2000);
    return () => clearTimeout(t);
  }, []);

  const openChatExplicit = useCallback(
    async (mode: OpenChatWith) => {
      if (!chatId || !accountId) return;
      if (mode === "client") {
        try {
          const res = await fetch("/api/focus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatID: chatId?.trim() || undefined }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error((data as { error?: string })?.error || res.statusText);
          }
          return;
        } catch {
          // Fallback to web open below.
        }
      }
      const params = new URLSearchParams();
      params.set("view", "chat");
      if (accountId?.trim()) params.set("account", accountId.trim());
      if (chatId?.trim()) params.set("chat", chatId.trim());
      const url = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [accountId, chatId]
  );

  const handleOpenChat = useCallback(async () => {
    if (!chatId || !accountId) return;
    if (onOpenChat) {
      onOpenChat(chatId, accountId);
      return;
    }
    await openChatExplicit(settings.openChatWith);
  }, [accountId, chatId, onOpenChat, openChatExplicit, settings.openChatWith]);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, sortedChats.length));
  }, [sortedChats.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(0, i - 1));
  }, []);

  const handleSendSuggestion = useCallback(
    async (text: string) => {
      if (!chatId || !text.trim()) return;
      setLoadingAction(true);
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim() }),
        });
        if (res.ok) {
          showFeedback("Gesendet!");
          goNext();
        } else {
          const d = await res.json().catch(() => ({}));
          showFeedback((d as { error?: string }).error ?? "Fehler");
        }
      } catch {
        showFeedback("Fehler beim Senden");
      } finally {
        setLoadingAction(false);
      }
    },
    [chatId, goNext, showFeedback]
  );

  const handleSendManualMessage = useCallback(async () => {
    const text = manualMessage.trim();
    if (!text) return;
    await handleSendSuggestion(text);
    setManualMessage("");
  }, [handleSendSuggestion, manualMessage]);

  useEffect(() => {
    setManualMessage("");
  }, [chatId]);

  useEffect(() => {
    const el = manualMessageRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 180;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [manualMessage]);

  const handleArchive = useCallback(async () => {
    if (!chatId) return;
    setLoadingAction(true);
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/archive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (res.ok) {
        showFeedback("Archiviert");
        goNext();
        mutate().then((newChats) => {
          const len = Array.isArray(newChats) ? newChats.length : 0;
          setCurrentIndex((i) => Math.min(i, Math.max(0, len - 1)));
        });
      } else {
        const d = await res.json().catch(() => ({}));
        showFeedback((d as { error?: string }).error ?? "Fehler");
      }
    } catch {
      showFeedback("Fehler");
    } finally {
      setLoadingAction(false);
    }
  }, [chatId, goNext, mutate, showFeedback]);

  const handleReminder = useCallback(
    async (preset: ReminderPresetItem) => {
      if (!chatId) return;
      setLoadingAction(true);
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/reminders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: preset.type,
            value: preset.value,
            time: preset.time,
          }),
        });
        if (res.ok) {
          showFeedback(`Reminder: ${preset.label}`);
          goNext();
        } else {
          const d = await res.json().catch(() => ({}));
          showFeedback((d as { error?: string }).error ?? "Fehler");
        }
      } catch {
        showFeedback("Fehler");
      } finally {
        setLoadingAction(false);
      }
    },
    [chatId, goNext, showFeedback]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingInEditableElement(e.target)) return;
      if (loadingAction) return;
      if (!readyToStart) return;
      if (!chatId) return;

      const key = (e.key ?? "").toLowerCase();

      const suggestionIdx = indexOfKeyboardKey(keyboardLayout.suggestionKeys, key);
      if (suggestionIdx !== -1) {
        const s = suggestions[suggestionIdx];
        if (!s) return;
        e.preventDefault();
        handleSendSuggestion(s);
        return;
      }

      if (key === keyboardLayout.archiveKey) {
        e.preventDefault();
        handleArchive();
        return;
      }

      if (key === keyboardLayout.openKey) {
        e.preventDefault();
        handleOpenChat();
        return;
      }

      if (key === "b" && currentIndex > 0) {
        e.preventDefault();
        goPrev();
        return;
      }

      let reminderIdx = indexOfKeyboardKey(keyboardLayout.reminderKeys, key);
      if (reminderIdx === -1 && keyboardLayout.reminderKeysDE) {
        reminderIdx = indexOfKeyboardKey(keyboardLayout.reminderKeysDE, key);
      }
      if (reminderIdx !== -1) {
        const preset = effectiveReminderPresets[reminderIdx];
        if (!preset) return;
        e.preventDefault();
        handleReminder(preset);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    chatId,
    currentIndex,
    effectiveReminderPresets,
    goPrev,
    handleArchive,
    handleOpenChat,
    handleReminder,
    handleSendSuggestion,
    keyboardLayout,
    loadingAction,
    readyToStart,
    suggestions,
  ]);

  const progress = sortedChats.length > 0 ? Math.round(((currentIndex + 1) / sortedChats.length) * 100) : 0;

  if (accountsError) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center px-6 text-white font-tinder"
        style={{ background: `linear-gradient(135deg, ${GRADIENT_TOP} 0%, ${TINDER_ORANGE} 100%)` }}
      >
        <h1 className="text-3xl font-bold mb-6">Tinder Chat</h1>
        <p className="text-lg">Accounts konnten nicht geladen werden.</p>
      </div>
    );
  }

  if (accountsLoading || accounts.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center px-6 text-white font-tinder"
        style={{ background: `linear-gradient(135deg, ${GRADIENT_TOP} 0%, ${TINDER_ORANGE} 100%)` }}
      >
        <h1 className="text-3xl font-bold mb-6">Tinder Chat</h1>
        {accountsLoading ? (
          <>
            <div className="h-12 w-12 animate-pulse rounded-full bg-white/30" />
            <p className="mt-4 text-lg">Lade Accounts…</p>
          </>
        ) : (
          <p className="text-lg">Keine Accounts gefunden.</p>
        )}
      </div>
    );
  }

  if (!selectedAccountId) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center px-6 text-white font-tinder overflow-auto py-8"
        style={{ background: `linear-gradient(135deg, ${GRADIENT_TOP} 0%, ${TINDER_ORANGE} 100%)` }}
      >
        <h1 className="text-3xl font-bold mb-6">Tinder Chat</h1>
        <p className="text-center text-xl font-semibold">Account auswählen</p>
        <p className="mt-2 text-center text-white/90">Wähle einen Account, um dessen Chats durchzugehen.</p>

        <p className="mt-6 mb-2 text-center text-sm font-medium text-white/90">Welche Chats?</p>
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          <button
            type="button"
            onClick={() => {
              setTinderChatFilterAll(true);
              setTinderChatFilterPrivate(true);
              setTinderChatFilterGroups(true);
              setTinderChatFilterArchived(false);
            }}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 shadow-md active:scale-[0.98] ${
              tinderChatFilterAll
                ? "bg-white text-gray-900"
                : "bg-white/20 text-white border-2 border-white/50 hover:bg-white/30"
            }`}
          >
            Alle
          </button>
          <button
            type="button"
            onClick={() => {
              setTinderChatFilterAll(false);
              setTinderChatFilterPrivate(!tinderChatFilterPrivate);
            }}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 shadow-md active:scale-[0.98] ${
              !tinderChatFilterAll && tinderChatFilterPrivate
                ? "bg-white text-gray-900"
                : "bg-white/20 text-white border-2 border-white/50 hover:bg-white/30"
            }`}
          >
            Privat Chat
          </button>
          <button
            type="button"
            onClick={() => {
              setTinderChatFilterAll(false);
              setTinderChatFilterGroups(!tinderChatFilterGroups);
            }}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 shadow-md active:scale-[0.98] ${
              !tinderChatFilterAll && tinderChatFilterGroups
                ? "bg-white text-gray-900"
                : "bg-white/20 text-white border-2 border-white/50 hover:bg-white/30"
            }`}
          >
            Gruppen
          </button>
          <button
            type="button"
            title="Archivierte Chats (z. B. für Follow-ups)"
            onClick={() => {
              setTinderChatFilterAll(false);
              setTinderChatFilterArchived(!tinderChatFilterArchived);
            }}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200 shadow-md active:scale-[0.98] ${
              !tinderChatFilterAll && tinderChatFilterArchived
                ? "bg-white text-gray-900"
                : "bg-white/20 text-white border-2 border-white/50 hover:bg-white/30"
            }`}
          >
            Archivierte
          </button>
        </div>

        <ul className="mt-4 w-full max-w-sm space-y-3">
          {accounts.map((acc) => {
            const a = acc as BeeperAccount;
            const accId = getAccountId(a);
            const name = a.user?.name ?? a.user?.fullName ?? accId ?? "Account";
            const label = getNetworkLabel(a.network);
            if (!accId) return null;
            return (
              <li key={accId}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAccountId(accId);
                    setCurrentIndex(0);
                  }}
                  className="w-full rounded-2xl bg-white/95 py-4 px-5 text-left font-medium text-gray-900 shadow-lg transition-transform active:scale-[0.98] hover:bg-white"
                >
                  <span className="block text-sm font-normal text-gray-500">{label}</span>
                  <span className="mt-0.5 block truncate">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (chatsLoading) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center px-6 text-white font-tinder"
        style={{ background: `linear-gradient(135deg, ${GRADIENT_TOP} 0%, ${TINDER_ORANGE} 100%)` }}
      >
        <h1 className="text-3xl font-bold mb-6">Tinder Chat</h1>
        <div className="h-12 w-12 animate-pulse rounded-full bg-white/30" />
        <p className="mt-4 text-lg">Lade Chats…</p>
      </div>
    );
  }

  if (sortedChats.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center px-6 text-white font-tinder"
        style={{ background: `linear-gradient(135deg, ${GRADIENT_TOP} 0%, ${TINDER_ORANGE} 100%)` }}
      >
        <h1 className="text-3xl font-bold mb-6">Tinder Chat</h1>
        <p className="text-center text-xl font-semibold">Keine Chats im Posteingang</p>
        <p className="mt-2 text-center text-white/90">Archivierte Chats werden hier nicht angezeigt.</p>
      </div>
    );
  }

  if (!readyToStart && initialProgress !== null) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center px-6 text-white font-tinder"
        style={{ background: `linear-gradient(135deg, ${GRADIENT_TOP} 0%, ${TINDER_ORANGE} 100%)` }}
      >
        <h1 className="text-3xl font-bold mb-6">Tinder Chat</h1>
        <p className="text-center text-xl font-semibold">Analysiere Chats…</p>
        <p className="mt-2 text-center text-white/90">
          {initialProgress.current} / {initialProgress.total} (inkl. Sprachnachrichten)
        </p>
        <div className="mt-6 w-full max-w-xs h-2 bg-white/20 rounded-full overflow-hidden">
          <div
            className="h-full bg-white/90 rounded-full transition-all duration-300"
            style={{
              width: `${initialProgress.total ? (100 * initialProgress.current) / initialProgress.total : 0}%`,
            }}
          />
        </div>
        <p className="mt-4 text-sm text-white/80">Danach geht es los.</p>
        <p className="mt-1 text-sm text-white/70">Das kann 1–2 Minuten dauern.</p>
        <p className="mt-3 text-sm text-white/80">Hol dir in der Zeit einen Kaffee oder Wasser ☕🥤</p>
      </div>
    );
  }

  if (!currentChat) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center px-6 text-white font-tinder"
        style={{ background: `linear-gradient(135deg, ${GRADIENT_TOP} 0%, ${TINDER_ORANGE} 100%)` }}
      >
        <h1 className="text-3xl font-bold mb-6">Tinder Chat</h1>
        <p className="text-xl font-semibold">Fertig für jetzt</p>
        <p className="mt-2 text-white/90">Alle Chats durchgegangen.</p>
        <button
          type="button"
          onClick={() => setCurrentIndex(0)}
          className="mt-6 rounded-full bg-white px-8 py-3 font-semibold text-gray-900 shadow-lg"
        >
          Von vorne
        </button>
      </div>
    );
  }

  const acc = accounts.find((a) => a.id === currentChat.accountID) as BeeperAccount | undefined;
  const network = acc?.network ?? "";

  return (
    <div
      className="flex h-full flex-col"
      style={{ background: `linear-gradient(180deg, ${GRADIENT_TOP} 0%, ${GRADIENT_MID} 50%, ${GRADIENT_BOTTOM} 100%)` }}
    >
      {/* Progress bar */}
      <div className="shrink-0 px-2 pt-2">
        <div className="h-1 bg-black/10">
          <div
            className="h-full bg-white/80 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-3 py-4 min-h-0 w-full max-w-5xl mx-auto">
        {/* Card: left = chat, right = controls (stack on small screens) */}
        <div
          className="flex flex-col md:flex-row w-full max-w-5xl max-h-[85vh] rounded-3xl bg-white shadow-2xl overflow-hidden min-h-0 md:min-h-[70vh]"
          style={{ boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)" }}
        >
          {/* Left: Chat */}
          <div className="flex flex-col flex-1 min-h-0 min-w-0 p-3 sm:p-4 border-b md:border-b-0 md:border-r border-gray-200">
            <div className="flex items-center gap-3 shrink-0">
              {currentIndex > 0 && (
                <button
                  type="button"
                  onClick={goPrev}
                  title="Zurück zum letzten Chat (B)"
                  className="shrink-0 rounded-full p-2 text-gray-600 hover:bg-gray-100 transition-colors"
                  aria-label="Zurück zum letzten Chat"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              {getAssetUrl(currentChat.image) ? (
                <img
                  src={getAssetUrl(currentChat.image)!}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full object-cover bg-gray-200"
                />
              ) : (
                <div
                  className="h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-lg font-bold text-white"
                  style={{ background: `linear-gradient(135deg, ${TINDER_PEACH}, ${TINDER_ORANGE})` }}
                >
                  {(currentChat.name ?? "?").charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold text-gray-900">
                  {currentChat.name ?? "Unbekannt"}
                </h2>
                <p className="text-xs text-gray-500">{getNetworkLabel(network)}</p>
              </div>
            </div>
            <div className="mt-2 rounded-xl bg-gray-50 p-2 sm:p-3 flex-1 min-h-0 flex flex-col">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1 shrink-0">Chat-Verlauf</p>
              <div className="mb-2 shrink-0">
                <button
                  type="button"
                  disabled={!messagesHasMore || messagesLoadingMore || messagesLoadingInitial}
                  onClick={() => void loadOlderMessages()}
                  className="w-full rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-gray-700 shadow-sm transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {messagesLoadingInitial
                    ? "Nachrichten werden geladen…"
                    : messagesLoadingMore
                      ? "Aeltere Nachrichten werden geladen…"
                      : messagesHasMore
                        ? "Aeltere Nachrichten laden"
                        : "Keine aelteren Nachrichten"}
                </button>
              </div>
              <div ref={chatVerlaufRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1 scrollbar-hide">
                {messages.length === 0 ? (
                  <p className="text-sm text-gray-500 italic">Keine Nachrichten geladen.</p>
                ) : (
                  messages.map((m: BeeperMessage, msgIndex: number) => {
                    const type = (m.type ?? "TEXT").toUpperCase();
                    const attachments = m.attachments ?? [];
                    const imageAttachments = attachments.filter(isImageAttachment);
                    const hasImages =
                      imageAttachments.length > 0 || (type === "IMAGE" && attachments.length > 0);
                    const imagesToShow = hasImages
                      ? imageAttachments.length > 0
                        ? imageAttachments
                        : type === "IMAGE"
                          ? attachments.slice(0, 1)
                          : []
                      : [];
                    const videoAttachments = attachments.filter(isVideoAttachment);
                    const audioAttachments = attachments.filter(isAudioAttachment);
                    const fileAttachments = attachments.filter(isFileAttachment);
                    const isLastMessage = msgIndex === messages.length - 1;

                    return (
                      <div
                        key={m.id}
                        ref={isLastMessage ? lastMessageRef : undefined}
                        className={`rounded-lg px-2.5 py-1.5 text-xs max-w-full ${
                          m.isSender
                            ? "bg-slate-100 ml-3 sm:ml-4 text-gray-900"
                            : "bg-gray-200 mr-3 sm:mr-4 text-gray-800"
                        }`}
                      >
                        {!m.isSender && (
                          <p className="text-[10px] font-medium text-gray-500 mb-0.5">{m.senderName ?? "Kontakt"}</p>
                        )}
                        {(m.text ?? "").trim() && (
                          <p className="whitespace-pre-wrap break-words">{m.text?.trim()}</p>
                        )}
                        {imagesToShow.map((att) => {
                          const src = attachmentMediaUrl(att);
                          if (!src) {
                            return (
                              <p key={att.id ?? "img"} className="text-xs text-gray-500 mt-1">
                                [Bild: {att.fileName ?? "—"}]
                              </p>
                            );
                          }
                          const isSticker = att.isSticker ?? type === "STICKER";
                          return (
                            <a
                              key={att.id ?? "img"}
                              href={src}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 block overflow-hidden rounded-md"
                            >
                              <img
                                src={src}
                                alt={att.fileName ?? "Image"}
                                className={
                                  isSticker
                                    ? "max-h-20 max-w-full object-contain"
                                    : "max-h-36 max-w-full object-contain"
                                }
                              />
                            </a>
                          );
                        })}
                        {videoAttachments.map((att) => {
                          const src = attachmentMediaUrl(att);
                          const posterSrc = att.posterImg ? getAssetUrl(att.posterImg) : undefined;
                          if (!src) {
                            return (
                              <p key={att.id ?? "vid"} className="text-xs text-gray-500 mt-1">
                                [Video: {att.fileName ?? "—"}]
                              </p>
                            );
                          }
                          return (
                            <div key={att.id ?? "vid"} className="mt-1 overflow-hidden rounded-md">
                              <video
                                controls
                                preload="metadata"
                                poster={posterSrc}
                                className="max-h-36 max-w-full"
                                title={att.fileName ?? "Video"}
                              >
                                <source src={src} type={att.mimeType ?? "video/mp4"} />
                              </video>
                              {att.duration != null && (
                                <span className="text-[10px] text-gray-500">
                                  {Math.floor(att.duration / 60)}:
                                  {(att.duration % 60).toString().padStart(2, "0")}
                                </span>
                              )}
                            </div>
                          );
                        })}
                        {type === "VIDEO" && videoAttachments.length === 0 && attachments.length > 0 && (() => {
                          const att = attachments[0];
                          const src = attachmentMediaUrl(att);
                          if (!src) return null;
                          const posterSrc = att.posterImg ? getAssetUrl(att.posterImg) : undefined;
                          return (
                            <div key={`${att.id}-vid`} className="mt-1 overflow-hidden rounded-md">
                              <video
                                controls
                                preload="metadata"
                                poster={posterSrc}
                                className="max-h-36 max-w-full"
                                title={att.fileName ?? "Video"}
                              >
                                <source src={src} type={att.mimeType ?? "video/mp4"} />
                              </video>
                            </div>
                          );
                        })()}
                        {audioAttachments.map((att, attIndex) => (
                          <AudioWithTranscript
                            key={att.id ?? attIndex}
                            att={att}
                            autoPlay={
                              isLastMessage &&
                              audioAttachments.length > 0 &&
                              attIndex === audioAttachments.length - 1
                            }
                          />
                        ))}
                        {(type === "VOICE" || type === "AUDIO") &&
                          audioAttachments.length === 0 &&
                          attachments.length > 0 && (
                            <AudioWithTranscript
                              key={`${attachments[0].id}-aud`}
                              att={attachments[0]}
                            />
                          )}
                        {fileAttachments.map((att) => {
                          const src = attachmentMediaUrl(att);
                          const label = att.fileName ?? att.type ?? "Anhang";
                          if (!src) {
                            return (
                              <p key={att.id ?? "file"} className="text-xs text-gray-500 mt-1">
                                [Datei: {label}]
                              </p>
                            );
                          }
                          return (
                            <a
                              key={att.id ?? "file"}
                              href={src}
                              target="_blank"
                              rel="noopener noreferrer"
                              download={att.fileName}
                              className="mt-1 block text-xs text-gray-700 underline break-all"
                            >
                              📎 {label}
                            </a>
                          );
                        })}
                        {m.timestamp && (
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            {new Date(m.timestamp).toLocaleString("de-DE", {
                              day: "2-digit",
                              month: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-col gap-2 shrink-0">
              <textarea
                ref={manualMessageRef}
                value={manualMessage}
                onChange={(e) => setManualMessage(e.target.value)}
                placeholder="Eigene Nachricht tippen…"
                rows={1}
                disabled={loadingAction}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.shiftKey) {
                    e.preventDefault();
                    void handleSendManualMessage();
                  }
                }}
                className="w-full resize-none rounded-xl border-2 border-white/70 bg-white/95 px-3 py-2 text-xs text-gray-900 shadow-md focus:border-white focus:outline-none focus:ring-2 focus:ring-pink-200 disabled:opacity-60 min-h-[72px]"
              />
              <button
                type="button"
                disabled={loadingAction || !manualMessage.trim()}
                onClick={() => void handleSendManualMessage()}
                className="w-full rounded-xl border-2 py-2.5 text-sm font-semibold text-gray-900 shadow-md transition-transform active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: BTN_SUGGESTION_BG, borderColor: BTN_SUGGESTION_BORDER }}
                title="Senden und zum nächsten Chat (Shift+Enter)"
              >
                Senden und nächster Chat (Shift+Enter)
              </button>
            </div>
          </div>

          {/* Right: only Antwortvorschläge, then Chat öffnen (inside card) */}
          <div className="flex flex-col w-full md:w-72 lg:w-80 shrink-0 p-4 gap-3 overflow-y-auto scrollbar-hide bg-gray-50/50 border-t md:border-t-0 md:border-l border-gray-200">
            <div className="flex-1 min-h-4" />

            {/* KI-Zusammenfassung */}
            <div className="rounded-2xl border border-white/40 bg-white/70 px-4 py-3 shadow-sm backdrop-blur">
              <p className="text-[11px] font-semibold tracking-wide text-gray-700">Chat-Zusammenfassung (KI)</p>
              {analysisLoading && !chatSummary3 ? (
                <div className="mt-2 flex justify-center py-1">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                </div>
              ) : chatSummary3 ? (
                <p className="mt-2 text-xs leading-relaxed text-gray-700">{chatSummary3}</p>
              ) : (
                <p className="mt-2 text-xs text-gray-500">Noch keine Zusammenfassung vorhanden.</p>
              )}
            </div>

            {/* Antwortvorschläge */}
            <div className="flex flex-col gap-2 shrink-0">
              <p className="text-xs font-medium text-gray-600">
                {analysisLoading && suggestions.length === 0
                  ? "KI-Vorschläge werden erstellt…"
                  : "Antwortvorschläge"}
              </p>
              {analysisLoading && suggestions.length === 0 && (
                <div className="flex justify-center py-2">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                </div>
              )}
              {!analysisLoading && suggestions.length === 0 && (
                <p className="text-xs text-gray-500 py-1">Keine KI-Vorschläge.</p>
              )}
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={loadingAction}
                  onClick={() => handleSendSuggestion(s)}
                  className="w-full rounded-xl py-2.5 px-3 text-left text-xs font-normal text-gray-900 shadow-md transition-transform active:scale-[0.98] disabled:opacity-60 whitespace-normal break-words border-2"
                  style={{ backgroundColor: BTN_SUGGESTION_BG, borderColor: BTN_SUGGESTION_BORDER, borderWidth: 2 }}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Chat öffnen unter den Vorschlägen */}
            <div className="flex flex-col gap-2 shrink-0">
              <button
                type="button"
                onClick={handleOpenChat}
                className="w-full rounded-xl border-2 py-2.5 text-sm font-medium text-gray-800 transition-opacity hover:bg-white/80"
                style={{ backgroundColor: BTN_SUGGESTION_BG, borderColor: BTN_SUGGESTION_BORDER }}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <KeyCap k={keyboardLayout.openKey.toUpperCase()} />
                  Chat öffnen
                </span>
              </button>
              <button
                type="button"
                onClick={() => openChatExplicit(settings.openChatWith === "client" ? "browser" : "client")}
                className="w-full rounded-xl border-2 py-2.5 text-xs font-semibold text-gray-800 transition-opacity hover:bg-white/80"
                style={{ backgroundColor: "rgba(255,255,255,0.88)", borderColor: "rgba(255,255,255,0.55)" }}
                title={settings.openChatWith === "client" ? "Alternativ im Browser öffnen" : "Alternativ im Client öffnen"}
              >
                {settings.openChatWith === "client" ? "Alternativ im Browser öffnen" : "Alternativ im Client öffnen"}
              </button>
            </div>
          </div>
        </div>

        {/* Action buttons outside card, below */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 w-full max-w-5xl mt-3 px-1 justify-center items-stretch sm:items-center">
          <button
            type="button"
            disabled={loadingAction}
            onClick={handleArchive}
            title="Chat archivieren"
            className="w-full sm:w-44 rounded-xl py-2.5 px-4 text-xs font-semibold text-gray-900 shadow-md transition-transform active:scale-[0.98] disabled:opacity-60 border-2 shrink-0"
            style={{ backgroundColor: BTN_ARCHIVE_BG, borderColor: BTN_ARCHIVE_BORDER }}
          >
            <span className="inline-flex items-center gap-2">
              <KeyCap k={keyboardLayout.archiveKey.toUpperCase()} />
              Archivieren
            </span>
          </button>
          <div className="flex flex-wrap gap-2 justify-center">
            {reminderPresets.length > 0 ? (
              reminderPresets.map((p, idx) => {
                const kk = (keyboardLayout.reminderKeysDE?.[idx] ?? keyboardLayout.reminderKeys[idx] ?? "").toUpperCase();
                return (
                <button
                  key={p.id}
                  type="button"
                  disabled={loadingAction}
                  onClick={() => handleReminder(p)}
                    className="w-full sm:w-44 rounded-xl py-2 px-3 text-xs font-semibold text-gray-900 shadow-md transition-transform active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: BTN_REMINDER_BG, border: `1px solid ${BTN_REMINDER_BORDER}` }}
                >
                  <span className="inline-flex items-center gap-2">
                    {kk ? <KeyCap k={kk} /> : null}
                    {p.label}
                  </span>
                </button>
                );
              })
            ) : (
              <>
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={() => handleReminder({ id: "1", label: "In 1 h", type: "hours", value: 1 })}
                  className="w-full sm:w-44 rounded-xl py-2 px-3 text-xs font-semibold text-gray-900 shadow-md transition-transform active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: BTN_REMINDER_BG, border: `1px solid ${BTN_REMINDER_BORDER}` }}
                >
                  <span className="inline-flex items-center gap-2">
                    <KeyCap k={(keyboardLayout.reminderKeysDE?.[0] ?? keyboardLayout.reminderKeys[0] ?? "S").toUpperCase()} />
                    In 1 h
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={() => handleReminder({ id: "2", label: "Morgen 6:00", type: "days", value: 1, time: "06:00" })}
                  className="w-full sm:w-44 rounded-xl py-2 px-3 text-xs font-semibold text-gray-900 shadow-md transition-transform active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: BTN_REMINDER_BG, border: `1px solid ${BTN_REMINDER_BORDER}` }}
                >
                  <span className="inline-flex items-center gap-2">
                    <KeyCap k={(keyboardLayout.reminderKeysDE?.[1] ?? keyboardLayout.reminderKeys[1] ?? "D").toUpperCase()} />
                    Morgen 6:00
                  </span>
                </button>
                <button
                  type="button"
                  disabled={loadingAction}
                  onClick={() => handleReminder({ id: "3", label: "In 7 Tagen 6:00", type: "days", value: 7, time: "06:00" })}
                  className="w-full sm:w-44 rounded-xl py-2 px-3 text-xs font-semibold text-gray-900 shadow-md transition-transform active:scale-[0.98] disabled:opacity-60"
                  style={{ backgroundColor: BTN_REMINDER_BG, border: `1px solid ${BTN_REMINDER_BORDER}` }}
                >
                  <span className="inline-flex items-center gap-2">
                    <KeyCap k={(keyboardLayout.reminderKeysDE?.[2] ?? keyboardLayout.reminderKeys[2] ?? "F").toUpperCase()} />
                    In 7 Tagen 6:00
                  </span>
                </button>
              </>
            )}
          </div>
        </div>

        {actionFeedback && (
          <p
            className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-6 py-2 text-sm font-medium text-white"
            role="status"
          >
            {actionFeedback}
          </p>
        )}

        <p className="mt-6 text-center text-sm text-white/80">
          {currentIndex + 1} / {sortedChats.length}
        </p>
      </div>
    </div>
  );
}
