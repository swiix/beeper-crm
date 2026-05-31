"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import type { BeeperAccount, BeeperChat, BeeperMessage, ContactAnalysis } from "@/lib/types";
import { getNetworkLabel } from "@/lib/types";
import { getAssetUrl } from "@/lib/asset-url";
import { getContactByChatId, updateContact, createContact } from "@/lib/contacts";
import { getAutoStageFromAnalysis, messageTextMatchesKeywords } from "@/lib/keyword-rules";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { jsonFetcher, SWR_CONFIG } from "@/lib/swr-config";
import { AccountList } from "./AccountList";
import { ChatList } from "./ChatList";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ContactCrmPanel } from "./ContactCrmPanel";
import { useSettings } from "./SettingsContext";
import { getChatViewFilter, setChatViewFilter, type ChatListViewType } from "@/lib/settings";
import { resolveBeeperMessagesBeforeCursor } from "@/lib/beeper-messages-cursor";
import { dispatchCrmAnalysisUpdated } from "@/lib/crm-analysis-sync";
import { chatMatchesSearchQuery } from "@/lib/chat-phone-search";

interface ChatLayoutProps {
  initialChatId?: string | null;
  initialAccountId?: string | null;
  onSwitchToCrm?: (chatId: string | null, accountId?: string | null) => void;
  onSelectionChange?: (accountId: string | null, chatId: string | null) => void;
}

