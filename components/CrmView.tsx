"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import useSWR from "swr";
import type { BeeperAccount, BeeperChat } from "@/lib/types";
import type { ContactAnalysis } from "@/lib/types";
import { getNetworkLabel, CRM_STAGES, type CrmStage } from "@/lib/types";
import { getAssetUrl } from "@/lib/asset-url";
import {
  getContacts,
  getContactByChatId,
  removeChatFromContact,
  updateContact,
  type CrmContact,
} from "@/lib/contacts";
import { getAutoStageFromAnalysis } from "@/lib/keyword-rules";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import {
  getCrmViewFilter,
  setCrmViewFilter,
  getCrmSidebarMessagePanelHeightPx,
  setCrmSidebarMessagePanelHeightPx,
  getCrmSidebarWidthPercent,
  setCrmSidebarWidthPercent,
  getCrmFocusMode,
  setCrmFocusMode,
} from "@/lib/settings";
import { jsonFetcher, SWR_CONFIG } from "@/lib/swr-config";
import { CrmMiniChatView } from "./CrmMiniChatView";

interface CrmViewProps {
  focusChatId: string | null;
  initialContactId?: string | null;
  onOpenChat: (chatId: string, accountId: string) => void;
  onOpenChatWithPreference?: (chatId: string, accountId: string) => void;
  onContactSelect?: (contactId: string | null) => void;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    if (sameDay)
      return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Relative time in German for "last contact" badge: "gerade eben", "vor 2 Tagen", etc. */
function formatRelativeTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    const diffH = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);
    const diffWeeks = Math.floor(diffDays / 7);
    if (diffMin < 1) return "gerade eben";
    if (diffMin < 60) return `vor ${diffMin} Min.`;
    if (diffH < 24) return `vor ${diffH} Std.`;
    if (diffDays === 1) return "vor 1 Tag";
    if (diffDays < 7) return `vor ${diffDays} Tagen`;
    if (diffWeeks === 1) return "vor 1 Woche";
    if (diffWeeks < 5) return `vor ${diffWeeks} Wochen`;
    const diffMonths = Math.floor(diffDays / 30);
    if (diffMonths === 1) return "vor 1 Monat";
    return `vor ${diffMonths} Monaten`;
  } catch {
    return "";
  }
}

function formatKaufkraftValue(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return /^(10|[1-9])$/.test(trimmed) ? `${trimmed}/10` : trimmed;
}

async function fetchAccountsAndChats(): Promise<{ accounts: BeeperAccount[]; chats: BeeperChat[] }> {
  const normalizeBeeperAccountFromApi = (acc: BeeperAccount): BeeperAccount => {
    const normalizedId = String(acc.accountID ?? acc.id ?? "").trim();
    return {
      ...acc,
      id: normalizedId,
      accountID: normalizedId,
    };
  };

  const accountsRes = await fetch("/api/accounts");
  const accountsData = await accountsRes.json();
  if (!accountsRes.ok)
    throw new Error((accountsData as { error?: string })?.error ?? "Accounts failed");
  const accountListRaw = Array.isArray(accountsData)
    ? accountsData
    : (accountsData as { items?: BeeperAccount[] }).items ?? [];
  const accountList = accountListRaw
    .map((acc) => normalizeBeeperAccountFromApi(acc as BeeperAccount))
    .filter((acc) => acc.id.length > 0);

  const fetchAllChatsForAccount = async (accountId: string): Promise<BeeperChat[]> => {
    const collected: BeeperChat[] = [];
    let cursor: string | null = null;
    for (;;) {
      const params = new URLSearchParams();
      params.set("accountIDs", accountId);
      if (cursor) {
        params.set("cursor", cursor);
        params.set("direction", "before");
      }
      const res = await fetch(`/api/chats?${params.toString()}`);
      const data = (await res.json()) as {
        items?: BeeperChat[];
        hasMore?: boolean;
        nextCursor?: string;
        oldestCursor?: string;
      };
      if (!res.ok) break;
      const items = Array.isArray(data.items) ? data.items : [];
      if (items.length === 0) break;
      collected.push(...items);
      const next = data.oldestCursor ?? data.nextCursor ?? null;
      if (!data.hasMore || !next) break;
      cursor = next;
    }
    return collected;
  };

  const allChats: BeeperChat[] = [];
  await Promise.all(
    accountList.map(async (acc: BeeperAccount) => {
      const chatsForAccount = await fetchAllChatsForAccount(acc.id);
      if (chatsForAccount.length > 0) allChats.push(...chatsForAccount);
    })
  );
  const dedupedById = new Map<string, BeeperChat>();
  for (const chat of allChats) {
    if (chat.id) dedupedById.set(chat.id, chat);
  }
  const mergedChats = Array.from(dedupedById.values());
  mergedChats.sort((a, b) => {
    const ta = a.lastActivity ?? (a.lastMessage as { timestamp?: string })?.timestamp ?? "";
    const tb = b.lastActivity ?? (b.lastMessage as { timestamp?: string })?.timestamp ?? "";
    return new Date(tb).getTime() - new Date(ta).getTime();
  });
  return { accounts: accountList, chats: mergedChats };
}

export type LastActivityMap = Record<
  string,
  { lastFromMe: string | null; lastFromThem: string | null; followUpCount?: number }
>;

export type ContactActivityFilter =
  | "all"
  | "i_not_written_since"
  | "they_not_written_since"
  | "they_wrote_last";

function createRequestId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface LastActivityFetchOptions {
  forceRefresh?: boolean;
  requestId?: string;
  source?: string;
}

async function fetchLastActivityMap(
  chatIds: string[],
  options: LastActivityFetchOptions = {}
): Promise<LastActivityMap> {
  if (chatIds.length === 0) return {};
  const res = await fetch("/api/crm/last-activity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      chatIds,
      refresh: options.forceRefresh === true,
      requestId: options.requestId,
      source: options.source,
    }),
  });
  const payload = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : `last-activity failed (${res.status})`;
    throw new Error(err);
  }
  if (!payload || typeof payload !== "object") return {};
  return payload as LastActivityMap;
}

function deriveLastContactFromMessages(
  items: Array<{ timestamp?: string; isSender?: boolean }>
): { lastFromMe: string | null; lastFromThem: string | null } {
  let lastFromMe: string | null = null;
  let lastFromThem: string | null = null;
  for (const msg of items) {
    const ts = msg.timestamp;
    if (!ts) continue;
    if (msg.isSender) {
      if (!lastFromMe || new Date(ts) > new Date(lastFromMe)) lastFromMe = ts;
    } else {
      if (!lastFromThem || new Date(ts) > new Date(lastFromThem)) lastFromThem = ts;
    }
  }
  return { lastFromMe, lastFromThem };
}

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  try {
    return (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
  } catch {
    return null;
  }
}

function contactMatchesActivityFilter(
  contact: CrmContact,
  filter: ContactActivityFilter,
  filterDays: number,
  chatById: (id: string) => BeeperChat | undefined,
  lastActivityByChatId: LastActivityMap
): boolean {
  if (filter === "all") return true;
  const meta = getContactDisplayMeta(contact, chatById, lastActivityByChatId);
  const meDays = daysAgo(meta.lastFromMe);
  const themDays = daysAgo(meta.lastFromThem);
  if (filter === "i_not_written_since") {
    return meDays !== null && meDays >= filterDays;
  }
  if (filter === "they_not_written_since") {
    return themDays !== null && themDays >= filterDays;
  }
  if (filter === "they_wrote_last") {
    if (meta.lastFromMe == null && meta.lastFromThem == null) return false;
    if (meta.lastFromThem == null) return false;
    if (meta.lastFromMe == null) return true;
    return new Date(meta.lastFromThem) > new Date(meta.lastFromMe);
  }
  return true;
}

function getContactDisplayMeta(
  contact: CrmContact,
  chatById: (id: string) => BeeperChat | undefined,
  lastActivityByChatId?: LastActivityMap
) {
  const firstChat = contact.chats[0];
  const chat = firstChat ? chatById(firstChat.chatId) : null;
  const name = contact.displayName || chat?.name || "Unbenannt";
  const image = getAssetUrl(chat?.image);
  const lastTs =
    contact.lastActivityAt ??
    (chat?.lastMessage as { timestamp?: string })?.timestamp ??
    chat?.lastActivity;
  const preview = (chat?.lastMessage as { text?: string })?.text ?? "";

  let lastFromMe = contact.lastContactedByMeAt ?? null;
  let lastFromThem = contact.lastContactedByThemAt ?? null;
  let followUpCount = 0;
  if (lastActivityByChatId) {
    for (const ch of contact.chats) {
      const act = lastActivityByChatId[ch.chatId];
      if (act) {
        if (act.lastFromMe && (!lastFromMe || new Date(act.lastFromMe) > new Date(lastFromMe))) {
          lastFromMe = act.lastFromMe;
        }
        if (act.lastFromThem && (!lastFromThem || new Date(act.lastFromThem) > new Date(lastFromThem))) {
          lastFromThem = act.lastFromThem;
        }
        const n = act.followUpCount ?? 0;
        if (n > followUpCount) followUpCount = n;
      }
    }
  }
  return { name, image, lastTs, preview, lastFromMe, lastFromThem, followUpCount };
}

/** First chat on the contact that has non-empty next-message suggestions in cached analysis. */
function getNextMessageSuggestionsForContact(
  contact: CrmContact,
  cachedAnalysisByChatId: Record<string, ContactAnalysis | undefined>
): { chatId: string; suggestions: string[] } | null {
  for (const ch of contact.chats) {
    const a = cachedAnalysisByChatId[ch.chatId];
    const suggestions =
      a?.nextMessageSuggestions?.filter((s): s is string => typeof s === "string" && s.trim().length > 0) ??
      [];
    if (suggestions.length > 0) return { chatId: ch.chatId, suggestions };
  }
  return null;
}

function contactHasAnyCachedAnalysis(
  contact: CrmContact,
  cachedAnalysisByChatId: Record<string, ContactAnalysis | undefined>
): boolean {
  return contact.chats.some((ch) => cachedAnalysisByChatId[ch.chatId] != null);
}

/** First cached analysis for any contact chat (detail panel / badges). */
function getFirstCachedAnalysisForContact(
  contact: CrmContact,
  cachedAnalysisByChatId: Record<string, ContactAnalysis | undefined>
): ContactAnalysis | undefined {
  for (const ch of contact.chats) {
    const a = cachedAnalysisByChatId[ch.chatId];
    if (a) return a;
  }
  return undefined;
}

