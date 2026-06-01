"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { mutate } from "swr";
import { applyFollowUpModePresets, getOpenChatWith } from "@/lib/settings";
import { loadContactsFromServer } from "@/lib/contacts";
import { CRM_ANALYSIS_UPDATED_EVENT } from "@/lib/crm-analysis-sync";
import { ensureTodoCompletionUndoShortcut } from "@/lib/todo-completion-undo";
import { buildAppUrl, viewFromPathname, type AppView } from "@/lib/app-routes";
import { ChatLayout } from "./ChatLayout";
import { CrmView } from "./CrmView";
import { KpiBoardView } from "./KpiBoardView";
import { SettingsView } from "./SettingsView";
import { TinderChatView } from "./TinderChatView";
import { TodoListView } from "./TodoListView";
import { SettingsProvider } from "./SettingsContext";

const DEFAULT_DOCUMENT_TITLE = "Beeper CRM – Instagram Akquise & Sales";
const TODO_DOCUMENT_TITLE = "Todo Chat";

const NAV_VIEWS: AppView[] = ["chat", "crm", "kpi", "tinder", "todo", "settings"];

export function AppLayout({ children: _children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const contactParam = searchParams.get("contact");

  const view = viewFromPathname(pathname);

  const [focusChatId, setFocusChatId] = useState<string | null>(null);
  const [focusAccountId, setFocusAccountId] = useState<string | null>(null);

  const updateUrl = useCallback(
    (
      v: AppView,
      accountId: string | null,
      chatId: string | null,
      contactId?: string | null,
      tab?: string | null
    ) => {
      const href = buildAppUrl({
        view: v,
        accountId,
        chatId,
        contactId,
        tab,
      });
      router.replace(href, { scroll: false });
    },
    [router]
  );

  useEffect(() => {
    const a = searchParams.get("account");
    const c = searchParams.get("chat");
    setFocusAccountId(a || null);
    setFocusChatId(c || null);
  }, [searchParams]);

  useEffect(() => {
    loadContactsFromServer();
  }, []);

  useEffect(() => {
    ensureTodoCompletionUndoShortcut();
  }, []);

  useEffect(() => {
    document.title = view === "todo" ? TODO_DOCUMENT_TITLE : DEFAULT_DOCUMENT_TITLE;
  }, [view]);

  /** Invalidate CRM analysis SWR cache when Chat/Tinder finishes analysis (CrmView may be unmounted). */
  useEffect(() => {
    const onAnalysisUpdated = () => {
      void mutate((key) => typeof key === "string" && key.startsWith("crm:analysis"));
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("contacts-synced"));
      }
    };
    window.addEventListener(CRM_ANALYSIS_UPDATED_EVENT, onAnalysisUpdated);
    return () => window.removeEventListener(CRM_ANALYSIS_UPDATED_EVENT, onAnalysisUpdated);
  }, []);

  const switchToCrm = useCallback(
    (chatId: string | null, accountId?: string | null) => {
      setFocusChatId(chatId ?? null);
      setFocusAccountId(accountId ?? null);
      updateUrl("crm", accountId ?? null, chatId ?? null, null);
    },
    [updateUrl]
  );

  const openCrmContact = useCallback(
    (contactId: string) => {
      if (!contactId?.trim()) return;
      updateUrl("crm", null, null, contactId.trim());
    },
    [updateUrl]
  );

  const openChatInAppView = useCallback(
    (chatId: string, accountId: string) => {
      setFocusChatId(chatId || null);
      setFocusAccountId(accountId || null);
      updateUrl("chat", accountId || null, chatId || null);
    },
    [updateUrl]
  );

  const navigateToFollowUpMode = useCallback(() => {
    applyFollowUpModePresets();
    setFocusChatId(null);
    setFocusAccountId(null);
    updateUrl("crm", null, null, null);
  }, [updateUrl]);

  const onCrmContactSelect = useCallback(
    (contactId: string | null) => {
      updateUrl("crm", null, null, contactId);
    },
    [updateUrl]
  );

  const switchToChat = useCallback(
    async (chatId: string, accountId: string) => {
      const openWith = getOpenChatWith();
      const chatUrl = buildAppUrl({
        view: "chat",
        accountId,
        chatId,
      });
      const absoluteChatUrl =
        typeof window !== "undefined" ? `${window.location.origin}${chatUrl}` : chatUrl;

      if (openWith === "client") {
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
        } catch (_e) {
          window.open(absoluteChatUrl, "_blank", "noopener,noreferrer");
        }
        return;
      }
      window.open(absoluteChatUrl, "_blank", "noopener,noreferrer");
    },
    []
  );

  const onChatSelectionChange = useCallback(
    (accountId: string | null, chatId: string | null) => {
      if (view !== "chat") return;
      setFocusAccountId(accountId);
      setFocusChatId(chatId);
      updateUrl("chat", accountId || null, chatId || null);
    },
    [view, updateUrl]
  );

  const chatNavHref = useMemo(
    () =>
      buildAppUrl({
        view: "chat",
        accountId: focusAccountId,
        chatId: focusChatId,
      }),
    [focusAccountId, focusChatId]
  );

  const viewNavHref = useCallback(
    (v: Exclude<AppView, "chat">) =>
      buildAppUrl({
        view: v,
        contactId: v === "crm" ? contactParam : null,
      }),
    [contactParam]
  );

  const navPillClass = (active: boolean) =>
    `inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium no-underline transition-colors ${
      active ? "bg-wa-green text-white" : "text-wa-text-secondary hover:text-wa-text-primary"
    }`;

  const navLabels: Record<AppView, string> = {
    chat: "Chat",
    crm: "CRM",
    kpi: "KPI",
    tinder: "TinderChat",
    todo: "Todo Chat",
    settings: "Einstellungen",
  };

  const navTitles: Record<AppView, string> = {
    chat: "Zur Chat-Ansicht wechseln",
    crm: "Zur Pipeline- und Kontaktansicht wechseln",
    kpi: "KPI Board und Follow-up-Queue",
    tinder: "TinderChat – Chats wie Tinder durchgehen",
    todo: "Todo Chat – ToDos aus Chats extrahieren und verwalten",
    settings: "Einstellungen öffnen",
  };

  return (
    <SettingsProvider>
      <div className="flex h-screen flex-col bg-wa-chat-bg">
        <header className="flex h-12 shrink-0 items-center gap-1 border-b border-wa-border bg-wa-panel px-4">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-wa-green text-white text-sm font-semibold"
            title="Beeper CRM – Start"
          >
            B
          </div>
          <span className="mr-6 text-base font-medium text-wa-text-primary" title="Beeper CRM">
            Beeper CRM
          </span>
          <nav className="flex gap-0.5 rounded-lg bg-wa-panel-secondary/80 p-0.5">
            {NAV_VIEWS.map((v) => (
              <Link
                key={v}
                href={v === "chat" ? chatNavHref : viewNavHref(v)}
                prefetch={false}
                scroll={false}
                title={navTitles[v]}
                className={navPillClass(view === v)}
              >
                {navLabels[v]}
              </Link>
            ))}
          </nav>
        </header>

        <div key={view} className="flex-1 min-h-0 overflow-hidden">
          {view === "chat" && (
            <ChatLayout
              initialChatId={focusChatId}
              initialAccountId={focusAccountId}
              onSwitchToCrm={switchToCrm}
              onSelectionChange={onChatSelectionChange}
            />
          )}
          {view === "crm" && (
            <CrmView
              focusChatId={focusChatId}
              initialContactId={contactParam || null}
              onOpenChat={openChatInAppView}
              onOpenChatWithPreference={switchToChat}
              onContactSelect={onCrmContactSelect}
            />
          )}
          {view === "kpi" && (
            <KpiBoardView
              onOpenChat={openChatInAppView}
              onOpenCrmContact={openCrmContact}
              onFollowUpMode={navigateToFollowUpMode}
            />
          )}
          {view === "tinder" && <TinderChatView onOpenChat={switchToChat} />}
          {view === "todo" && <TodoListView onOpenChat={switchToChat} />}
          {view === "settings" && <SettingsView />}
        </div>
      </div>
    </SettingsProvider>
  );
}
