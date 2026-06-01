"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TodoSuggestionItem } from "@/lib/todo-db";
import { formatDueDateTimeRelative, suggestionDueToDateTime } from "@/lib/due-datetime";

export type TriageQueueItem = {
  chatId: string;
  chatName: string;
  suggestion: TodoSuggestionItem;
  indexInChat: number;
};

type TodoSuggestionTriageProps = {
  items: TriageQueueItem[];
  onAccept: (item: TriageQueueItem) => void | Promise<void>;
  onReject: (item: TriageQueueItem) => void;
  onAcceptAllInChat: (chatId: string) => void | Promise<void>;
};

export function buildTriageQueue(
  suggestionsByChat: Record<string, TodoSuggestionItem[]>,
  chatNameById: Map<string, string>
): TriageQueueItem[] {
  const out: TriageQueueItem[] = [];
  for (const [chatId, list] of Object.entries(suggestionsByChat)) {
    const chatName = chatNameById.get(chatId) ?? chatId.slice(0, 8);
    list.forEach((suggestion, indexInChat) => {
      out.push({ chatId, chatName, suggestion, indexInChat });
    });
  }
  return out;
}

export function TodoSuggestionTriage({
  items,
  onAccept,
  onReject,
  onAcceptAllInChat,
}: TodoSuggestionTriageProps) {
  const [cursor, setCursor] = useState(0);
  const current = items[cursor];

  useEffect(() => {
    if (cursor >= items.length && items.length > 0) setCursor(items.length - 1);
    if (items.length === 0) setCursor(0);
  }, [items.length, cursor]);

  const dueLabel = useMemo(() => {
    if (!current?.suggestion) return null;
    const dt = suggestionDueToDateTime(current.suggestion.due);
    return formatDueDateTimeRelative(dt);
  }, [current]);

  const goNext = useCallback(() => {
    setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)));
  }, [items.length]);

  const handleReject = useCallback(() => {
    if (!current) return;
    onReject(current);
    if (cursor >= items.length - 1 && cursor > 0) setCursor((c) => c - 1);
  }, [current, cursor, items.length, onReject]);

  const handleAccept = useCallback(async () => {
    if (!current) return;
    await onAccept(current);
    if (cursor >= items.length - 1 && cursor > 0) setCursor((c) => c - 1);
  }, [current, cursor, items.length, onAccept]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === "j" || k === "arrowleft") {
        e.preventDefault();
        handleReject();
      } else if (k === "k" || k === "arrowright") {
        e.preventDefault();
        void handleAccept();
      } else if (k === "a" && current) {
        e.preventDefault();
        void onAcceptAllInChat(current.chatId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, handleAccept, handleReject, onAcceptAllInChat]);

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-wa-text-secondary">
        Keine Vorschläge in der Triage-Warteschlange.
      </p>
    );
  }

  if (!current) return null;

  return (
    <div className="flex flex-col items-center py-4">
      <p className="mb-3 text-xs text-wa-text-secondary">
        {cursor + 1} / {items.length} · <span className="font-medium text-wa-text-primary">{current.chatName}</span>
      </p>
      <div className="w-full max-w-md rounded-xl border border-wa-border bg-wa-panel-secondary/60 p-5 shadow-sm">
        <p className="text-base font-semibold text-wa-text-primary">{current.suggestion.title}</p>
        {dueLabel && <p className="mt-1 text-sm text-wa-text-secondary">Fällig: {dueLabel}</p>}
        {current.suggestion.notes?.trim() && (
          <p className="mt-2 line-clamp-4 text-sm text-wa-text-secondary">{current.suggestion.notes.trim()}</p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={handleReject}
          title="Ablehnen (J / ←)"
          className="rounded-lg border border-red-400/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-700 dark:text-red-300"
        >
          Ablehnen (J)
        </button>
        <button
          type="button"
          onClick={() => void handleAccept()}
          title="Annehmen (K / →)"
          className="rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Annehmen (K)
        </button>
        <button
          type="button"
          onClick={() => void onAcceptAllInChat(current.chatId)}
          title="Alle Vorschläge dieses Chats annehmen (A)"
          className="rounded-lg border border-wa-border bg-wa-panel-secondary px-3 py-2 text-xs font-medium text-wa-text-primary"
        >
          Alle aus Chat (A)
        </button>
      </div>
      <p className="mt-3 text-[10px] text-wa-text-secondary">J ablehnen · K annehmen · A alle aus diesem Chat</p>
      {cursor < items.length - 1 && (
        <button type="button" onClick={goNext} className="mt-2 text-xs text-wa-text-secondary underline">
          Überspringen ohne Aktion
        </button>
      )}
    </div>
  );
}