export function CrmView({
  focusChatId,
  initialContactId,
  onOpenChat,
  onOpenChatWithPreference,
  onContactSelect,
}: CrmViewProps) {
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [selectedContact, setSelectedContact] = useState<CrmContact | null>(null);
  const lastAppliedInitialContactId = useRef<string | null>(null);
  /** Multi-select: contact IDs selected with Shift+click. */
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [search, setSearch] = useState(() => getCrmViewFilter().search);
  const [activityFilter, setActivityFilter] = useState<ContactActivityFilter>(
    () => getCrmViewFilter().activityFilter as ContactActivityFilter
  );
  const [activityFilterDays, setActivityFilterDays] = useState(() => getCrmViewFilter().activityFilterDays);
  const [draggedContactIds, setDraggedContactIds] = useState<string[]>([]);
  const [dragOverStage, setDragOverStage] = useState<CrmStage | null>(null);
  const [contactContextMenu, setContactContextMenu] = useState<{
    x: number;
    y: number;
    contact: CrmContact;
  } | null>(null);
  const [bulkAnalyzeLabel, setBulkAnalyzeLabel] = useState<string | null>(null);
  type FupSort =
    | "default"
    | "fupAsc"
    | "fupDesc"
    | "platformAsc"
    | "platformDesc"
    | "nameAsc"
    | "nameDesc"
    | "brancheAsc"
    | "brancheDesc"
    | "kaufkraftAsc"
    | "kaufkraftDesc";
  const [fupSort, setFupSort] = useState<FupSort>(() => getCrmViewFilter().fupSort as FupSort);
  /** Filter by account/platform: empty = all, otherwise only contacts with at least one chat on that account. */
  const [accountFilterId, setAccountFilterId] = useState(() => getCrmViewFilter().accountFilterId);
  const [brancheFilter, setBrancheFilter] = useState(() => getCrmViewFilter().brancheFilter);
  const [analysisCacheBuster, setAnalysisCacheBuster] = useState(0);

  useEffect(() => {
    setCrmViewFilter({
      activityFilter,
      activityFilterDays,
      accountFilterId,
      fupSort,
      search,
      brancheFilter,
    });
  }, [activityFilter, activityFilterDays, accountFilterId, fupSort, search, brancheFilter]);

  const { data, error, isLoading: loading, mutate: loadAllChats } = useSWR(
    "crm:accounts-and-chats",
    fetchAccountsAndChats,
    SWR_CONFIG
  );
  const accounts = data?.accounts ?? [];
  const chats = data?.chats ?? [];

  const contactChatIds = useMemo(
    () => [...new Set(contacts.flatMap((c) => c.chats.map((ch) => ch.chatId)))],
    [contacts]
  );
  const { data: lastActivityMap, mutate: mutateLastActivity } = useSWR<LastActivityMap>(
    contactChatIds.length > 0 ? `crm:last-activity:${[...contactChatIds].sort().join(",")}` : null,
    () => fetchLastActivityMap(contactChatIds, { source: "crm-swr" }),
    { ...SWR_CONFIG, revalidateOnFocus: false }
  );
  const lastActivityByChatId = lastActivityMap ?? {};

  const fetchAnalysis = useCallback(
    () =>
      fetch("/api/crm/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ chatIds: contactChatIds }),
      }).then((r) => r.json()) as Promise<Record<string, ContactAnalysis>>,
    [contactChatIds]
  );
  const { data: analysisByChatId, mutate: mutateAnalysis } = useSWR<Record<string, ContactAnalysis>>(
    contactChatIds.length > 0 ? `crm:analysis:${[...contactChatIds].sort().join(",")}:${analysisCacheBuster}` : null,
    fetchAnalysis,
    { ...SWR_CONFIG, revalidateOnFocus: false }
  );
  const cachedAnalysisByChatId = analysisByChatId ?? {};

  const { data: rules } = useSWR<{
    analysisConcurrency?: number;
    autoLeadKeywords?: string;
    autoQualifiedKeywords?: string;
    maxFollowUpsBeforeLost?: number;
  }>("/api/settings/rules", jsonFetcher, { ...SWR_CONFIG, revalidateOnFocus: false });
  const analysisConcurrency = Math.max(
    1,
    Math.min(50, Math.round(rules?.analysisConcurrency ?? 5))
  );
  const maxFollowUpsBeforeLost = rules?.maxFollowUpsBeforeLost ?? 5;

  const [stageContextMenu, setStageContextMenu] = useState<{
    x: number;
    y: number;
    stage: CrmStage;
  } | null>(null);
  const [analyzingStage, setAnalyzingStage] = useState<CrmStage | null>(null);
  const [analyzeStageProgress, setAnalyzeStageProgress] = useState<{
    current: number;
    total: number;
    currentContactName?: string;
  } | null>(null);
  const [analyzeStageStep, setAnalyzeStageStep] = useState("");
  const analyzeStageCancelledRef = useRef(false);
  const [sendFeedback, setSendFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [reloadFeedback, setReloadFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [isReloadingChats, setIsReloadingChats] = useState(false);
  const [focusMode, setFocusMode] = useState<boolean>(() => getCrmFocusMode());
  /** Which suggestion row is currently sending (disables all suggestion buttons until done). */
  const [sendingSuggestion, setSendingSuggestion] = useState<{
    chatId: string;
    index: number;
  } | null>(null);
  const [stageMoveUndo, setStageMoveUndo] = useState<{
    contactIds: string[];
    previousById: Record<string, CrmStage>;
    targetStage: CrmStage;
  } | null>(null);
  const lastAutoRefreshByContactRef = useRef<Record<string, number>>({});
  const [miniChatHeightPx, setMiniChatHeightPx] = useState<number>(() => getCrmSidebarMessagePanelHeightPx());
  const [crmSidebarWidthPercent, setCrmSidebarWidthState] = useState<number>(() => getCrmSidebarWidthPercent());
  const miniChatResizingRef = useRef<{
    startY: number;
    startHeight: number;
    currentHeight: number;
  } | null>(null);
  const crmSidebarResizingRef = useRef<{
    startX: number;
    startWidthPercent: number;
    currentWidthPercent: number;
  } | null>(null);
  const lastDragEndedAtRef = useRef(0);

  const refreshContacts = useCallback(() => {
    setContacts(getContacts());
  }, []);

  useEffect(() => {
    if (maxFollowUpsBeforeLost < 0 || !lastActivityByChatId || contacts.length === 0) return;
    let didUpdate = false;
    for (const contact of contacts) {
      const currentStage = contact.stage ?? "Unzugeordnet";
      if (currentStage === "Lost") continue;
      for (const ch of contact.chats) {
        const act = lastActivityByChatId[ch.chatId];
        if (act?.followUpCount != null && act.followUpCount >= maxFollowUpsBeforeLost) {
          updateContact(contact.id, { stage: "Lost" });
          didUpdate = true;
          break;
        }
      }
    }
    if (didUpdate) refreshContacts();
  }, [contacts, lastActivityByChatId, maxFollowUpsBeforeLost, refreshContacts]);

  const refreshContactsAndSelected = useCallback(() => {
    const snapshot = getContacts();
    setContacts(snapshot);
    if (selectedContact) {
      const nextSelected = snapshot.find((c) => c.id === selectedContact.id) ?? null;
      setSelectedContact(nextSelected);
    }
  }, [selectedContact]);

  useEffect(() => {
    refreshContacts();
  }, [refreshContacts]);

  useEffect(() => {
    const handler = () => refreshContacts();
    window.addEventListener("contacts-synced", handler);
    return () => window.removeEventListener("contacts-synced", handler);
  }, [refreshContacts]);

  useEffect(() => {
    setCrmFocusMode(focusMode);
  }, [focusMode]);

  useEffect(() => {
    if (!sendFeedback) return;
    const t = setTimeout(() => setSendFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [sendFeedback]);

  useEffect(() => {
    if (!selectedContact) return;
    const selectedChatIds = selectedContact.chats.map((ch) => ch.chatId).filter(Boolean);
    if (selectedChatIds.length === 0) return;

    const hasMissingDates = selectedChatIds.some((chatId) => {
      const act = lastActivityByChatId[chatId];
      return !act || (!act.lastFromMe && !act.lastFromThem);
    });
    if (!hasMissingDates) return;

    const now = Date.now();
    const lastTry = lastAutoRefreshByContactRef.current[selectedContact.id] ?? 0;
    if (now - lastTry < 15000) return;
    lastAutoRefreshByContactRef.current[selectedContact.id] = now;

    void (async () => {
      try {
        const requestId = createRequestId("crm-click-refresh");
        const fresh = await fetchLastActivityMap(selectedChatIds, {
          requestId,
          source: "crm-contact-click-missing-dates",
        });
        await mutateLastActivity((prev) => ({ ...(prev ?? {}), ...fresh }), false);
      } catch {
        // ignore auto-refresh failures
      }
    })();
  }, [selectedContact, lastActivityByChatId, mutateLastActivity]);

  const CRM_ANALYSIS_STEPS = [
    "Aktualisiere Du/Sie…",
    "Lade Nachrichten…",
    "Transkribiere Sprachnachrichten…",
    "KI-Analyse…",
  ];
  const isBulkAnalyzing = (analyzingStage ?? bulkAnalyzeLabel) && analyzeStageProgress;
  useEffect(() => {
    if (!isBulkAnalyzing) {
      setAnalyzeStageStep("");
      return;
    }
    setAnalyzeStageStep(CRM_ANALYSIS_STEPS[0]);
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % CRM_ANALYSIS_STEPS.length;
      setAnalyzeStageStep(CRM_ANALYSIS_STEPS[i]);
    }, 2500);
    return () => clearInterval(id);
  }, [!!analyzingStage, !!bulkAnalyzeLabel, !!analyzeStageProgress]);

  useEffect(() => {
    if (contacts.length === 0) return;
    if (!initialContactId) {
      lastAppliedInitialContactId.current = null;
      setSelectedContact(null);
      return;
    }
    if (lastAppliedInitialContactId.current === initialContactId) return;
    const contact = contacts.find((c) => c.id === initialContactId);
    if (contact) {
      setSelectedContact(contact);
      lastAppliedInitialContactId.current = initialContactId;
    } else {
      lastAppliedInitialContactId.current = initialContactId;
    }
  }, [initialContactId, contacts]);

  const focusChatIdAppliedRef = useRef(false);
  useEffect(() => {
    if (!focusChatId || contacts.length === 0) {
      if (!focusChatId) focusChatIdAppliedRef.current = false;
      return;
    }
    if (focusChatIdAppliedRef.current) return;
    const contact = contacts.find((c) => c.chats.some((ch) => ch.chatId === focusChatId));
    if (contact) {
      setSelectedContact(contact);
      onContactSelect?.(contact.id);
      focusChatIdAppliedRef.current = true;
    }
  }, [focusChatId, contacts, onContactSelect]);

  const chatById = useCallback((chatId: string) => chats.find((c) => c.id === chatId), [chats]);
  const accountById = useCallback((id: string) => accounts.find((a) => a.id === id), [accounts]);

  const getBrancheForContact = useCallback(
    (c: CrmContact) => {
      for (const ch of c.chats) {
        const b = cachedAnalysisByChatId[ch.chatId]?.branche;
        if (b?.trim()) return b;
      }
      return "";
    },
    [cachedAnalysisByChatId]
  );

  const getKaufkraftForContact = useCallback(
    (c: CrmContact) => {
      for (const ch of c.chats) {
        const raw = cachedAnalysisByChatId[ch.chatId]?.kaufkraft;
        if (raw == null) continue;
        const text = String(raw).trim();
        if (!text) continue;
        const numeric = /^(10|[1-9])$/.test(text) ? Number.parseInt(text, 10) : null;
        return { has: true, numeric, text };
      }
      return { has: false, numeric: null as number | null, text: "" };
    },
    [cachedAnalysisByChatId]
  );

  const availableBranches = useMemo(() => {
    const set = new Set<string>();
    Object.values(cachedAnalysisByChatId).forEach((a) => {
      if (a?.branche?.trim()) set.add(a.branche.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
  }, [cachedAnalysisByChatId]);

  const searchLower = search.trim().toLowerCase();
  const brancheFilterLower = brancheFilter.trim().toLowerCase();
  const filterContact = useCallback(
    (c: CrmContact) => {
      if (!searchLower) return true;
      const meta = getContactDisplayMeta(c, chatById);
      if ((meta.name ?? "").toLowerCase().includes(searchLower)) return true;
      return c.chats.some((ch) => {
        const chat = chatById(ch.chatId);
        return (chat?.name ?? "").toLowerCase().includes(searchLower);
      });
    },
    [searchLower, chatById]
  );

  const contactsByStage = useMemo(
    () =>
      CRM_STAGES.reduce(
        (acc, stage) => {
          acc[stage] = contacts.filter(
            (c) =>
              (c.stage ?? "Unzugeordnet") === stage &&
              filterContact(c) &&
              (!brancheFilterLower ||
                getBrancheForContact(c).toLowerCase().includes(brancheFilterLower)) &&
              contactMatchesActivityFilter(
                c,
                activityFilter,
                activityFilterDays,
                chatById,
                lastActivityByChatId
              ) &&
              (!accountFilterId || c.chats.some((ch) => ch.accountId === accountFilterId))
          );
          return acc;
        },
        {} as Record<CrmStage, CrmContact[]>
      ),
    [
      contacts,
      activityFilter,
      activityFilterDays,
      accountFilterId,
      searchLower,
      brancheFilterLower,
      filterContact,
      getBrancheForContact,
      chatById,
      lastActivityByChatId,
    ]
  );

  const sortedContactsByStage = useMemo(() => {
    if (fupSort === "default") return contactsByStage;
    if (fupSort === "platformAsc" || fupSort === "platformDesc") {
      const getAccountIndex = (c: CrmContact) => {
        const accountId = c.chats[0]?.accountId;
        if (!accountId) return accounts.length;
        const i = accounts.findIndex((a) => a.id === accountId);
        return i >= 0 ? i : accounts.length;
      };
      return CRM_STAGES.reduce(
        (acc, stage) => {
          const list = [...contactsByStage[stage]];
          list.sort((a, b) => {
            const ia = getAccountIndex(a);
            const ib = getAccountIndex(b);
            return fupSort === "platformDesc" ? ib - ia : ia - ib;
          });
          acc[stage] = list;
          return acc;
        },
        {} as Record<CrmStage, CrmContact[]>
      );
    }
    if (fupSort === "nameAsc" || fupSort === "nameDesc") {
      const getName = (c: CrmContact) =>
        getContactDisplayMeta(c, chatById, lastActivityByChatId).name ?? "";
      return CRM_STAGES.reduce(
        (acc, stage) => {
          const list = [...contactsByStage[stage]];
          list.sort((a, b) => {
            const na = getName(a).localeCompare(getName(b), "de", { sensitivity: "base" });
            return fupSort === "nameDesc" ? -na : na;
          });
          acc[stage] = list;
          return acc;
        },
        {} as Record<CrmStage, CrmContact[]>
      );
    }
    if (fupSort === "brancheAsc" || fupSort === "brancheDesc") {
      return CRM_STAGES.reduce(
        (acc, stage) => {
          const list = [...contactsByStage[stage]];
          list.sort((a, b) => {
            const ba = getBrancheForContact(a);
            const bb = getBrancheForContact(b);
            const cmp = ba.localeCompare(bb, "de", { sensitivity: "base" });
            return fupSort === "brancheDesc" ? -cmp : cmp;
          });
          acc[stage] = list;
          return acc;
        },
        {} as Record<CrmStage, CrmContact[]>
      );
    }
    if (fupSort === "kaufkraftAsc" || fupSort === "kaufkraftDesc") {
      return CRM_STAGES.reduce(
        (acc, stage) => {
          const list = [...contactsByStage[stage]];
          list.sort((a, b) => {
            const ka = getKaufkraftForContact(a);
            const kb = getKaufkraftForContact(b);
            if (ka.has !== kb.has) return ka.has ? -1 : 1;
            if (!ka.has && !kb.has) return 0;
            const aNumeric = ka.numeric != null;
            const bNumeric = kb.numeric != null;
            if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
            if (aNumeric && bNumeric && ka.numeric !== kb.numeric) {
              return fupSort === "kaufkraftDesc"
                ? (kb.numeric as number) - (ka.numeric as number)
                : (ka.numeric as number) - (kb.numeric as number);
            }
            const cmp = ka.text.localeCompare(kb.text, "de", { sensitivity: "base" });
            return fupSort === "kaufkraftDesc" ? -cmp : cmp;
          });
          acc[stage] = list;
          return acc;
        },
        {} as Record<CrmStage, CrmContact[]>
      );
    }
    const getFup = (c: CrmContact) =>
      getContactDisplayMeta(c, chatById, lastActivityByChatId).followUpCount ?? 0;
    return CRM_STAGES.reduce(
      (acc, stage) => {
        const list = [...contactsByStage[stage]];
        if (fupSort === "fupDesc") {
          list.sort((a, b) => getFup(b) - getFup(a));
        } else {
          list.sort((a, b) => getFup(a) - getFup(b));
        }
        acc[stage] = list;
        return acc;
      },
      {} as Record<CrmStage, CrmContact[]>
    );
  }, [
    contactsByStage,
    fupSort,
    getBrancheForContact,
    getKaufkraftForContact,
    chatById,
    lastActivityByChatId,
    accounts,
  ]);

  const totalPipelineCount = useMemo(
    () => CRM_STAGES.reduce((sum, stage) => sum + sortedContactsByStage[stage].length, 0),
    [sortedContactsByStage]
  );
  const focusStage = useMemo(() => {
    if (selectedContact) {
      return (selectedContact.stage ?? "Unzugeordnet") as CrmStage;
    }
    const firstNonEmpty = CRM_STAGES.find((stage) => sortedContactsByStage[stage].length > 0);
    return firstNonEmpty ?? CRM_STAGES[0];
  }, [selectedContact, sortedContactsByStage]);
  const visibleStages = useMemo(
    () => (focusMode ? [focusStage] : CRM_STAGES),
    [focusMode, focusStage]
  );
  const allVisibleStageContacts = useMemo(
    () => CRM_STAGES.flatMap((stage) => sortedContactsByStage[stage]),
    [sortedContactsByStage]
  );

  const jumpToNextContactInSameStage = useCallback(
    (currentContactId: string): boolean => {
      const currentContact = contacts.find((c) => c.id === currentContactId) ?? null;
      if (!currentContact) return false;
      const currentStage = (currentContact.stage ?? "Unzugeordnet") as CrmStage;
      const stageList = sortedContactsByStage[currentStage] ?? [];
      const idx = stageList.findIndex((c) => c.id === currentContact.id);
      const nextContact = idx >= 0 ? stageList[idx + 1] : null;
      if (!nextContact) return false;
      setSelectedContact(nextContact);
      setSelectedContactIds([nextContact.id]);
      onContactSelect?.(nextContact.id);
      return true;
    },
    [contacts, sortedContactsByStage, onContactSelect]
  );

  const handleSendSuggestion = useCallback(
    async (chatId: string, text: string, suggestionIndex: number, currentContactId: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSendFeedback(null);

      // Jump immediately to the next contact in the same stage; sending continues in background.
      jumpToNextContactInSameStage(currentContactId);

      setSendingSuggestion({ chatId, index: suggestionIndex });
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSendFeedback({
            type: "error",
            message: (data as { error?: string }).error ?? "Senden fehlgeschlagen",
          });
          return;
        }
        const nowIso = new Date().toISOString();
        const contact = getContactByChatId(chatId);
        if (contact) {
          updateContact(contact.id, { lastContactedByMeAt: nowIso });
          window.dispatchEvent(new CustomEvent("contacts-synced"));
        }
        // Ensure Du/Sie UI updates immediately without waiting for a background reload.
        await mutateLastActivity(
          (prev) => ({
            ...(prev ?? {}),
            [chatId]: {
              ...(prev?.[chatId] ?? { lastFromMe: null, lastFromThem: null, followUpCount: 0 }),
              lastFromMe: nowIso,
            },
          }),
          false
        );
        setSendFeedback({ type: "success", message: "Nachricht gesendet." });
        refreshContacts();
      } catch {
        setSendFeedback({ type: "error", message: "Netzwerkfehler beim Senden." });
      } finally {
        setSendingSuggestion(null);
      }
    },
    [jumpToNextContactInSameStage, refreshContacts, mutateLastActivity]
  );

  const applyStageMoveWithUndo = useCallback(
    (contactIds: string[], targetStage: CrmStage) => {
      if (contactIds.length === 0) return false;
      const snapshot = getContacts();
      const previousById: Record<string, CrmStage> = {};
      let changed = false;
      for (const contactId of contactIds) {
        const existing = snapshot.find((c) => c.id === contactId);
        if (!existing) continue;
        const previous = (existing.stage ?? "Unzugeordnet") as CrmStage;
        previousById[contactId] = previous;
        if (previous !== targetStage) {
          const updated = updateContact(contactId, { stage: targetStage });
          if (updated) changed = true;
        }
      }
      if (!changed) return false;
      refreshContacts();
      setStageMoveUndo({ contactIds, previousById, targetStage });
      return true;
    },
    [refreshContacts]
  );

  const undoLastStageMove = useCallback(() => {
    if (!stageMoveUndo) return;
    let changed = false;
    for (const contactId of stageMoveUndo.contactIds) {
      const previousStage = stageMoveUndo.previousById[contactId];
      if (!previousStage) continue;
      const updated = updateContact(contactId, { stage: previousStage });
      if (updated) changed = true;
    }
    if (changed) refreshContacts();
    setStageMoveUndo(null);
  }, [stageMoveUndo, refreshContacts]);

  const handleDrop = useCallback(
    (targetStage: CrmStage) => {
      if (draggedContactIds.length === 0) return;
      applyStageMoveWithUndo(draggedContactIds, targetStage);
      setDraggedContactIds([]);
      setDragOverStage(null);
      lastDragEndedAtRef.current = Date.now();
    },
    [draggedContactIds, applyStageMoveWithUndo]
  );

  const moveContactsToStage = useCallback(
    (contactIds: string[], targetStage: CrmStage) => {
      if (contactIds.length === 0) return;
      applyStageMoveWithUndo(contactIds, targetStage);
      setContactContextMenu(null);
    },
    [applyStageMoveWithUndo]
  );

  useEffect(() => {
    if (!stageContextMenu) return;
    const close = () => setStageContextMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [stageContextMenu]);

  useEffect(() => {
    if (!contactContextMenu) return;
    const close = () => setContactContextMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [contactContextMenu]);

  const preloadAllChatsBeforeAnalyze = useCallback(async () => {
    const requestId = createRequestId("crm-preload");
    const loaded = await loadAllChats();
    const loadedChats = (loaded as { chats?: BeeperChat[] } | undefined)?.chats ?? [];
    if (loadedChats.length > 0) {
      const validChatIds = new Set(loadedChats.map((ch) => ch.id).filter(Boolean));
      const snapshot = getContacts();
      for (const contact of snapshot) {
        for (const ch of contact.chats) {
          if (!validChatIds.has(ch.chatId)) {
            removeChatFromContact(contact.id, ch.chatId);
          }
        }
      }
      refreshContactsAndSelected();
    }
    const freshChatIds = [...new Set(getContacts().flatMap((c) => c.chats.map((ch) => ch.chatId)))]
      .filter(Boolean);
    if (freshChatIds.length > 0) {
      const fresh = await fetchLastActivityMap(freshChatIds, {
        forceRefresh: true,
        requestId,
        source: "crm-preload-all",
      });
      await mutateLastActivity((prev) => ({ ...(prev ?? {}), ...fresh }), false);
    } else {
      await mutateLastActivity();
    }
    if (selectedContact) {
      const selectedChatIds = selectedContact.chats.map((ch) => ch.chatId).filter(Boolean);
      if (selectedChatIds.length > 0) {
        const fresh = await fetchLastActivityMap(selectedChatIds, {
          forceRefresh: true,
          requestId,
          source: "crm-preload-selected",
        });
        await mutateLastActivity((prev) => ({ ...(prev ?? {}), ...fresh }), false);
      }
    }
  }, [loadAllChats, mutateLastActivity, refreshContactsAndSelected, selectedContact]);

  const reloadAllChatsWithFeedback = useCallback(async () => {
    const requestId = createRequestId("crm-reload");
    setIsReloadingChats(true);
    setReloadFeedback({
      type: "info",
      message: `Alle Chats werden neu geladen… (ID: ${requestId.slice(0, 12)})`,
    });
    const t0 = Date.now();
    try {
      const loaded = await loadAllChats();
      const loadedChats = (loaded as { chats?: BeeperChat[] } | undefined)?.chats ?? [];
      let cleanedAssignments = 0;
      let selectedDatesChanged = false;
      let updatedDateFieldsCount = 0;
      if (loadedChats.length > 0) {
        const validChatIds = new Set(loadedChats.map((ch) => ch.id).filter(Boolean));
        const snapshot = getContacts();
        for (const contact of snapshot) {
          for (const ch of contact.chats) {
            if (!validChatIds.has(ch.chatId)) {
              removeChatFromContact(contact.id, ch.chatId);
              cleanedAssignments += 1;
            }
          }
        }
        if (cleanedAssignments > 0) refreshContactsAndSelected();
      }
      const freshChatIds = [...new Set(getContacts().flatMap((c) => c.chats.map((ch) => ch.chatId)))]
        .filter(Boolean);
      if (freshChatIds.length > 0) {
        const fresh = await fetchLastActivityMap(freshChatIds, {
          requestId,
          source: "crm-reload-all",
        });
        for (const [chatId, act] of Object.entries(fresh)) {
          const prev = lastActivityByChatId[chatId];
          if (act.lastFromMe && act.lastFromMe !== (prev?.lastFromMe ?? null)) {
            updatedDateFieldsCount += 1;
          }
          if (act.lastFromThem && act.lastFromThem !== (prev?.lastFromThem ?? null)) {
            updatedDateFieldsCount += 1;
          }
        }
        await mutateLastActivity((prev) => ({ ...(prev ?? {}), ...fresh }), false);
      } else {
        await mutateLastActivity();
      }
      if (selectedContact) {
        const selectedContactSnapshot =
          getContacts().find((c) => c.id === selectedContact.id) ?? selectedContact;
        const prevLastFromMe = selectedContactSnapshot.lastContactedByMeAt ?? null;
        const prevLastFromThem = selectedContactSnapshot.lastContactedByThemAt ?? null;
        const selectedChatIds = selectedContactSnapshot.chats.map((ch) => ch.chatId).filter(Boolean);
        if (selectedChatIds.length > 0) {
          const fresh = await fetchLastActivityMap(selectedChatIds, {
            requestId,
            source: "crm-reload-selected",
          });
          await mutateLastActivity((prev) => ({ ...(prev ?? {}), ...fresh }), false);
          let latestFromMe: string | null = null;
          let latestFromThem: string | null = null;
          for (const chatId of selectedChatIds) {
            const act = fresh[chatId];
            if (!act) continue;
            if (act.lastFromMe && (!latestFromMe || new Date(act.lastFromMe) > new Date(latestFromMe))) {
              latestFromMe = act.lastFromMe;
            }
            if (act.lastFromThem && (!latestFromThem || new Date(act.lastFromThem) > new Date(latestFromThem))) {
              latestFromThem = act.lastFromThem;
            }
          }
          if (
            (latestFromMe && latestFromMe !== prevLastFromMe) ||
            (latestFromThem && latestFromThem !== prevLastFromThem)
          ) {
            selectedDatesChanged = true;
          }
          if (latestFromMe && latestFromMe !== prevLastFromMe) {
            updatedDateFieldsCount += 1;
          }
          if (latestFromThem && latestFromThem !== prevLastFromThem) {
            updatedDateFieldsCount += 1;
          }
        }
        const loadedChatIds = new Set(loadedChats.map((c) => c.id).filter(Boolean));
        const prioritizedChatIds = [
          ...selectedContactSnapshot.chats
            .map((ch) => ch.chatId)
            .filter((chatId): chatId is string => Boolean(chatId && loadedChatIds.has(chatId))),
          ...selectedContactSnapshot.chats
            .map((ch) => ch.chatId)
            .filter((chatId): chatId is string => Boolean(chatId && !loadedChatIds.has(chatId))),
        ];
        if (prioritizedChatIds.length > 0) {
          let directLastFromMe: string | null = null;
          let directLastFromThem: string | null = null;
          for (const chatId of prioritizedChatIds) {
            try {
              const msgRes = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
                cache: "default",
              });
              if (!msgRes.ok) continue;
              const msgData = (await msgRes.json()) as {
                items?: Array<{ timestamp?: string; isSender?: boolean }>;
              };
              const items = Array.isArray(msgData.items) ? msgData.items : [];
              const direct = deriveLastContactFromMessages(items);
              if (direct.lastFromMe && (!directLastFromMe || new Date(direct.lastFromMe) > new Date(directLastFromMe))) {
                directLastFromMe = direct.lastFromMe;
              }
              if (direct.lastFromThem && (!directLastFromThem || new Date(direct.lastFromThem) > new Date(directLastFromThem))) {
                directLastFromThem = direct.lastFromThem;
              }
            } catch {
              // continue with next chat id
            }
          }
          if (directLastFromMe || directLastFromThem) {
            if (
              (directLastFromMe && directLastFromMe !== prevLastFromMe) ||
              (directLastFromThem && directLastFromThem !== prevLastFromThem)
            ) {
              selectedDatesChanged = true;
            }
            const nextLastFromMe = directLastFromMe ?? undefined;
            const nextLastFromThem = directLastFromThem ?? undefined;
            if (nextLastFromMe && nextLastFromMe !== prevLastFromMe) {
              updatedDateFieldsCount += 1;
            }
            if (nextLastFromThem && nextLastFromThem !== prevLastFromThem) {
              updatedDateFieldsCount += 1;
            }
            const updated = updateContact(selectedContactSnapshot.id, {
              lastContactedByMeAt: directLastFromMe ?? undefined,
              lastContactedByThemAt: directLastFromThem ?? undefined,
            });
            if (updated) setSelectedContact(updated);
          }
        }
      }
      // Force a full SWR revalidation for the current key after explicit reload.
      await mutateLastActivity();
      refreshContactsAndSelected();
      const ms = Date.now() - t0;
      setReloadFeedback({
        type: "success",
        message:
          cleanedAssignments > 0
            ? `Alle Chats neu geladen (${ms} ms), ${cleanedAssignments} alte Chat-Zuordnung(en) bereinigt. Du/Sie: ${selectedDatesChanged ? "aktualisiert" : "unveraendert"}. Geaenderte Du/Sie-Felder: ${updatedDateFieldsCount}.`
            : `Alle Chats neu geladen (${ms} ms). Du/Sie: ${selectedDatesChanged ? "aktualisiert" : "unveraendert"}. Geaenderte Du/Sie-Felder: ${updatedDateFieldsCount}.`,
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "Unbekannter Fehler";
      // Keep this visible in browser console for deep debugging.
      console.error("[crm-reload] failed", { requestId, error });
      setReloadFeedback({
        type: "error",
        message: `Neu laden fehlgeschlagen (${requestId.slice(0, 12)}): ${reason}`,
      });
    } finally {
      setIsReloadingChats(false);
    }
  }, [loadAllChats, mutateLastActivity, refreshContactsAndSelected, selectedContact, lastActivityByChatId]);

  const handleAnalyzeForContacts = useCallback(
    async (
      contactsToAnalyze: CrmContact[],
      label: string,
      invokeSource = "crm-sales-sidebar",
      force = false
    ) => {
      await preloadAllChatsBeforeAnalyze();
      const withChat = contactsToAnalyze
        .map((c) => ({ contact: c, chatId: c.chats[0]?.chatId }))
        .filter((x): x is { contact: CrmContact; chatId: string } => !!x.chatId);
      if (withChat.length === 0) return;
      setStageContextMenu(null);
      setContactContextMenu(null);
      analyzeStageCancelledRef.current = false;
      setAnalyzingStage(null);
      setBulkAnalyzeLabel(label);
      setAnalyzeStageProgress({ current: 0, total: withChat.length, currentContactName: undefined });
      await runWithConcurrency(analysisConcurrency, withChat, async ({ contact, chatId }) => {
        if (analyzeStageCancelledRef.current) return;
        const chat = chatById(chatId);
        const contactName = (contact.displayName ?? chat?.name ?? "").trim() || undefined;
        setAnalyzeStageProgress((prev) =>
          prev ? { ...prev, currentContactName: contactName || contact.displayName || "Kontakt" } : null
        );
        try {
          const res = await fetch("/api/analyze-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, contactName, force, source: invokeSource }),
          });
          const data = res.ok ? (await res.json()) as ContactAnalysis : null;
          if (data) {
            const currentStage = contact.stage ?? "Unzugeordnet";
            if (currentStage === "Unzugeordnet") {
              const keywordStage = getAutoStageFromAnalysis(data, rules ?? {});
              if (keywordStage) updateContact(contact.id, { stage: keywordStage });
            }
          }
        } catch {
          // continue
        }
        setAnalyzeStageProgress((prev) =>
          prev ? { ...prev, current: prev.current + 1, currentContactName: undefined } : null
        );
      });
      setAnalyzingStage(null);
      setBulkAnalyzeLabel(null);
      setAnalyzeStageProgress(null);
      refreshContacts();
      setAnalysisCacheBuster((b) => b + 1);
      await mutateAnalysis();
    },
    [chatById, analysisConcurrency, mutateAnalysis, refreshContacts, rules, preloadAllChatsBeforeAnalyze]
  );

  const handleAnalyzeStageForColumn = useCallback(
    async (stage: CrmStage, force = false) => {
      await preloadAllChatsBeforeAnalyze();
      const list = contacts.filter(
        (c) =>
          (c.stage ?? "Unzugeordnet") === stage &&
          filterContact(c) &&
          (!brancheFilterLower || getBrancheForContact(c).toLowerCase().includes(brancheFilterLower)) &&
          contactMatchesActivityFilter(
            c,
            activityFilter,
            activityFilterDays,
            chatById,
            lastActivityByChatId
          ) &&
          (!accountFilterId || c.chats.some((ch) => ch.accountId === accountFilterId))
      );
      const withChat = list
        .map((c) => ({ contact: c, chatId: c.chats[0]?.chatId }))
        .filter((x): x is { contact: CrmContact; chatId: string } => !!x.chatId);
      if (withChat.length === 0) return;
      setStageContextMenu(null);
      analyzeStageCancelledRef.current = false;
      setBulkAnalyzeLabel(null);
      setAnalyzingStage(stage);
      setAnalyzeStageProgress({ current: 0, total: withChat.length, currentContactName: undefined });
      await runWithConcurrency(analysisConcurrency, withChat, async ({ contact, chatId }) => {
        if (analyzeStageCancelledRef.current) return;
        const chat = chatById(chatId);
        const contactName = (contact.displayName ?? chat?.name ?? "").trim() || undefined;
        setAnalyzeStageProgress((prev) =>
          prev ? { ...prev, currentContactName: contactName || contact.displayName || "Kontakt" } : null
        );
        try {
          const res = await fetch("/api/analyze-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chatId, contactName, force, source: "crm-stage-header-bulk" }),
          });
          const data = res.ok ? (await res.json()) as ContactAnalysis : null;
          if (data) {
            const currentStage = contact.stage ?? "Unzugeordnet";
            if (currentStage === "Unzugeordnet") {
              const keywordStage = getAutoStageFromAnalysis(data, rules ?? {});
              if (keywordStage) updateContact(contact.id, { stage: keywordStage });
            }
          }
        } catch {
          // continue
        }
        setAnalyzeStageProgress((prev) =>
          prev ? { ...prev, current: prev.current + 1, currentContactName: undefined } : null
        );
      });
      setAnalyzingStage(null);
      setAnalyzeStageProgress(null);
      refreshContacts();
      setAnalysisCacheBuster((b) => b + 1);
      await mutateAnalysis();
    },
    [
      contacts,
      activityFilter,
      activityFilterDays,
      accountFilterId,
      brancheFilterLower,
      filterContact,
      getBrancheForContact,
      chatById,
      lastActivityByChatId,
      mutateAnalysis,
      analysisConcurrency,
      refreshContacts,
      rules,
      preloadAllChatsBeforeAnalyze,
    ]
  );

  const cancelAnalyzeStage = useCallback(() => {
    analyzeStageCancelledRef.current = true;
  }, []);

  const selectedSuggestionPack = selectedContact
    ? getNextMessageSuggestionsForContact(selectedContact, cachedAnalysisByChatId)
    : null;
  const selectedHasAnalysis = selectedContact
    ? contactHasAnyCachedAnalysis(selectedContact, cachedAnalysisByChatId)
    : false;
  const selectedTargetChatId = selectedSuggestionPack?.chatId ?? null;
  const selectedSuggestions = selectedSuggestionPack?.suggestions ?? [];
  const selectedTargetAccountId =
    selectedContact && selectedTargetChatId
      ? selectedContact.chats.find((c) => c.chatId === selectedTargetChatId)?.accountId ?? null
      : null;
  const selectedHasNextInStage = useMemo(() => {
    if (!selectedContact) return false;
    const stage = (selectedContact.stage ?? "Unzugeordnet") as CrmStage;
    const stageList = sortedContactsByStage[stage] ?? [];
    const idx = stageList.findIndex((c) => c.id === selectedContact.id);
    return idx >= 0 && idx < stageList.length - 1;
  }, [selectedContact, sortedContactsByStage]);
  const selectedSuggestionNetworkLabel =
    selectedContact && selectedTargetChatId
      ? getNetworkLabel(
          selectedContact.chats.find((c) => c.chatId === selectedTargetChatId)?.network ??
            accountById(selectedContact.chats.find((c) => c.chatId === selectedTargetChatId)?.accountId ?? "")
              ?.network
        )
      : "";

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (!selectedContact || !selectedTargetChatId) return;
      if (sendingSuggestion) return;

      const key = e.key.toLowerCase();
      if (key === "1" || key === "2" || key === "3") {
        const idx = Number.parseInt(key, 10) - 1;
        const suggestion = selectedSuggestions[idx];
        if (!suggestion) return;
        e.preventDefault();
        void handleSendSuggestion(selectedTargetChatId, suggestion, idx, selectedContact.id);
        return;
      }
      if (key === "n") {
        e.preventDefault();
        jumpToNextContactInSameStage(selectedContact.id);
        return;
      }
      if (key === "o") {
        if (!selectedTargetAccountId) return;
        e.preventDefault();
        (onOpenChatWithPreference ?? onOpenChat)(selectedTargetChatId, selectedTargetAccountId);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedContact,
    selectedTargetChatId,
    selectedTargetAccountId,
    selectedSuggestions,
    sendingSuggestion,
    handleSendSuggestion,
    jumpToNextContactInSameStage,
    onOpenChatWithPreference,
    onOpenChat,
  ]);

  const startMiniChatResize = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    miniChatResizingRef.current = { startY: e.clientY, startHeight: miniChatHeightPx, currentHeight: miniChatHeightPx };
    const onMove = (ev: MouseEvent) => {
      const s = miniChatResizingRef.current;
      if (!s) return;
      const dy = ev.clientY - s.startY;
      const next = Math.max(140, Math.min(560, s.startHeight - dy));
      s.currentHeight = next;
      setMiniChatHeightPx(next);
    };
    const onUp = () => {
      const s = miniChatResizingRef.current;
      miniChatResizingRef.current = null;
      if (s) setCrmSidebarMessagePanelHeightPx(s.currentHeight);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [miniChatHeightPx]);

  const startCrmSidebarResize = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    crmSidebarResizingRef.current = {
      startX: e.clientX,
      startWidthPercent: crmSidebarWidthPercent,
      currentWidthPercent: crmSidebarWidthPercent,
    };
    const onMove = (ev: MouseEvent) => {
      const s = crmSidebarResizingRef.current;
      if (!s) return;
      const viewportWidth = Math.max(window.innerWidth, 320);
      const deltaPercent = ((s.startX - ev.clientX) / viewportWidth) * 100;
      const next = Math.max(35, Math.min(75, s.startWidthPercent + deltaPercent));
      s.currentWidthPercent = next;
      setCrmSidebarWidthState(next);
    };
    const onUp = () => {
      const s = crmSidebarResizingRef.current;
      crmSidebarResizingRef.current = null;
      if (s) setCrmSidebarWidthPercent(s.currentWidthPercent);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [crmSidebarWidthPercent]);

  return (
    <div className="relative flex h-full flex-col bg-wa-chat-bg">
      {/* Top bar: title + search + activity filter */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-wa-border bg-wa-panel px-4 py-3">
        <h1 className="text-lg font-semibold text-wa-text-primary">
          Pipeline
          <span className="ml-2 font-normal text-wa-text-secondary tabular-nums">
            ({totalPipelineCount} {totalPipelineCount === 1 ? "Kontakt" : "Kontakte"})
          </span>
          {focusMode && (
            <span className="ml-2 rounded bg-wa-green/15 px-1.5 py-0.5 text-xs font-medium text-wa-green">
              Fokus: {focusStage}
            </span>
          )}
        </h1>
        <input
          type="search"
          placeholder="Kontakte durchsuchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          title="Pipeline-Kontakte nach Name durchsuchen"
          className="max-w-xs flex-1 rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none min-w-[180px]"
        />
        <div className="flex items-center gap-2 min-w-0">
          <label htmlFor="branche-filter" className="text-xs text-wa-text-secondary whitespace-nowrap">
            Branche:
          </label>
          <div className="relative flex items-center">
            <input
              id="branche-filter"
              type="text"
              list="branche-list"
              placeholder="Filtern oder wählen…"
              value={brancheFilter}
              onChange={(e) => setBrancheFilter(e.target.value)}
              title="Nach Branche aus der KI-Analyse filtern (freitext oder aus Liste wählen)"
              className="w-40 rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 pr-8 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none"
            />
            {brancheFilter.trim() !== "" && (
              <button
                type="button"
                onClick={() => setBrancheFilter("")}
                title="Branche-Filter zurücksetzen"
                aria-label="Branche-Filter zurücksetzen"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-wa-text-secondary hover:bg-wa-panel-secondary hover:text-wa-text-primary"
              >
                <span aria-hidden>✕</span>
              </button>
            )}
          </div>
          <datalist id="branche-list">
            {availableBranches.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="account-filter" className="text-xs text-wa-text-secondary whitespace-nowrap">
            Konto:
          </label>
          <select
            id="account-filter"
            value={accountFilterId}
            onChange={(e) => setAccountFilterId(e.target.value)}
            title="Nur Kontakte anzeigen, die einen Chat auf diesem Konto/Account haben"
            className="rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
          >
            <option value="">Alle Konten</option>
            {accounts.map((acc, index) => {
              const a = acc as BeeperAccount;
              const userName = a.user?.name ?? a.user?.fullName ?? a.id;
              const optionValue = String(a.accountID ?? a.id ?? "").trim();
              return (
                <option key={optionValue || `account-${index}`} value={optionValue}>
                  {getNetworkLabel(a.network)} ({userName})
                </option>
              );
            })}
          </select>
          <label htmlFor="activity-filter" className="text-xs text-wa-text-secondary whitespace-nowrap" title="Nach Kontaktaktivität filtern">
            Filter:
          </label>
          <select
            id="activity-filter"
            value={activityFilter}
            onChange={(e) => setActivityFilter(e.target.value as ContactActivityFilter)}
            title="Filter: Alle, ich nicht geschrieben, Kontakt nicht geschrieben, Antwort ausstehend"
            className="rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
          >
            <option key="all" value="all">Alle</option>
            <option key="i_not_written_since" value="i_not_written_since">Ich habe seit … Tagen nicht geschrieben</option>
            <option key="they_not_written_since" value="they_not_written_since">Kontakt hat seit … Tagen nicht geschrieben</option>
            <option key="they_wrote_last" value="they_wrote_last">Kontakt hat zuletzt geschrieben (Antwort ausstehend)</option>
          </select>
          {(activityFilter === "i_not_written_since" || activityFilter === "they_not_written_since") && (
            <>
              <input
                type="number"
                min={1}
                max={365}
                value={activityFilterDays}
                onChange={(e) => setActivityFilterDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                title="Anzahl Tage für Filter"
                className="w-16 rounded-lg border border-wa-border bg-wa-input-bg px-2 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
              />
              <span className="text-xs text-wa-text-secondary" title="Tage">Tage</span>
            </>
          )}
          <label htmlFor="fup-sort" className="text-xs text-wa-text-secondary whitespace-nowrap">
            Sortierung:
          </label>
          <select
            id="fup-sort"
            value={fupSort}
            onChange={(e) => setFupSort(e.target.value as FupSort)}
            title="Pipeline sortieren: Standard, nach FUPs oder nach Konto/Plattform (Reihenfolge der Kontenliste)"
            className="rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
          >
            <option key="default" value="default">Standard (keine)</option>
            <option key="fupAsc" value="fupAsc">FUPs aufsteigend (wenige zuerst)</option>
            <option key="fupDesc" value="fupDesc">FUPs absteigend (meiste zuerst)</option>
            <option key="platformAsc" value="platformAsc">Konto aufsteigend (Reihenfolge Liste)</option>
            <option key="platformDesc" value="platformDesc">Konto absteigend (umgekehrte Reihenfolge)</option>
            <option key="nameAsc" value="nameAsc">Name A–Z</option>
            <option key="nameDesc" value="nameDesc">Name Z–A</option>
            <option key="brancheAsc" value="brancheAsc">Branche A–Z</option>
            <option key="brancheDesc" value="brancheDesc">Branche Z–A</option>
            <option key="kaufkraftAsc" value="kaufkraftAsc">Kaufkraft aufsteigend</option>
            <option key="kaufkraftDesc" value="kaufkraftDesc">Kaufkraft absteigend</option>
          </select>
          <button
            type="button"
            onClick={() => {
              void reloadAllChatsWithFeedback();
            }}
            disabled={isReloadingChats || !!(analyzingStage || bulkAnalyzeLabel)}
            title="Nur Chats neu laden (ohne Analyse)"
            className="rounded-lg border border-wa-border bg-wa-panel-secondary px-3 py-2 text-xs font-medium text-wa-text-primary transition-colors hover:border-wa-green hover:bg-wa-green/10 disabled:opacity-50"
          >
            Alle Chats laden
          </button>
          <button
            type="button"
            onClick={() => setFocusMode((prev) => !prev)}
            title="Fokus-Modus: nur eine Stage anzeigen (ausgewählter Kontakt)"
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              focusMode
                ? "border-wa-green bg-wa-green/10 text-wa-green hover:bg-wa-green/20"
                : "border-wa-border bg-wa-panel-secondary text-wa-text-primary hover:border-wa-green hover:bg-wa-green/10"
            }`}
          >
            Fokus-Modus {focusMode ? "AN" : "AUS"}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleAnalyzeForContacts(
                allVisibleStageContacts,
                "Alle Stages",
                "crm-topbar-all-stages"
              );
            }}
            disabled={allVisibleStageContacts.length === 0 || !!(analyzingStage || bulkAnalyzeLabel)}
            title="Analysiert nur bei neuen Nachrichten; für vollständigen Re-Run nutze Erzwingen (Force)"
            className="rounded-lg border border-wa-green bg-wa-green/10 px-3 py-2 text-xs font-medium text-wa-green transition-colors hover:bg-wa-green/20 disabled:opacity-50"
          >
            Analyse alle Stages
          </button>
        </div>
      </header>

      {/* Pipeline board: horizontal columns */}
      <div className="flex flex-1 min-h-0 overflow-x-auto overflow-y-auto scroll-thin p-4">
        {loading && (
          <div className="flex flex-1 items-center justify-center gap-2">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-wa-green border-t-transparent" />
            <span className="text-sm text-wa-text-secondary">Lade Pipeline…</span>
          </div>
        )}
        {error && !loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4">
            <p className="text-sm text-red-400">{error.message}</p>
            <button
              type="button"
              onClick={() => {
                void reloadAllChatsWithFeedback();
              }}
              title="Pipeline und Chats erneut laden"
              className="text-sm text-wa-green hover:underline"
            >
              Erneut versuchen
            </button>
          </div>
        )}
        {!loading && !error && (
          <>
        {/* Stage columns */}
        {visibleStages.map((stage) => (
          <div
            key={stage}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              e.currentTarget.dataset.droppable = "true";
              setDragOverStage(stage);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOverStage(null);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverStage(null);
              handleDrop(stage);
            }}
            className={`flex min-h-[200px] w-[280px] shrink-0 flex-col rounded-lg border-2 transition-colors ${
              dragOverStage === stage
                ? "border-wa-green bg-wa-green/5"
                : "border-wa-border bg-wa-panel/80"
            }`}
          >
            <div
              className="flex items-center justify-between border-b border-wa-border px-3 py-2"
              onContextMenu={(e) => {
                e.preventDefault();
                setStageContextMenu({ x: e.clientX, y: e.clientY, stage });
              }}
              title={`Stage: ${stage}. Rechtsklick: Analyse läuft nur bei neuen Nachrichten; Erzwingen (Force) ignoriert das.`}
            >
              <span className="text-sm font-semibold text-wa-text-primary">
                {stage}
              </span>
              <span className="rounded bg-wa-panel-secondary px-2 py-0.5 text-xs text-wa-text-secondary">
                {sortedContactsByStage[stage].length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {sortedContactsByStage[stage].map((contact) => {
                const meta = getContactDisplayMeta(contact, chatById, lastActivityByChatId);
                const analysis = getFirstCachedAnalysisForContact(contact, cachedAnalysisByChatId);
                const suggestionPack = getNextMessageSuggestionsForContact(
                  contact,
                  cachedAnalysisByChatId
                );
                const isSelected = selectedContactIds.includes(contact.id);
                const isChatFocused = contact.chats.some((ch) => ch.chatId === focusChatId);
                return (
                  <div
                    key={contact.id}
                    draggable
                    onDragStart={(e) => {
                      const dragIds = selectedContactIds.includes(contact.id)
                        ? selectedContactIds
                        : [contact.id];
                      if (!selectedContactIds.includes(contact.id)) {
                        setSelectedContactIds([contact.id]);
                      }
                      setDraggedContactIds(dragIds);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", dragIds.join(","));
                    }}
                    onDragEnd={() => {
                      setDraggedContactIds([]);
                      setDragOverStage(null);
                      lastDragEndedAtRef.current = Date.now();
                    }}
                    onClick={(e) => {
                      // Ignore selection clicks during/shortly after drag and drop.
                      if (draggedContactIds.length > 0 || Date.now() - lastDragEndedAtRef.current < 250) return;
                      if (e.shiftKey) {
                        setSelectedContactIds((prev) =>
                          prev.includes(contact.id)
                            ? prev.filter((id) => id !== contact.id)
                            : [...prev, contact.id]
                        );
                      } else {
                        setSelectedContactIds([contact.id]);
                      }
                      setSelectedContact(contact);
                      onContactSelect?.(contact.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContactContextMenu({ x: e.clientX, y: e.clientY, contact });
                    }}
                    title={`${meta.name} · Klick = Details, Shift+Klick = Mehrfachauswahl, Rechtsklick = Menü, Ziehen = Stage ändern`}
                    className={`cursor-grab active:cursor-grabbing rounded-lg border bg-wa-panel-secondary p-3 shadow-sm transition-shadow hover:shadow ${
                      isSelected || isChatFocused
                        ? "border-wa-green ring-1 ring-wa-green/30"
                        : "border-wa-border hover:border-wa-border"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 overflow-hidden rounded-full bg-wa-input-bg">
                        {meta.image ? (
                          <img
                            src={meta.image}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="flex h-full w-full items-center justify-center text-sm text-wa-text-secondary">
                            {(meta.name || "?").slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-wa-text-primary">
                          {meta.name}
                        </p>
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {contact.chats.map((ch) => {
                            const acc = accountById(ch.accountId);
                            const net = ch.network ?? (acc as BeeperAccount | undefined)?.network;
                            return (
                              <span
                                key={ch.chatId}
                                className="rounded bg-wa-input-bg px-1.5 py-0.5 text-[10px] text-wa-text-secondary"
                              >
                                {getNetworkLabel(net)}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {meta.followUpCount >= 1 && (
                        <span
                          className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
                          title={`${meta.followUpCount} Follow-up(s) ohne Antwort`}
                        >
                          {meta.followUpCount} FUP{meta.followUpCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {analysis?.branche && (
                        <span
                          className="rounded bg-wa-green/15 px-1.5 py-0.5 text-[10px] text-wa-green"
                          title={analysis.branche}
                        >
                          {analysis.branche.length > 24 ? `${analysis.branche.slice(0, 24)}…` : analysis.branche}
                        </span>
                      )}
                      {(() => {
                        const kaufkraftLabel = formatKaufkraftValue(analysis?.kaufkraft);
                        if (!kaufkraftLabel) return null;
                        return (
                          <span
                            className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-600 dark:text-sky-400"
                            title="Kaufkraft aus AI-Analyse"
                          >
                            Kaufkraft {kaufkraftLabel}
                          </span>
                        );
                      })()}
                      {suggestionPack && (
                        <span
                          className="rounded bg-wa-green/20 px-1.5 py-0.5 text-[10px] font-medium text-wa-green"
                          title="KI-Antwortvorschläge im Detailbereich – ein Klick zum Senden"
                        >
                          Antwort-Idee
                        </span>
                      )}
                      {meta.lastTs && (
                        <span
                          className="rounded bg-wa-panel px-1.5 py-0.5 text-[10px] text-wa-text-secondary"
                          title={formatDateTime(meta.lastTs)}
                        >
                          Zuletzt: {formatRelativeTime(meta.lastTs)}
                        </span>
                      )}
                    </div>
                    {(meta.lastTs || meta.preview) && (
                      <p className="mt-1 line-clamp-2 text-xs text-wa-text-secondary">
                        {meta.preview || formatTime(meta.lastTs)}
                      </p>
                    )}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-wa-text-secondary">
                      <span title={formatDateTime(meta.lastFromMe)}>
                        Du: {formatTime(meta.lastFromMe ?? undefined) || "—"}
                      </span>
                      <span title={formatDateTime(meta.lastFromThem)}>
                        Sie: {formatTime(meta.lastFromThem ?? undefined) || "—"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
          </>
        )}
      </div>

      {/* Stage context menu: right-click on column header */}
      {stageContextMenu && (
        <div
          className="fixed z-50 min-w-[200px] rounded-lg border border-wa-border bg-wa-panel py-1 shadow-lg"
          style={{ left: stageContextMenu.x, top: stageContextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setStageContextMenu(null);
              void handleAnalyzeStageForColumn(stageContextMenu.stage);
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Analyse für alle Kontakte starten (nur neue Nachrichten)
          </button>
          <button
            type="button"
            onClick={() => {
              setStageContextMenu(null);
              void handleAnalyzeStageForColumn(stageContextMenu.stage, true);
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Analyse erzwingen (Force, auch ohne neue Nachricht)
          </button>
          <button
            type="button"
            onClick={() => {
              setStageContextMenu(null);
              void reloadAllChatsWithFeedback();
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Alle Chats neu laden
          </button>
        </div>
      )}

      {/* Contact context menu: right-click on contact card */}
      {contactContextMenu && (
        <div
          className="fixed z-50 min-w-[200px] rounded-lg border border-wa-border bg-wa-panel py-1 shadow-lg"
          style={{ left: contactContextMenu.x, top: contactContextMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              setSelectedContactIds([contactContextMenu.contact.id]);
              setSelectedContact(contactContextMenu.contact);
              onContactSelect?.(contactContextMenu.contact.id);
              setContactContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Nur diesen auswählen
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedContactIds((prev) =>
                prev.includes(contactContextMenu.contact.id)
                  ? prev
                  : [...prev, contactContextMenu.contact.id]
              );
              setContactContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Zur Auswahl hinzufügen
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedContactIds((prev) =>
                prev.filter((id) => id !== contactContextMenu.contact.id)
              );
              setContactContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Aus Auswahl entfernen
          </button>
          <button
            type="button"
            onClick={() => {
              const stage = (contactContextMenu.contact.stage ?? "Unzugeordnet") as CrmStage;
              const ids = sortedContactsByStage[stage].map((c) => c.id);
              setSelectedContactIds(ids);
              setContactContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Alle in dieser Stage auswählen
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedContactIds([]);
              setContactContextMenu(null);
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Auswahl leeren
          </button>
          <div className="mx-2 my-1 border-t border-wa-border" />
          <div className="group relative">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
              title="Kontakt in eine andere Stage verschieben"
            >
              <span>Verschiebe nach</span>
              <span className="text-xs text-wa-text-secondary">▶</span>
            </button>
            <div className="invisible pointer-events-none absolute left-full top-0 ml-1 min-w-[180px] rounded-lg border border-wa-border bg-wa-panel py-1 opacity-0 shadow-lg transition-opacity duration-100 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100">
              {CRM_STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => {
                    const contextContactId = contactContextMenu.contact.id;
                    const targetIds =
                      selectedContactIds.length > 1 && selectedContactIds.includes(contextContactId)
                        ? selectedContactIds
                        : [contextContactId];
                    moveContactsToStage(targetIds, stage);
                  }}
                  className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
                >
                  {stage}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setContactContextMenu(null);
              void handleAnalyzeForContacts(
                [contactContextMenu.contact],
                contactContextMenu.contact.displayName || "Kontakt",
                "crm-contact-card-context"
              );
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Analyse starten (nur neue Nachrichten)
          </button>
          <button
            type="button"
            onClick={() => {
              setContactContextMenu(null);
              void handleAnalyzeForContacts(
                [contactContextMenu.contact],
                contactContextMenu.contact.displayName || "Kontakt",
                "crm-contact-card-context-force",
                true
              );
            }}
            className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
          >
            Analyse erzwingen (Force, auch ohne neue Nachricht)
          </button>
          {selectedContactIds.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => {
                  setContactContextMenu(null);
                  const selected = contacts.filter((c) => selectedContactIds.includes(c.id));
                  void handleAnalyzeForContacts(selected, "Ausgewählte", "crm-contact-card-multi");
                }}
                className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
              >
                Analyse für {selectedContactIds.length} Kontakte starten (nur neue Nachrichten)
              </button>
              <button
                type="button"
                onClick={() => {
                  setContactContextMenu(null);
                  const selected = contacts.filter((c) => selectedContactIds.includes(c.id));
                  void handleAnalyzeForContacts(
                    selected,
                    "Ausgewählte",
                    "crm-contact-card-multi-force",
                    true
                  );
                }}
                className="w-full px-4 py-2 text-left text-sm text-wa-text-primary hover:bg-wa-green/10"
              >
                Analyse für {selectedContactIds.length} erzwingen (Force, auch ohne neue Nachricht)
              </button>
            </>
          )}
        </div>
      )}

      {/* Progress when analyzing (stage column or selected contacts) */}
      {(analyzingStage || bulkAnalyzeLabel) && analyzeStageProgress && (
        <div className="fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 flex-col gap-1 rounded-lg border border-wa-border bg-wa-panel px-4 py-2 shadow-lg">
          <p className="text-sm text-wa-text-primary">
            Analysiere {analyzingStage ?? bulkAnalyzeLabel}: {analyzeStageProgress.current}/{analyzeStageProgress.total}
            {analyzeStageProgress.currentContactName ? ` – ${analyzeStageProgress.currentContactName}` : ""}
          </p>
          {analyzeStageStep && (
            <p className="text-xs text-wa-text-secondary">{analyzeStageStep}</p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={cancelAnalyzeStage}
              title="Analyse stoppen (bereits erstellte Analysen bleiben erhalten)"
              className="shrink-0 rounded border border-wa-border bg-wa-panel-secondary px-2 py-1 text-sm font-medium text-wa-text-primary transition-colors hover:bg-wa-panel"
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {(isReloadingChats || reloadFeedback) && (
        <div className="fixed bottom-4 right-4 z-40 rounded-lg border border-wa-border bg-wa-panel px-3 py-2 shadow-lg">
          <p
            className={`text-sm ${
              reloadFeedback?.type === "error"
                ? "text-red-400"
                : reloadFeedback?.type === "success"
                  ? "text-wa-green"
                  : "text-wa-text-primary"
            }`}
          >
            {reloadFeedback?.message ?? "Alle Chats werden neu geladen…"}
          </p>
          {!isReloadingChats && reloadFeedback && (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setReloadFeedback(null)}
                className="rounded border border-wa-border bg-wa-panel-secondary px-2 py-1 text-xs text-wa-text-primary hover:bg-wa-panel"
              >
                Schließen
              </button>
            </div>
          )}
        </div>
      )}

      {stageMoveUndo && (
        <div className="fixed bottom-4 left-4 z-40 rounded-lg border border-wa-border bg-wa-panel px-3 py-2 shadow-lg">
          <p className="text-sm text-wa-text-primary">
            {stageMoveUndo.contactIds.length} Kontakt
            {stageMoveUndo.contactIds.length !== 1 ? "e" : ""} nach {stageMoveUndo.targetStage} verschoben.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={undoLastStageMove}
              className="rounded border border-wa-green bg-wa-green/10 px-2 py-1 text-xs font-medium text-wa-green hover:bg-wa-green/20"
            >
              Rückgängig
            </button>
            <button
              type="button"
              onClick={() => setStageMoveUndo(null)}
              className="rounded border border-wa-border bg-wa-panel-secondary px-2 py-1 text-xs text-wa-text-primary hover:bg-wa-panel"
            >
              Schließen
            </button>
          </div>
        </div>
      )}

      {/* Right sidebar: contact detail (like Close.com deal detail) */}
      <aside
        className={`absolute right-0 top-0 flex h-full min-w-[360px] shrink-0 flex-col border-l border-wa-border bg-wa-panel shadow-lg transition-transform ${
          selectedContact ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ width: `${crmSidebarWidthPercent}%` }}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          onMouseDown={startCrmSidebarResize}
          className="absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-col-resize bg-transparent"
          title="Sidebar-Breite ziehen"
        />
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-wa-border px-2 py-1.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-wa-text-primary">Sales</p>
            <p className="text-[10px] text-wa-text-secondary">Kontakt-Detail</p>
          </div>
          {selectedContact && (
            <button
              type="button"
              onClick={() => {
                setSelectedContact(null);
                onContactSelect?.(null);
              }}
              title="Detail schließen"
              className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary hover:text-wa-text-primary"
              aria-label="Schließen"
            >
              ✕
            </button>
          )}
        </header>
        <div className="flex-1 overflow-y-auto scroll-thin px-2 py-2">
          {!selectedContact ? (
            <p className="text-sm text-wa-text-secondary">
              Wähle eine Karte in der Pipeline, um Details zu sehen und den Stage zu ändern.
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 rounded-lg border border-wa-border bg-wa-panel-secondary/40 p-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-wa-input-bg">
                  {(() => {
                    const first = selectedContact.chats[0];
                    const chat = first ? chatById(first.chatId) : null;
                    if (getAssetUrl(chat?.image)) {
                      return (
                        <img
                          src={getAssetUrl(chat!.image)!}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      );
                    }
                    return (
                      <span className="text-sm text-wa-text-secondary">
                        {(selectedContact.displayName || "?").slice(0, 1).toUpperCase()}
                      </span>
                    );
                  })()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-wa-text-primary">
                    {selectedContact.displayName || "Unbenannt"}
                  </p>
                  <p className="text-[10px] text-wa-text-secondary">
                    {selectedContact.chats.length} Kanal
                    {selectedContact.chats.length !== 1 ? "e" : ""} zugeordnet
                  </p>
                </div>
              </div>

              {(() => {
                const analysis = getFirstCachedAnalysisForContact(selectedContact, cachedAnalysisByChatId);
                if (!analysis) return null;
                return (
                  <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                      Gecachte Chat-Analyse (AI)
                    </h3>
                    <div className="space-y-1.5 rounded-lg bg-wa-panel-secondary/50 p-2 text-xs">
                      {analysis.summary && (
                        <p className="text-wa-text-primary">
                          <span className="text-wa-text-secondary">Zusammenfassung:</span> {analysis.summary}
                        </p>
                      )}
                      <p className="text-wa-text-primary">
                        <span className="text-wa-text-secondary">Branche:</span>{" "}
                        {(analysis.branche && String(analysis.branche).trim()) || "—"}
                      </p>
                      {analysis.kaufkraft && (
                        <p className="text-wa-text-primary">
                          <span className="text-wa-text-secondary">Kaufkraft:</span>{" "}
                          {formatKaufkraftValue(analysis.kaufkraft) ?? "—"}
                        </p>
                      )}
                      {analysis.wunsch && (
                        <p className="text-wa-text-primary">
                          <span className="text-wa-text-secondary">Wunsch:</span> {analysis.wunsch}
                        </p>
                      )}
                      {analysis.pain && (
                        <p className="text-wa-text-primary">
                          <span className="text-wa-text-secondary">Pain:</span> {analysis.pain}
                        </p>
                      )}
                      {analysis.stage && (
                        <p className="text-wa-text-primary">
                          <span className="text-wa-text-secondary">AI:</span> {analysis.stage}
                        </p>
                      )}
                    </div>
                  </section>
                );
              })()}

              {/* Analyse actions: single contact or selected contacts */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                  Analyse
                </h3>
                <div className="flex flex-col gap-2">
                  {selectedContactIds.length > 1 ? (
                    <>
                      <p className="text-xs text-wa-text-secondary">
                        {selectedContactIds.length} Kontakte ausgewählt (Shift+Klick in der Pipeline)
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          const selected = contacts.filter((c) => selectedContactIds.includes(c.id));
                          void handleAnalyzeForContacts(selected, "Ausgewählte", "crm-sales-sidebar-multi");
                        }}
                        disabled={!!(analyzingStage || bulkAnalyzeLabel)}
                        title="KI-Analyse für alle ausgewählten Kontakte starten"
                    className="w-full rounded-lg border border-wa-green bg-wa-green/10 py-2 text-xs font-medium text-wa-green transition-colors hover:bg-wa-green/20 disabled:opacity-50"
                      >
                        Analyse für {selectedContactIds.length} Kontakte starten
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        void handleAnalyzeForContacts(
                          [selectedContact],
                          selectedContact.displayName || "Kontakt",
                          "crm-sales-sidebar"
                        );
                      }}
                      disabled={!!(analyzingStage || bulkAnalyzeLabel)}
                      title="KI-Analyse für diesen Kontakt starten"
                      className="w-full rounded-lg border border-wa-green bg-wa-green/10 py-2 text-xs font-medium text-wa-green transition-colors hover:bg-wa-green/20 disabled:opacity-50"
                    >
                      Analyse starten
                    </button>
                  )}
                </div>
              </section>

              {(() => {
                const meta = getContactDisplayMeta(
                  selectedContact,
                  chatById,
                  lastActivityByChatId
                );
                return (
                  <section>
                    {meta.followUpCount >= 1 && (
                      <div className="mb-2 rounded-lg bg-amber-500/15 px-2 py-1.5 text-xs">
                        <span className="font-medium text-amber-600 dark:text-amber-400">
                          {meta.followUpCount} Follow-up{meta.followUpCount !== 1 ? "s" : ""} ohne Antwort
                        </span>
                      </div>
                    )}
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                      Letzter Kontakt
                    </h3>
                    <div className="space-y-1 rounded-lg bg-wa-panel-secondary/50 p-2 text-xs">
                      <p className="text-wa-text-primary">
                        <span className="text-wa-text-secondary">Du:</span>{" "}
                        {formatDateTime(meta.lastFromMe)}
                      </p>
                      <p className="text-wa-text-primary">
                        <span className="text-wa-text-secondary">Sie:</span>{" "}
                        {formatDateTime(meta.lastFromThem)}
                      </p>
                      {meta.lastTs && (
                        <p className="text-wa-text-primary">
                          <span className="text-wa-text-secondary">Aktiv:</span>{" "}
                          {formatRelativeTime(meta.lastTs)} ({formatDateTime(meta.lastTs)})
                        </p>
                      )}
                    </div>
                  </section>
                );
              })()}

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                  Stage
                </h3>
                <select
                  value={selectedContact.stage ?? "Unzugeordnet"}
                  onChange={(e) => {
                    const stage = e.target.value as CrmStage;
                    const changed = applyStageMoveWithUndo([selectedContact.id], stage);
                    if (changed) {
                      const next = getContacts().find((c) => c.id === selectedContact.id) ?? null;
                      setSelectedContact(next);
                    }
                  }}
                  title="Stage des Kontakts in der Pipeline ändern"
                  className="w-full rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-xs text-wa-text-primary focus:border-wa-green focus:outline-none"
                >
                  {CRM_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </section>

              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
                  Chats öffnen
                </h3>
                <ul className="space-y-1.5">
                  {selectedContact.chats.map((ch) => {
                    const chat = chatById(ch.chatId);
                    const label = getNetworkLabel(ch.network);
                    return (
                      <li key={ch.chatId}>
                        <div className="grid grid-cols-2 gap-1.5">
                          <button
                            type="button"
                            onClick={() => onOpenChat(ch.chatId, ch.accountId)}
                            title={`${label}-Chat in der App-Ansicht öffnen`}
                            className="w-full rounded-lg border border-wa-border bg-wa-panel-secondary/50 py-2 text-xs font-medium text-wa-text-primary transition-colors hover:border-wa-green hover:bg-wa-green/10"
                          >
                            {label} App
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              (onOpenChatWithPreference ?? onOpenChat)(ch.chatId, ch.accountId)
                            }
                            title={`${label}-Chat via Einstellung (Client/Web) öffnen`}
                            className="w-full rounded-lg border border-wa-border bg-wa-panel-secondary/50 py-2 text-xs font-medium text-wa-text-primary transition-colors hover:border-wa-green hover:bg-wa-green/10"
                            hidden={label === "Instagram"}
                          >
                            {label} Client/Web
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <p className="text-xs text-wa-text-secondary">
                Karten per Drag &amp; Drop in eine andere Spalte ziehen, um den Stage zu ändern.
              </p>
            </div>
          )}
        </div>
        {selectedContact && (
          <footer className="shrink-0 border-t border-wa-border bg-wa-panel/95 px-2 py-2 backdrop-blur-sm">
            {selectedContact.chats[0]?.chatId ? (
              <section className="mb-2">
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  onMouseDown={startMiniChatResize}
                  className="mb-1.5 h-2 cursor-row-resize rounded border border-wa-border bg-wa-panel-secondary hover:border-wa-green/70"
                  title="Mini-Chat-Hoehe ziehen"
                />
                <div style={{ height: miniChatHeightPx }} className="mb-2">
                  <CrmMiniChatView chatId={selectedContact.chats[0].chatId} fillParent />
                </div>
              </section>
            ) : null}
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
              Nächste Nachricht (Vorschläge)
            </h3>
            <p className="mb-2 text-[10px] text-wa-text-secondary">
              Shortcuts: 1/2/3 = Vorschlag senden · N = nächster Chat · O = im Client/Web öffnen
            </p>
            {selectedSuggestions.length > 0 && selectedTargetChatId ? (
              <>
                {selectedSuggestionNetworkLabel ? (
                  <p className="mb-2 text-[11px] text-wa-text-secondary">
                    Senden an: <span className="font-medium text-wa-text-primary">{selectedSuggestionNetworkLabel}</span>
                  </p>
                ) : null}
                <ul className="space-y-1.5 max-h-36 overflow-y-auto scroll-thin">
                  {selectedSuggestions.map((s, i) => {
                    const busy =
                      sendingSuggestion?.chatId === selectedTargetChatId &&
                      sendingSuggestion?.index === i;
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          disabled={sendingSuggestion !== null}
                          onClick={() =>
                            handleSendSuggestion(selectedTargetChatId, s, i, selectedContact.id)
                          }
                          title="Ein Klick: Nachricht an diesen Chat senden"
                          className="w-full rounded-lg border border-wa-green bg-wa-green/10 p-1.5 text-left text-xs font-medium leading-snug text-wa-green transition-colors hover:bg-wa-green/20 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? "Wird gesendet…" : s}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    if (!selectedContact) return;
                    jumpToNextContactInSameStage(selectedContact.id);
                  }}
                  disabled={!selectedHasNextInStage || sendingSuggestion !== null}
                  title="Zum nächsten Kontakt in dieser Stage wechseln"
                  className="mt-2 w-full rounded-lg border border-wa-border bg-wa-panel-secondary/60 py-1.5 text-xs font-medium text-wa-text-primary transition-colors hover:border-wa-green hover:bg-wa-green/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Zum nächsten Chat springen
                </button>
                {selectedSuggestionNetworkLabel === "Instagram" &&
                  selectedTargetChatId &&
                  selectedTargetAccountId && (
                    <button
                      type="button"
                      onClick={() =>
                        (onOpenChatWithPreference ?? onOpenChat)(
                          selectedTargetChatId,
                          selectedTargetAccountId
                        )
                      }
                      title="Instagram-Chat via Einstellung (Client/Web) öffnen"
                      className="mt-2 w-full rounded-lg border border-wa-border bg-wa-panel-secondary/60 py-1.5 text-xs font-medium text-wa-text-primary transition-colors hover:border-wa-green hover:bg-wa-green/10"
                    >
                      Instagram Client/Web öffnen
                    </button>
                  )}
              </>
            ) : selectedHasAnalysis ? (
              <p className="rounded-lg border border-wa-border bg-wa-panel-secondary/50 p-2 text-sm text-wa-text-secondary">
                Keine Nachrichtenvorschläge in der gespeicherten Analyse.
              </p>
            ) : (
              <p className="rounded-lg border border-wa-border bg-wa-panel-secondary/50 p-2 text-sm text-wa-text-secondary">
                Noch keine KI-Analyse für diesen Kontakt. Erst Analyse starten.
              </p>
            )}
            {sendFeedback && (
              <p
                className={`mt-2 rounded-lg px-3 py-2 text-sm ${
                  sendFeedback.type === "success"
                    ? "bg-wa-green/15 text-wa-green"
                    : "bg-red-500/15 text-red-500 dark:text-red-400"
                }`}
                role="status"
              >
                {sendFeedback.message}
              </p>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}