export function ChatLayout({
  initialChatId,
  initialAccountId,
  onSwitchToCrm,
  onSelectionChange,
}: ChatLayoutProps) {
  const { settings } = useSettings();
  const initialChatIdApplied = useRef(false);
  const initialChatFetchTriedRef = useRef(false);
  const lastAutoAnalyzedChatId = useRef<string | null>(null);
  const analyzeAllCancelledRef = useRef(false);
  const analyzingControllersRef = useRef<Map<string, AbortController>>(new Map());
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<BeeperChat | null>(null);
  const [messages, setMessages] = useState<BeeperMessage[]>([]);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactAnalysis, setContactAnalysis] = useState<ContactAnalysis | null>(null);
  const [analyzingChatIds, setAnalyzingChatIds] = useState<string[]>([]);
  const [analysisErrorByChatId, setAnalysisErrorByChatId] = useState<Record<string, string>>({});
  const [messageFilterSender, setMessageFilterSender] = useState<"" | "me" | "others">("");
  const [messageFilterQuery, setMessageFilterQuery] = useState("");
  const [messageFilterMedia, setMessageFilterMedia] = useState<"" | "image" | "video" | "file" | "link">("");
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [hasMoreSearch, setHasMoreSearch] = useState(false);
  const [chatListFilter, setChatListFilter] = useState<"all" | "waiting" | "unanswered">("all");
  const [chatListFilterMinDays, setChatListFilterMinDays] = useState<number | null>(null);
  const [chatListSearchQuery, setChatListSearchQuery] = useState("");
  const [chatListView, setChatListView] = useState<ChatListViewType>("all");
  const [showArchivedChats, setShowArchivedChats] = useState(false);
  const [hideGroupChats, setHideGroupChats] = useState(false);
  const [analyzingAllChats, setAnalyzingAllChats] = useState(false);
  const [analyzeAllProgress, setAnalyzeAllProgress] = useState<{
    current: number;
    total: number;
    currentChatName?: string;
  } | null>(null);
  const [analysisStep, setAnalysisStep] = useState<string>("");
  const [analyzeAllStep, setAnalyzeAllStep] = useState<string>("");
  const [insertSuggestionText, setInsertSuggestionText] = useState<string | null>(null);
  const [loadingInitialChat, setLoadingInitialChat] = useState(false);
  const keywordChatText = useMemo(
    () =>
      messages
        .map((m) => [m.senderName, m.text].filter(Boolean).join(": "))
        .filter(Boolean)
        .join("\n"),
    [messages]
  );

  useEffect(() => {
    const saved = getChatViewFilter();
    setChatListFilter(saved.chatListFilter);
    setChatListFilterMinDays(saved.chatListFilterMinDays);
    setShowArchivedChats(saved.showArchivedChats);
    setHideGroupChats(saved.hideGroupChats);
    setChatListView(saved.chatListView);
  }, []);

  useEffect(() => {
    setChatViewFilter({
      chatListFilter,
      chatListFilterMinDays,
      showArchivedChats,
      hideGroupChats,
      chatListView,
    });
  }, [chatListFilter, chatListFilterMinDays, showArchivedChats, hideGroupChats, chatListView]);

  const ANALYSIS_STEPS = ["Lade Nachrichten…", "Transkribiere Sprachnachrichten…", "KI-Analyse…"];
  const isAnyAnalyzing = analyzingChatIds.length > 0;
  useEffect(() => {
    if (!isAnyAnalyzing) {
      setAnalysisStep("");
      return;
    }
    setAnalysisStep(ANALYSIS_STEPS[0]);
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % ANALYSIS_STEPS.length;
      setAnalysisStep(ANALYSIS_STEPS[i]);
    }, 2500);
    return () => clearInterval(id);
  }, [isAnyAnalyzing]);

  useEffect(() => {
    if (!analyzingAllChats) {
      setAnalyzeAllStep("");
      return;
    }
    setAnalyzeAllStep(ANALYSIS_STEPS[0]);
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % ANALYSIS_STEPS.length;
      setAnalyzeAllStep(ANALYSIS_STEPS[i]);
    }, 2500);
    return () => clearInterval(id);
  }, [analyzingAllChats]);

  const { data: accountsData, error: accountsError, isLoading: loadingAccounts, mutate: mutateAccounts } = useSWR<unknown>(
    "/api/accounts",
    jsonFetcher,
    SWR_CONFIG
  );
  const rawList = Array.isArray(accountsData) ? accountsData : (accountsData as { items?: unknown[] })?.items ?? [];
  const accounts: BeeperAccount[] = (rawList as Record<string, unknown>[]).map((a) => {
    const id = (a.accountID ?? a.id ?? "") as string;
    const user = a.user as Record<string, unknown> | undefined;
    return {
      ...a,
      id,
      accountID: id,
      user: user
        ? {
            ...user,
            name: (user.fullName ?? user.name) as string | undefined,
            handle: (user.username ?? user.handle) as string | undefined,
            avatar: (user.imgURL ?? user.avatar) as string | undefined,
          }
        : undefined,
    } as BeeperAccount;
  }).filter((a) => a.id.length > 0);

  const { data: accountOrderData, mutate: mutateAccountOrder } = useSWR<{ order: string[] }>(
    "/api/settings/account-order",
    jsonFetcher,
    { ...SWR_CONFIG, revalidateOnFocus: false }
  );
  const savedOrder = accountOrderData?.order ?? [];
  const sortedAccounts = useMemo(() => {
    if (savedOrder.length === 0) return accounts;
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const ordered: BeeperAccount[] = [];
    for (const id of savedOrder) {
      const acc = byId.get(id);
      if (acc) {
        ordered.push(acc);
        byId.delete(id);
      }
    }
    byId.forEach((acc) => ordered.push(acc));
    return ordered;
  }, [accounts, savedOrder]);

  const handleAccountOrderChange = useCallback(
    async (orderedIds: string[]) => {
      try {
        const res = await fetch("/api/settings/account-order", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ order: orderedIds }),
        });
        if (res.ok) await mutateAccountOrder();
      } catch {
        // persist failed, order still updated in UI until next revalidate
      }
    },
    [mutateAccountOrder]
  );

  type ChatsPage = { items?: BeeperChat[]; hasMore?: boolean; oldestCursor?: string; nextCursor?: string };
  const getChatsKey = useCallback(
    (pageIndex: number, prev: ChatsPage | null) => {
      if (!selectedAccountId) return null;
      if (pageIndex === 0) return `/api/chats?accountIDs=${encodeURIComponent(selectedAccountId)}`;
      if (!prev) return null;
      const cursor = prev.oldestCursor ?? prev.nextCursor;
      if (!cursor || prev.hasMore === false) return null;
      return `/api/chats?accountIDs=${encodeURIComponent(selectedAccountId)}&cursor=${encodeURIComponent(cursor)}&direction=before`;
    },
    [selectedAccountId]
  );
  const {
    data: chatsPages,
    size,
    setSize,
    error: chatsError,
    isLoading: loadingChats,
    isValidating: chatsValidating,
    mutate: mutateChats,
  } = useSWRInfinite<ChatsPage>(getChatsKey, jsonFetcher, SWR_CONFIG);
  const chats: BeeperChat[] = chatsPages?.flatMap((p) => p.items ?? []) ?? [];
  const hasMoreChats = (chatsPages?.length ?? 0) > 0 && (chatsPages?.[chatsPages.length - 1]?.hasMore === true);
  const loadMoreChats = useCallback(() => setSize((s) => s + 1), [setSize]);
  const loadingMoreChats = chatsValidating && chats.length > 0;

  const isWhatsAppAccount =
    accounts.find((a) => a.id === selectedAccountId)?.network?.toLowerCase() === "whatsapp";

  const filteredChats = useMemo(() => {
    let list = chats;
    switch (chatListView) {
      case "private":
        list = list.filter((chat) => !chat.isArchived && (chat.type ?? "").toLowerCase() !== "group");
        break;
      case "groups":
        list = list.filter((chat) => (chat.type ?? "").toLowerCase() === "group");
        break;
      case "archived":
        list = list.filter((chat) => !!chat.isArchived);
        break;
      default:
        break;
    }
    if (chatListFilter !== "all") {
      list = list.filter((chat) => {
        const isSender = (chat.lastMessage as { isSender?: boolean } | undefined)?.isSender;
        if (chatListFilter === "waiting") return isSender === true;
        if (chatListFilter === "unanswered") return isSender === false;
        return true;
      });
    }
    if ((chatListFilter === "waiting" || chatListFilter === "unanswered") && chatListFilterMinDays != null && chatListFilterMinDays > 0) {
      const nowMs = Date.now();
      const minMs = chatListFilterMinDays * 86_400_000;
      list = list.filter((chat) => {
        const lastTs = (chat.lastMessage as { timestamp?: string } | undefined)?.timestamp ?? chat.lastActivity;
        if (!lastTs) return false;
        const agoMs = nowMs - new Date(lastTs).getTime();
        return agoMs >= minMs;
      });
    }
    const search = chatListSearchQuery.trim();
    if (search) {
      list = list.filter((chat) =>
        chatMatchesSearchQuery(chat, search, { searchPhones: isWhatsAppAccount })
      );
    }
    return list;
  }, [
    chats,
    chatListView,
    chatListFilter,
    chatListFilterMinDays,
    chatListSearchQuery,
    isWhatsAppAccount,
  ]);

  const chatIdsForActivity = useMemo(
    () => filteredChats.slice(0, 100).map((c) => c.id),
    [filteredChats]
  );
  const { data: lastActivityData } = useSWR<Record<string, { followUpCount?: number }>>(
    chatIdsForActivity.length > 0
      ? `chat-list:last-activity:${[...chatIdsForActivity].sort().join(",")}`
      : null,
    () =>
      fetch(
        `/api/crm/last-activity?chatIds=${encodeURIComponent(chatIdsForActivity.join(","))}`
      ).then((r) => r.json()),
    { ...SWR_CONFIG, revalidateOnFocus: false }
  );
  const followUpCountByChatId = useMemo(() => {
    const map: Record<string, number> = {};
    if (!lastActivityData) return map;
    for (const [id, entry] of Object.entries(lastActivityData)) {
      map[id] = entry?.followUpCount ?? 0;
    }
    return map;
  }, [lastActivityData]);

  const { data: rules } = useSWR<{
    maxFollowUpsBeforeLost: number;
    autoLeadKeywords?: string;
    autoQualifiedKeywords?: string;
    autoLeadMessageKeywords?: string;
    analysisConcurrency?: number;
  }>("/api/settings/rules", jsonFetcher, { ...SWR_CONFIG, revalidateOnFocus: false });
  const maxFollowUpsBeforeLost = rules?.maxFollowUpsBeforeLost ?? 5;

  /** Rule: when a chat has at least maxFollowUpsBeforeLost follow-ups (e.g. 5), set contact stage to Lost.
   * Runs when the chat list is loaded and last-activity for the first 30 chats is available. */
  useEffect(() => {
    if (maxFollowUpsBeforeLost < 0) return;
    let didUpdate = false;
    for (const [chatId, count] of Object.entries(followUpCountByChatId)) {
      if (count >= maxFollowUpsBeforeLost) {
        const contact = getContactByChatId(chatId);
        if (contact && (contact.stage ?? "Unzugeordnet") !== "Lost") {
          updateContact(contact.id, { stage: "Lost" });
          didUpdate = true;
        }
      }
    }
    if (didUpdate && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("contacts-synced"));
    }
  }, [followUpCountByChatId, maxFollowUpsBeforeLost]);

  /** Rule: when one of your messages in the chat contains an auto-lead message keyword, set contact to Lead (only when Unzugeordnet). E.g. cold DMs. */
  useEffect(() => {
    if (!selectedChat?.id || messages.length === 0) return;
    const keywords = rules?.autoLeadMessageKeywords?.trim();
    if (!keywords) return;
    const contact = getContactByChatId(selectedChat.id);
    if (!contact || (contact.stage ?? "Unzugeordnet") !== "Unzugeordnet") return;
    const myMessageContainsKeyword = messages.some(
      (m) => m.isSender && messageTextMatchesKeywords(m.text, keywords)
    );
    if (myMessageContainsKeyword) updateContact(contact.id, { stage: "Lead" });
  }, [selectedChat?.id, messages, rules?.autoLeadMessageKeywords]);

  /** When a view or status filter is active and there are no matches, keep loading more pages until we find some or run out */
  useEffect(() => {
    if (filteredChats.length > 0) return;
    if (!hasMoreChats || chatsValidating) return;
    if (chatListFilter === "all" && chatListView === "all") return;
    loadMoreChats();
  }, [chatListFilter, chatListView, filteredChats.length, hasMoreChats, chatsValidating, loadMoreChats]);

  useEffect(() => {
    if (selectedAccountId) setSize(1);
  }, [selectedAccountId, setSize]);

  useEffect(() => {
    if (accounts.length === 0) return;
    if (initialAccountId && accounts.some((a) => a.id === initialAccountId)) {
      setSelectedAccountId(initialAccountId);
    } else if (!selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, initialAccountId]);

  useEffect(() => {
    if (chats.length === 0) return;
    if (initialChatId && !initialChatIdApplied.current && chats.some((c) => c.id === initialChatId)) {
      setSelectedChat(chats.find((c) => c.id === initialChatId) ?? null);
      initialChatIdApplied.current = true;
    } else if (!initialChatId) {
      initialChatIdApplied.current = false;
    }
  }, [chats, initialChatId]);

  useEffect(() => {
    if (chats.length > 0 && selectedChat && !chats.some((c) => c.id === selectedChat.id)) {
      setSelectedChat(null);
      setMessages([]);
      onSelectionChange?.(selectedAccountId ?? null, null);
    }
  }, [chats, selectedChat, selectedAccountId, onSelectionChange]);

  const loadAccounts = useCallback(() => mutateAccounts(), [mutateAccounts]);
  const loadChats = useCallback(() => mutateChats(), [mutateChats]);

  const handleSelectAccount = useCallback(
    (id: string | null) => {
      setSelectedAccountId(id);
      onSelectionChange?.(id, selectedChat?.id ?? null);
    },
    [selectedChat?.id, onSelectionChange]
  );
  const handleSelectChat = useCallback(
    (chat: BeeperChat | null) => {
      setSelectedChat(chat);
      onSelectionChange?.(selectedAccountId ?? null, chat?.id ?? null);
    },
    [selectedAccountId, onSelectionChange]
  );

  useEffect(() => {
    setError(accountsError?.message ?? chatsError?.message ?? null);
  }, [accountsError, chatsError]);

  const loadMessages = useCallback(
    async (append = false) => {
      if (!selectedChat?.id) return;
      setLoadingMessages(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (append && messagesCursor) {
          params.set("cursor", messagesCursor);
          params.set("direction", "before");
        }
        const res = await fetch(
          `/api/chats/${encodeURIComponent(selectedChat.id)}/messages${params.toString() ? `?${params}` : ""}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Messages failed");
        const items = (data.items ?? []) as BeeperMessage[];
        const contact = getContactByChatId(selectedChat.id);
        setMessages((prev) => {
          const next = append ? [...items.reverse(), ...prev] : [...items].reverse();
          if (contact && next.length > 0) {
            let lastFromMe: string | null = null;
            let lastFromThem: string | null = null;
            for (const msg of next) {
              const ts = msg.timestamp;
              if (!ts) continue;
              if (msg.isSender) {
                if (!lastFromMe || new Date(ts) > new Date(lastFromMe)) lastFromMe = ts;
              } else {
                if (!lastFromThem || new Date(ts) > new Date(lastFromThem)) lastFromThem = ts;
              }
            }
            updateContact(contact.id, {
              lastContactedByMeAt: lastFromMe ?? undefined,
              lastContactedByThemAt: lastFromThem ?? undefined,
            });
          }
          return next;
        });
        // Beeper returns items newest-first; cursor for "before" = oldest in page (see lib/beeper-messages-cursor)
        const nextCursor = resolveBeeperMessagesBeforeCursor({
          ...(data as Record<string, unknown>),
          items,
        });
        setMessagesCursor(nextCursor);
        setHasMoreMessages(!!(data.hasMore ?? (data as { has_more?: boolean }).has_more));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Fehler beim Laden der Nachrichten");
      } finally {
        setLoadingMessages(false);
      }
    },
    [selectedChat?.id, messagesCursor]
  );

  const hasMessageFilter = !!(messageFilterSender || messageFilterQuery.trim() || messageFilterMedia);

  const loadMessagesFromSearch = useCallback(
    async (append = false) => {
      if (!selectedChat?.id || !hasMessageFilter) return;
      setLoadingMessages(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("chatId", selectedChat.id);
        if (selectedChat.accountID) params.set("accountIDs", selectedChat.accountID);
        if (messageFilterSender) params.set("sender", messageFilterSender);
        if (messageFilterQuery.trim()) params.set("query", messageFilterQuery.trim());
        if (messageFilterMedia) params.set("mediaTypes", messageFilterMedia);
        params.set("limit", "20");
        if (append && searchCursor) {
          params.set("cursor", searchCursor);
          params.set("direction", "before");
        }
        const res = await fetch(`/api/messages/search?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Suche fehlgeschlagen");
        const items = (data.items ?? []) as BeeperMessage[];
        const cursor = data.oldestCursor ?? data.nextCursor ?? null;
        setMessages((prev) => (append ? [...(items.reverse()), ...prev] : [...items].reverse()));
        setSearchCursor(cursor);
        setHasMoreSearch(!!data.hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Nachrichtenfilter fehlgeschlagen");
      } finally {
        setLoadingMessages(false);
      }
    },
    [
      selectedChat?.id,
      selectedChat?.accountID,
      messageFilterSender,
      messageFilterQuery,
      messageFilterMedia,
      searchCursor,
      hasMessageFilter,
    ]
  );

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (initialAccountId && accounts.some((a) => a.id === initialAccountId)) {
      setSelectedAccountId(initialAccountId);
    }
  }, [initialAccountId, accounts]);

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  useEffect(() => {
    if (initialChatId && chats.length > 0 && !initialChatIdApplied.current) {
      const found = chats.find((c) => c.id === initialChatId);
      if (found) {
        setSelectedChat(found);
        initialChatIdApplied.current = true;
      }
    }
    if (!initialChatId) initialChatIdApplied.current = false;
  }, [initialChatId, chats]);

  useEffect(() => {
    if (!selectedChat) return;
    if (hasMessageFilter) {
      setSearchCursor(null);
      loadMessagesFromSearch(false);
    } else {
      loadMessages(false);
    }
  }, [selectedChat?.id]);

  useEffect(() => {
    if (selectedChat?.id && (messageFilterSender || messageFilterMedia)) {
      setSearchCursor(null);
      loadMessagesFromSearch(false);
    }
  }, [messageFilterSender, messageFilterMedia]);

  /** When a chat is selected, ensure it is in the CRM (create contact if not assigned). */
  useEffect(() => {
    if (!selectedChat?.id || !selectedAccountId) return;
    if (getContactByChatId(selectedChat.id)) return;
    const acc = accounts.find((a) => a.id === selectedChat.accountID);
    const network = (acc as BeeperAccount & { network?: string })?.network;
    createContact(
      selectedChat.name || "Chat",
      selectedChat.id,
      selectedChat.accountID ?? "",
      network
    );
  }, [selectedChat?.id, selectedChat?.name, selectedChat?.accountID, selectedAccountId, accounts]);

  useEffect(() => {
    if (!selectedChat?.id) return;
    lastAutoAnalyzedChatId.current = null;
    setContactAnalysis(null);
    let cancelled = false;
    fetch(`/api/analyze-chat?chatId=${encodeURIComponent(selectedChat.id)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ContactAnalysis | null) => {
        if (!cancelled && data) setContactAnalysis(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedChat?.id]);

  const handleAnalyze = useCallback(async (invokeSource?: string) => {
    if (!selectedChat?.id) return;
    const chatId = selectedChat.id;
    const controller = new AbortController();
    analyzingControllersRef.current.set(chatId, controller);
    setAnalyzingChatIds((prev) => (prev.includes(chatId) ? prev : [...prev, chatId]));
    setAnalysisErrorByChatId((prev) => {
      const next = { ...prev };
      delete next[chatId];
      return next;
    });
    try {
      const res = await fetch("/api/analyze-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId: selectedChat.id,
          contactName: selectedChat.name ?? "",
          force: true,
          source: typeof invokeSource === "string" ? invokeSource : "chat-view-crm-panel",
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Analyse fehlgeschlagen");
      if (selectedChat?.id === chatId) setContactAnalysis(data as ContactAnalysis);
      const contact = getContactByChatId(chatId);
      if (contact) {
        const currentStage = contact.stage ?? "Unzugeordnet";
        if (currentStage === "Unzugeordnet") {
          const keywordStage = getAutoStageFromAnalysis(
            data as ContactAnalysis,
            rules ?? {},
            keywordChatText
          );
          if (keywordStage) updateContact(contact.id, { stage: keywordStage });
        }
      }
      dispatchCrmAnalysisUpdated();
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setAnalysisErrorByChatId((prev) => ({
        ...prev,
        [chatId]: e instanceof Error ? e.message : "Analyse fehlgeschlagen",
      }));
    } finally {
      analyzingControllersRef.current.delete(chatId);
      setAnalyzingChatIds((prev) => prev.filter((id) => id !== chatId));
    }
  }, [selectedChat?.id, selectedChat?.name, rules, keywordChatText]);

  const cancelAnalyze = useCallback(() => {
    if (!selectedChat?.id) return;
    const ctrl = analyzingControllersRef.current.get(selectedChat.id);
    if (ctrl) ctrl.abort();
  }, [selectedChat?.id]);

  /** Auto-run AI analysis when a chat is opened (server fetches last 50 messages). */
  useEffect(() => {
    if (!selectedChat?.id) return;
    if (lastAutoAnalyzedChatId.current === selectedChat.id) return;
    lastAutoAnalyzedChatId.current = selectedChat.id;
    void handleAnalyze("chat-view-auto-on-chat-select");
  }, [selectedChat?.id, handleAnalyze]);

  const handleAnalyzeAllChats = useCallback(async () => {
    if (!selectedAccountId || filteredChats.length === 0) return;
    analyzeAllCancelledRef.current = false;
    setAnalyzingAllChats(true);
    setAnalyzeAllProgress({ current: 0, total: filteredChats.length, currentChatName: undefined });
    const acc = accounts.find((a) => a.id === selectedAccountId);
    const network = (acc as BeeperAccount & { network?: string })?.network;
    const concurrency = Math.max(1, Math.min(50, Math.round(rules?.analysisConcurrency ?? 5)));
    const items = filteredChats.filter((c) => c?.id) as BeeperChat[];
    await runWithConcurrency(concurrency, items, async (chat) => {
      if (analyzeAllCancelledRef.current) return;
      const chatName = chat.name ?? (chat as { participants?: Array<{ name?: string }> })?.participants?.[0]?.name ?? "Chat";
      setAnalyzeAllProgress((prev) =>
        prev ? { ...prev, currentChatName: chatName } : null
      );
      if (!getContactByChatId(chat.id)) {
        createContact(chat.name || "Chat", chat.id, chat.accountID ?? selectedAccountId, network);
      }
      try {
        const res = await fetch("/api/analyze-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId: chat.id,
            contactName: chat.name ?? "",
            force: true,
            source: "chat-view-bulk-visible-chats",
          }),
        });
        const data = await res.json();
        if (res.ok) {
          const contact = getContactByChatId(chat.id);
          if (contact) {
            const currentStage = contact.stage ?? "Unzugeordnet";
            if (currentStage === "Unzugeordnet") {
              const keywordStage = getAutoStageFromAnalysis(data, rules ?? {}, keywordChatText);
              if (keywordStage) updateContact(contact.id, { stage: keywordStage });
            }
          }
        }
      } catch {
        // continue
      }
      setAnalyzeAllProgress((prev) =>
        prev ? { ...prev, current: prev.current + 1, currentChatName: undefined } : null
      );
    });
    dispatchCrmAnalysisUpdated();
    setAnalyzingAllChats(false);
    setAnalyzeAllProgress(null);
    mutateChats();
  }, [selectedAccountId, filteredChats, accounts, mutateChats, rules, keywordChatText]);

  const cancelAnalyzeAllChats = useCallback(() => {
    analyzeAllCancelledRef.current = true;
  }, []);

  const goToNextChat = useCallback(() => {
    if (!selectedChat?.id || filteredChats.length === 0) return;
    const idx = filteredChats.findIndex((c) => c.id === selectedChat.id);
    if (idx < 0) return;
    const next = filteredChats[idx + 1] ?? null;
    if (next) handleSelectChat(next);
  }, [selectedChat?.id, filteredChats, handleSelectChat]);

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!selectedChat?.id || !text.trim()) return;
      try {
        const res = await fetch(`/api/chats/${encodeURIComponent(selectedChat.id)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Senden fehlgeschlagen");
        mutateChats();
        await loadMessages(false);
        mutateChats();
        const contact = getContactByChatId(selectedChat.id);
        if (contact) {
          updateContact(contact.id, {
            lastContactedByMeAt: new Date().toISOString(),
          });
          // Keep CRM panels in sync immediately after sending.
          window.dispatchEvent(new CustomEvent("contacts-synced"));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Nachricht konnte nicht gesendet werden");
      }
    },
    [selectedChat?.id, mutateChats, loadMessages]
  );

  const loadMoreMessages = useCallback(() => {
    if (loadingMessages) return;
    if (hasMessageFilter) {
      if (hasMoreSearch && searchCursor) loadMessagesFromSearch(true);
    } else {
      if (hasMoreMessages && messagesCursor) loadMessages(true);
    }
  }, [
    hasMessageFilter,
    hasMoreSearch,
    searchCursor,
    hasMoreMessages,
    messagesCursor,
    loadingMessages,
    loadMessages,
    loadMessagesFromSearch,
  ]);

  const { lastContactedByMeAt: chatLastFromMe, lastContactedByThemAt: chatLastFromThem, lastSenderIsMe } = useMemo(
    () => {
      let lastFromMe: string | null = null;
      let lastFromThem: string | null = null;
      for (const msg of messages) {
        const ts = msg.timestamp;
        if (!ts) continue;
        if (msg.isSender) {
          if (!lastFromMe || new Date(ts) > new Date(lastFromMe)) lastFromMe = ts;
        } else {
          if (!lastFromThem || new Date(ts) > new Date(lastFromThem)) lastFromThem = ts;
        }
      }
      const me = lastFromMe ?? undefined;
      const them = lastFromThem ?? undefined;
      const iWasLastSender = !!me && (!them || new Date(me) > new Date(them));
      return {
        lastContactedByMeAt: me,
        lastContactedByThemAt: them,
        lastSenderIsMe: iWasLastSender,
      };
    },
    [messages]
  );

  return (
    <div className="flex h-screen overflow-hidden bg-wa-chat-bg">
      {/* Left: Account-Bubbles (nur runde Icons) */}
      <aside className="flex w-[72px] shrink-0 flex-col items-center border-r border-wa-border bg-wa-panel py-3">
        <div
          className="mb-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-wa-green text-white font-semibold"
          title="Beeper CRM"
        >
          B
        </div>
        <AccountList
          accounts={sortedAccounts}
          selectedId={selectedAccountId}
          onSelect={handleSelectAccount}
          onOrderChange={handleAccountOrderChange}
          loading={loadingAccounts}
          error={error}
          onRetry={loadAccounts}
        />
      </aside>

      {/* Mitte: Chat-Liste mit Header (Netzwerk-Name) und Filter */}
      <aside className="flex w-[340px] shrink-0 flex-col border-r border-wa-border bg-wa-panel">
        <header className="flex shrink-0 flex-col gap-2 border-b border-wa-border bg-wa-panel-secondary px-4 py-3">
          <span
            className="truncate text-lg font-medium text-wa-text-primary"
            title={selectedAccountId ? `Chats für diesen Account` : "Account links auswählen"}
          >
            {selectedAccountId
              ? (() => {
                  const acc = accounts.find((a) => a.id === selectedAccountId);
                  const name =
                    acc?.user && typeof acc.user === "object" && "name" in acc.user
                      ? (acc.user as { name?: string }).name
                      : null;
                  return name || getNetworkLabel(acc?.network) || "Chats";
                })()
              : "Chats"}
          </span>
          <input
            type="search"
            placeholder={isWhatsAppAccount ? "Chat suchen (Name, Nummer, ID)" : "Chat suchen (Name, ID)"}
            value={chatListSearchQuery}
            onChange={(e) => setChatListSearchQuery(e.target.value)}
            className="w-full rounded border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary placeholder:text-wa-text-secondary"
            title={
              isWhatsAppAccount
                ? "Name, Chat-ID oder Telefonnummer (Leerzeichen in Nummern werden ignoriert)"
                : "Chat-Liste nach Name oder ID filtern"
            }
          />
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <select
                value={chatListView}
                onChange={(e) => setChatListView(e.target.value as ChatListViewType)}
                title="Welche Chats in der Liste anzeigen"
                className="flex-1 rounded border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary"
              >
                <option value="all">Alle (inkl. archiviert)</option>
                <option value="private">Private Chats</option>
                <option value="groups">Nur Gruppen</option>
                <option value="archived">Nur archivierte</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-wa-text-secondary shrink-0">Status:</label>
              <select
                value={chatListFilter}
                onChange={(e) => setChatListFilter(e.target.value as "all" | "waiting" | "unanswered")}
                title="Chat-Liste nach Status filtern"
                className="flex-1 rounded border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary"
              >
                <option value="all">Alle</option>
                <option value="waiting">Warte auf Antwort</option>
                <option value="unanswered">Nicht geantwortet</option>
              </select>
            </div>
          </div>
          {(chatListFilter === "waiting" || chatListFilter === "unanswered") && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-wa-text-secondary">
                {chatListFilter === "waiting" ? "Mind. keine Antwort seit:" : "Mind. nicht geantwortet seit:"}
              </label>
              <select
                value={chatListFilterMinDays != null ? String(chatListFilterMinDays) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setChatListFilterMinDays(v === "" ? null : parseInt(v, 10));
                }}
                title={chatListFilter === "waiting" ? "Nur Chats, in denen du seit mindestens X Tagen auf eine Antwort wartest" : "Nur Chats, in denen du seit mindestens X Tagen nicht geantwortet hast"}
                className="flex-1 rounded border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary"
              >
                <option value="">Alle</option>
                <option value="1">1 Tag</option>
                <option value="3">3 Tage</option>
                <option value="7">1 Woche</option>
                <option value="14">2 Wochen</option>
                <option value="30">1 Monat</option>
                <option value="90">3 Monate</option>
                <option value="180">6 Monate</option>
                <option value="365">1 Jahr</option>
                <option value="730">2 Jahre</option>
                <option value="1095">3 Jahre</option>
                <option value="1460">4 Jahre</option>
                <option value="1825">5 Jahre</option>
              </select>
            </div>
          )}
          {selectedAccountId && (
            <div className="flex items-center gap-2">
              {analyzingAllChats && analyzeAllProgress ? (
                <>
                  <div className="flex flex-1 flex-col gap-0.5">
                    <span className="text-sm text-wa-text-secondary">
                      Analysiere {analyzeAllProgress.current}/{analyzeAllProgress.total}
                      {analyzeAllProgress.currentChatName ? `: ${analyzeAllProgress.currentChatName}` : ""}
                    </span>
                    {analyzeAllStep && (
                      <span className="text-xs text-wa-text-secondary/80">{analyzeAllStep}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={cancelAnalyzeAllChats}
                    title="Analyse stoppen (bereits erstellte Analysen bleiben erhalten)"
                    className="shrink-0 rounded border border-wa-border bg-wa-panel-secondary px-2 py-1.5 text-sm font-medium text-wa-text-primary transition-colors hover:bg-wa-panel hover:border-wa-text-secondary"
                  >
                    Abbrechen
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleAnalyzeAllChats()}
                  disabled={filteredChats.length === 0}
                  title="Nur die sichtbaren Chats (nach Filter/Archiv) analysieren und ins CRM übernehmen (Kontakt anlegen falls nötig, Stage aus Analyse übernehmen)"
                  className="w-full rounded border border-wa-green bg-wa-green/10 px-2 py-1.5 text-sm font-medium text-wa-green transition-colors hover:bg-wa-green/20 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Sichtbare Chats analysieren
                </button>
              )}
            </div>
          )}
        </header>
        <ChatList
          chats={filteredChats}
          selectedChat={selectedChat}
          onSelect={handleSelectChat}
          loading={loadingChats}
          error={error}
          onRetry={() => mutateChats()}
          noAccountSelected={!selectedAccountId}
          hasMore={hasMoreChats}
          loadingMore={loadingMoreChats}
          onLoadMore={loadMoreChats}
          chatListFilter={chatListFilter}
          followUpCountByChatId={followUpCountByChatId}
          showArchivedChats={chatListView === "all" || chatListView === "archived"}
        />
      </aside>

      {/* Center: Chat */}
      <main className="flex min-h-0 flex-1 flex-col min-w-0 bg-wa-chat-bg">
        {selectedChat ? (
          <>
            <header
              className="flex h-14 shrink-0 items-center gap-3 border-b border-wa-border bg-wa-panel-secondary px-4"
              title={`Chat mit ${selectedChat.name || "Unbenannt"}`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-wa-input-bg">
                {getAssetUrl(selectedChat.image) ? (
                  <img
                    src={getAssetUrl(selectedChat.image)!}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-sm text-wa-text-secondary">
                    {(selectedChat.name || selectedChat.id).slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-wa-text-primary">
                  {selectedChat.name || "Chat"}
                </p>
                <p className="truncate text-xs text-wa-text-secondary">
                  {selectedChat.participants?.length
                    ? `${selectedChat.participants.length} Teilnehmer`
                    : selectedChat.lastMessage?.senderName || "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!selectedChat?.id) return;
                  try {
                    const res = await fetch("/api/focus", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ chatID: selectedChat.id }),
                    });
                    if (!res.ok) {
                      const data = await res.json().catch(() => ({}));
                      throw new Error((data as { error?: string })?.error || "Fehler");
                    }
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Beeper konnte nicht geöffnet werden");
                  }
                }}
                title="Diesen Chat in Beeper Desktop öffnen"
                className="shrink-0 rounded-lg border border-wa-border bg-wa-input-bg p-2 text-wa-text-secondary transition-colors hover:border-wa-green hover:bg-wa-green/10 hover:text-wa-green"
                aria-label="In Beeper öffnen"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </header>
            <div className="flex shrink-0 flex-col gap-0 border-b border-wa-border bg-wa-panel-secondary/60 px-3 py-2">
              <p className="mb-1.5 text-[10px] text-wa-text-secondary">
                Nachrichten filtern: Absender, Medientyp, Textsuche (exakte Wörter – Enter oder „Suchen“).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-wa-text-secondary">Absender:</label>
                <select
                  value={messageFilterSender}
                  onChange={(e) => setMessageFilterSender((e.target.value || "") as "" | "me" | "others")}
                  className="rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary"
                  title="Nachrichten nach Absender filtern"
                >
                  <option value="">Alle</option>
                  <option value="me">Nur ich</option>
                  <option value="others">Nur Kontakt</option>
                </select>
                <label className="ml-2 text-xs text-wa-text-secondary">Medientyp:</label>
                <select
                  value={messageFilterMedia}
                  onChange={(e) => setMessageFilterMedia((e.target.value || "") as "" | "image" | "video" | "file" | "link")}
                  className="rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary"
                  title="Nach Medien filtern"
                >
                  <option value="">Alle</option>
                  <option value="image">Bild</option>
                  <option value="video">Video</option>
                  <option value="file">Datei</option>
                  <option value="link">Link</option>
                </select>
                <input
                  type="search"
                  placeholder="Text suchen…"
                  value={messageFilterQuery}
                  onChange={(e) => setMessageFilterQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadMessagesFromSearch(false)}
                  className="min-w-[120px] rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary placeholder:text-wa-text-secondary"
                  title="Wortsuche in Nachrichten: exakte Wörter (einzeln eingeben), Enter oder Suchen-Klick startet die Suche."
                />
                <button
                  type="button"
                  onClick={() => loadMessagesFromSearch(false)}
                  disabled={!messageFilterQuery.trim() && !messageFilterSender && !messageFilterMedia}
                  className="rounded bg-wa-green/20 px-2 py-1 text-sm font-medium text-wa-green hover:bg-wa-green/30 disabled:opacity-50"
                  title="Filter anwenden / Suche ausführen"
                >
                  Suchen
                </button>
                {hasMessageFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setMessageFilterSender("");
                      setMessageFilterQuery("");
                      setMessageFilterMedia("");
                      setSearchCursor(null);
                      if (selectedChat?.id) loadMessages(false);
                    }}
                    className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-secondary hover:bg-wa-panel"
                    title="Filter zurücksetzen"
                  >
                    Zurücksetzen
                  </button>
                )}
              </div>
            </div>
            {contactAnalysis?.summary?.trim() && (
              <div className="shrink-0 border-b border-wa-border bg-amber-50/80 px-4 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">AI-Zusammenfassung</p>
                <p className="mt-1 text-sm text-amber-900">{contactAnalysis.summary.trim()}</p>
              </div>
            )}
            <MessageList
              messages={messages}
              loading={loadingMessages}
              onLoadMore={loadMoreMessages}
              hasMore={hasMessageFilter ? hasMoreSearch : hasMoreMessages}
            />
            <MessageInput
              onSend={handleSendMessage}
              disabled={loadingMessages}
              suggestions={contactAnalysis?.nextMessageSuggestions?.slice(0, 3)}
              lastSenderIsMe={lastSenderIsMe}
              autoInsertFirstSuggestion={settings.autoInsertFirstSuggestion}
              insertText={insertSuggestionText}
              onInserted={() => setInsertSuggestionText(null)}
              onShiftEnter={settings.shiftEnterJumpsToNextChat ? goToNextChat : undefined}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-wa-text-secondary">
            <div className="text-center">
              <p className="text-lg">Wähle einen Chat</p>
              <p className="mt-1 text-sm">Instagram Akquise & Sales – später mit AI-Analyse</p>
            </div>
          </div>
        )}
      </main>

      {/* Right: CRM / Contact Analysis */}
      <ContactCrmPanel
        chat={selectedChat}
        accounts={accounts}
        analysis={contactAnalysis}
        analyzing={selectedChat ? analyzingChatIds.includes(selectedChat.id) : false}
        analysisStep={analysisStep}
        analysisError={selectedChat ? (analysisErrorByChatId[selectedChat.id] ?? null) : null}
        canAnalyze={!!selectedChat?.id}
        onAnalyze={handleAnalyze}
        onCancelAnalyze={cancelAnalyze}
        onOpenInCrm={selectedChat ? () => onSwitchToCrm?.(selectedChat.id, selectedChat.accountID) : undefined}
        onSuggestionClick={(text) => setInsertSuggestionText(text)}
        onSuggestionSend={(text) => {
          if (!loadingMessages) handleSendMessage(text);
        }}
        sendDisabled={loadingMessages}
        onArchiveChat={(archived) => {
          setSelectedChat((prev) => (prev ? { ...prev, isArchived: archived } : null));
          void mutateChats(undefined, { revalidate: true });
        }}
        lastContactedByMeAt={chatLastFromMe}
        lastContactedByThemAt={chatLastFromThem}
        followUpCount={selectedChat ? (followUpCountByChatId?.[selectedChat.id] ?? 0) : 0}
      />
    </div>
  );
}
