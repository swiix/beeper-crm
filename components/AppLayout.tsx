"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { mutate } from "swr";
import { applyFollowUpModePresets, getOpenChatWith } from "@/lib/settings";
import { loadContactsFromServer } from "@/lib/contacts";
import { CRM_ANALYSIS_UPDATED_EVENT } from "@/lib/crm-analysis-sync";
import { ensureTodoCompletionUndoShortcut } from "@/lib/todo-completion-undo";
import { ChatLayout } from "./ChatLayout";
import { CrmView } from "./CrmView";
import { KpiBoardView } from "./KpiBoardView";
import { SettingsView } from "./SettingsView";
import { TinderChatView } from "./TinderChatView";
import { TodoListView } from "./TodoListView";
import { SettingsProvider } from "./SettingsContext";

type View = "chat" | "crm" | "kpi" | "tinder" | "todo" | "settings";

const DEFAULT_DOCUMENT_TITLE = "Beeper CRM – Instagram Akquise & Sales";
const TODO_DOCUMENT_TITLE = "Todo Chat";

function viewFromParam(param: string | null): View {
  if (param === "crm" || param === "kpi" || param === "tinder" || param === "todo" || param === "settings") return param;
  return "chat";
}

export function AppLayout() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const contactParam = searchParams.get("contact");

  const [view, setViewState] = useState<View>("chat");
  const [focusChatId, setFocusChatId] = useState<string | null>(null);
  const [focusAccountId, setFocusAccountId] = useState<string | null>(null);

  const updateUrl = useCallback(
    (
      v: View,
      accountId: string | null,
      chatId: string | null,
      contactId?: string | null
    ) => {
      const params = new URLSearchParams();
      params.set("view", v);
      if (v === "chat") {
        if (accountId && accountId.trim()) params.set("account", accountId.trim());
        if (chatId && chatId.trim()) params.set("chat", chatId.trim());
      }
      if (v === "crm" && contactId !== undefined) {
        if (contactId && contactId.trim()) params.set("contact", contactId.trim());
      }
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  useEffect(() => {
    const v = viewFromParam(searchParams.get("view"));
    const a = searchParams.get("account");
    const c = searchParams.get("chat");
    setViewState(v);
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
      setViewState("crm");
      updateUrl("crm", accountId ?? null, chatId ?? null, null);
    },
    [updateUrl]
  );

  const openCrmContact = useCallback(
    (contactId: string) => {
      if (!contactId?.trim()) return;
      setViewState("crm");
      updateUrl("crm", null, null, contactId.trim());
    },
    [updateUrl]
  );

  const openChatInAppView = useCallback(
    (chatId: string, accountId: string) => {
      setFocusChatId(chatId || null);
      setFocusAccountId(accountId || null);
      setViewState("chat");
      updateUrl("chat", accountId || null, chatId || null);
    },
    [updateUrl]
  );

  const navigateToFollowUpMode = useCallback(() => {
    applyFollowUpModePresets();
    setViewState("crm");
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
          const params = new URLSearchParams();
          params.set("view", "chat");
          if (accountId?.trim()) params.set("account", accountId.trim());
          if (chatId?.trim()) params.set("chat", chatId.trim());
          const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      const params = new URLSearchParams();
      params.set("view", "chat");
      if (accountId?.trim()) params.set("account", accountId.trim());
      if (chatId?.trim()) params.set("chat", chatId.trim());
      const url = params.toString() ? `${pathname}?${params.toString()}` : pathname;
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [pathname]
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

  /**
   * Real URLs on `<Link>` (renders `<a href>`) so middle-click, right-click → “Open in new tab”,
   * and copy link work like normal browser links.
   */
  const chatNavHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("view", "chat");
    if (focusAccountId?.trim()) params.set("account", focusAccountId.trim());
    if (focusChatId?.trim()) params.set("chat", focusChatId.trim());
    return `${pathname}?${params.toString()}`;
  }, [pathname, focusAccountId, focusChatId]);

  const viewNavHref = useCallback(
    (v: Exclude<View, "chat">) => {
      const params = new URLSearchParams();
      params.set("view", v);
      if (v === "crm" && contactParam?.trim()) {
        params.set("contact", contactParam.trim());
      }
      return `${pathname}?${params.toString()}`;
    },
    [pathname, contactParam]
  );

  const navPillClass = (active: boolean) =>
    `inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium no-underline transition-colors ${
      active ? "bg-wa-green text-white" : "text-wa-text-secondary hover:text-wa-text-primary"
    }`;

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
            <Link
              href={chatNavHref}
              prefetch={false}
              scroll={false}
              title="Zur Chat-Ansicht wechseln"
              className={navPillClass(view === "chat")}
            >
              Chat
            </Link>
            <Link
              href={viewNavHref("crm")}
              prefetch={false}
              scroll={false}
              title="Zur Pipeline- und Kontaktansicht wechseln"
              className={navPillClass(view === "crm")}
            >
              CRM
            </Link>
            <Link
              href={viewNavHref("kpi")}
              prefetch={false}
              scroll={false}
              title="KPI Board und Follow-up-Queue"
              className={navPillClass(view === "kpi")}
            >
              KPI
            </Link>
            <Link
              href={viewNavHref("tinder")}
              prefetch={false}
              scroll={false}
              title="TinderChat – Chats wie Tinder durchgehen"
              className={navPillClass(view === "tinder")}
            >
              TinderChat
            </Link>
            <Link
              href={viewNavHref("todo")}
              prefetch={false}
              scroll={false}
              title="Todo Chat – ToDos aus Chats extrahieren und verwalten"
              className={navPillClass(view === "todo")}
            >
              Todo Chat
            </Link>
            <Link
              href={viewNavHref("settings")}
              prefetch={false}
              scroll={false}
              title="Einstellungen öffnen"
              className={navPillClass(view === "settings")}
            >
              Einstellungen
            </Link>
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
          {view === "tinder" && (
            <TinderChatView onOpenChat={switchToChat} />
          )}
          {view === "todo" && (
            <TodoListView onOpenChat={switchToChat} />
          )}
          {view === "settings" && <SettingsView />}
        </div>
      </div>
    </SettingsProvider>
  );
}
