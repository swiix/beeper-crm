"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BeeperMessage } from "@/lib/types";
import { getAssetUrl } from "@/lib/asset-url";
import { resolveBeeperMessagesBeforeCursor } from "@/lib/beeper-messages-cursor";

interface CrmMiniChatViewProps {
  chatId: string;
  fillParent?: boolean;
}

type MessagesApiResponse = {
  items?: BeeperMessage[];
  hasMore?: boolean;
  nextCursor?: string;
  oldestCursor?: string;
};

export function CrmMiniChatView({ chatId, fillParent = false }: CrmMiniChatViewProps) {
  const [messages, setMessages] = useState<BeeperMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(
    async (append: boolean) => {
      if (!chatId) return;
      if (append && (!hasMore || !cursor)) return;
      append ? setLoadingMore(true) : setLoading(true);
      try {
        const params = new URLSearchParams();
        if (append && cursor) {
          params.set("cursor", cursor);
          params.set("direction", "before");
        }
        const suffix = params.toString() ? `?${params.toString()}` : "";
        const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}/messages${suffix}`);
        const data = (await res.json()) as MessagesApiResponse;
        if (!res.ok) return;
        const items = Array.isArray(data.items) ? data.items : [];
        const nextCursor = resolveBeeperMessagesBeforeCursor({ ...data, items });
        setMessages((prev) => {
          if (!append) return [...items].reverse();
          return [...items].reverse().concat(prev);
        });
        setCursor(nextCursor);
        setHasMore(Boolean(data.hasMore) && Boolean(nextCursor));
      } finally {
        append ? setLoadingMore(false) : setLoading(false);
      }
    },
    [chatId, cursor, hasMore]
  );

  useEffect(() => {
    setMessages([]);
    setCursor(null);
    setHasMore(false);
    void loadPage(false);
  }, [chatId, loadPage]);

  const contentClass = useMemo(
    () => (fillParent ? "h-full min-h-0" : "h-[260px]"),
    [fillParent]
  );

  return (
    <div className={`flex flex-col rounded-lg border border-wa-border bg-wa-panel-secondary/50 ${contentClass}`}>
      <div className="flex items-center justify-between border-b border-wa-border px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-wa-text-secondary">
          Mini Chat
        </span>
        {hasMore && (
          <button
            type="button"
            onClick={() => void loadPage(true)}
            disabled={loadingMore}
            className="text-xs text-wa-green hover:underline disabled:opacity-50"
          >
            {loadingMore ? "Lade..." : "Aelter"}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-2 space-y-1.5">
        {loading && messages.length === 0 ? (
          <p className="text-xs text-wa-text-secondary">Lade Nachrichten...</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-wa-text-secondary">Keine Nachrichten.</p>
        ) : (
          messages.map((m) => {
            const text = (m.text ?? "").trim();
            return (
              <div
                key={m.id}
                className={`max-w-[92%] rounded-md px-2 py-1 text-[11px] leading-snug ${
                  m.isSender
                    ? "ml-auto bg-wa-bubble-out text-white"
                    : "mr-auto bg-wa-bubble-in text-wa-text-primary"
                }`}
                title={m.timestamp ? new Date(m.timestamp).toLocaleString("de-DE") : undefined}
              >
                {!m.isSender && m.senderName ? (
                  <p className="mb-0.5 text-[10px] text-wa-text-secondary">{m.senderName}</p>
                ) : null}
                {text || "—"}
                {(m.attachments ?? []).length > 0 && (
                  <div className="mt-0.5 space-y-0.5">
                    {(m.attachments ?? []).slice(0, 2).map((a, idx) => {
                      const src = getAssetUrl(a.srcURL ?? a.id);
                      if (!src) return null;
                      return (
                        <a
                          key={`${m.id}-att-${idx}`}
                          href={src}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[10px] underline opacity-90"
                        >
                          Anhang {idx + 1}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
