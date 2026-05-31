"use client";

import { useEffect, useRef } from "react";
import type { BeeperChat } from "@/lib/types";
import { getAssetUrl } from "@/lib/asset-url";

interface ChatListProps {
  chats: BeeperChat[];
  selectedChat: BeeperChat | null;
  onSelect: (chat: BeeperChat) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  noAccountSelected?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** When "waiting" or "unanswered", show relative-time badge (e.g. "vor 2 Tagen") on each chat */
  chatListFilter?: "all" | "waiting" | "unanswered";
  /** Optional: follow-up count per chat (consecutive messages from me without reply). Show as "(1 FUP)" / "(2 FUPs)" badge. */
  followUpCountByChatId?: Record<string, number>;
  /** When true, show "Archiv" badge on archived chats. */
  showArchivedChats?: boolean;
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
    if (sameDay) return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  } catch {
    return "";
  }
}

/** Relative time in German for filter badges: "vor X Min." / "vor X Std." / "vor X Tagen" / "vor X Wochen" */
function formatRelativeTime(iso?: string): string {
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

export function ChatList({
  chats,
  selectedChat,
  onSelect,
  loading,
  error,
  onRetry,
  noAccountSelected = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  chatListFilter = "all",
  followUpCountByChatId,
  showArchivedChats = false,
}: ChatListProps) {
  const scrollRootRef = useRef<HTMLUListElement>(null);
  const loadMoreSentinelRef = useRef<HTMLLIElement>(null);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);
  const loadingMoreRef = useRef(loadingMore);
  hasMoreRef.current = hasMore;
  onLoadMoreRef.current = onLoadMore;
  loadingMoreRef.current = loadingMore;

  // Hooks must run unconditionally; previous early returns before useEffect broke the rules of hooks.
  useEffect(() => {
    if (noAccountSelected || loading || error || chats.length === 0) return;
    const root = scrollRootRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const [e] = entries;
        if (!e?.isIntersecting) return;
        if (hasMoreRef.current && onLoadMoreRef.current && !loadingMoreRef.current) {
          onLoadMoreRef.current();
        }
      },
      { root, rootMargin: "160px 0px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [noAccountSelected, loading, error, chats.length, hasMore, onLoadMore]);

  if (noAccountSelected) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-wa-text-secondary">
        <p className="text-sm">Wähle links einen Kontakt.</p>
        <p className="mt-1 text-xs">Danach erscheinen hier die Chats.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-wa-green border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-red-400">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-sm text-wa-green hover:underline"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (!chats.length) {
    const filterLabel =
      chatListFilter === "waiting"
        ? " (Warte auf Antwort)"
        : chatListFilter === "unanswered"
          ? " (Nicht geantwortet)"
          : "";
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-wa-text-secondary">
        Keine Chats{filterLabel} für diesen Account.
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-2 border-b border-wa-border px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-wa-text-secondary">
          Chats
        </span>
        <span className="rounded bg-wa-input-bg px-1.5 py-0.5 text-xs text-wa-text-secondary">
          {chats.length}
          {hasMore ? "+" : ""}
        </span>
      </div>
      <ul ref={scrollRootRef} className="flex-1 overflow-y-auto scroll-thin flex flex-col min-h-0">
        {chats.map((chat) => {
          const last = chat.lastMessage ?? chat.lastActivity;
          const preview =
            (chat.lastMessage as { text?: string })?.text ||
            (typeof last === "string" ? last : "");
          const lastTs = (chat.lastMessage as { timestamp?: string })?.timestamp ?? chat.lastActivity;
          const time = formatTime(lastTs);
          const relativeTime = (chatListFilter === "waiting" || chatListFilter === "unanswered") && lastTs
            ? formatRelativeTime(lastTs)
            : null;
          const isSelected = selectedChat?.id === chat.id;
          const chatTitle = [
            chat.name || "Unbenannter Chat",
            time && `Zuletzt ${time}`,
            relativeTime && (chatListFilter === "waiting" ? `Warte seit ${relativeTime}` : `Nicht geantwortet seit ${relativeTime}`),
            preview ? `„${preview.slice(0, 60)}${preview.length > 60 ? "…" : ""}"` : null,
          ].filter(Boolean).join(" · ");
          return (
            <li key={chat.id}>
              <button
                type="button"
                onClick={() => onSelect(chat)}
                title={chatTitle}
                className={`flex w-full items-center gap-3 border-b border-wa-border/50 px-4 py-3 text-left transition-colors ${
                  isSelected
                    ? "bg-wa-panel-secondary"
                    : "hover:bg-wa-panel-secondary/70"
                }`}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-wa-input-bg">
                  {getAssetUrl(chat.image) ? (
                    <img
                      src={getAssetUrl(chat.image)!}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-lg text-wa-text-secondary">
                      {(chat.name || chat.id).slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium text-wa-text-primary">
                      {chat.name || "Unbenannter Chat"}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {showArchivedChats && chat.isArchived && (
                        <span
                          className="rounded bg-wa-text-secondary/20 px-1.5 py-0.5 text-[10px] font-medium text-wa-text-secondary"
                          title="Archivierter Chat"
                        >
                          Archiv
                        </span>
                      )}
                      {followUpCountByChatId?.[chat.id] != null && followUpCountByChatId[chat.id] >= 1 && (
                        <span
                          className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600"
                          title={`${followUpCountByChatId[chat.id]} Follow-up(s) ohne Antwort`}
                        >
                          ({followUpCountByChatId[chat.id]} FUP{followUpCountByChatId[chat.id] !== 1 ? "s" : ""})
                        </span>
                      )}
                      {relativeTime && (
                        <span
                          className="rounded bg-wa-green/20 px-1.5 py-0.5 text-[10px] font-medium text-wa-green"
                          title={chatListFilter === "waiting" ? `Letzte Nachricht von dir ${relativeTime}` : `Letzte Nachricht vom Kontakt ${relativeTime}`}
                        >
                          {relativeTime}
                        </span>
                      )}
                      {time && !relativeTime && (
                        <span className="text-xs text-wa-text-secondary">
                          {time}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="truncate text-sm text-wa-text-secondary">
                    {preview || "—"}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
        {hasMore && onLoadMore && (
          <li ref={loadMoreSentinelRef} className="border-t border-wa-border/50 p-2">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
              title="Weitere ältere Chats laden"
              className="w-full rounded-lg bg-wa-panel-secondary py-2.5 text-sm font-medium text-wa-text-secondary hover:bg-wa-border disabled:opacity-50"
            >
              {loadingMore ? "Laden…" : "Ältere Chats laden"}
            </button>
          </li>
        )}
      </ul>
    </>
  );
}
