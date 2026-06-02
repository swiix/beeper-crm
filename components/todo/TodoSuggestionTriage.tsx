"use client";

import { useCallback, useEffect, useState } from "react";
import type { EditableTodoSuggestion } from "@/components/todo/TodoSuggestionInlineEditor";
import {
  TodoSuggestionTriageCard,
  type TriageEditField,
  type TriageQueueItem,
} from "@/components/todo/TodoSuggestionTriageCard";
import type { TodoSuggestionItem } from "@/lib/todo-db";

export type { TriageQueueItem };

type TodoSuggestionTriageProps = {
  items: TriageQueueItem[];
  onAccept: (item: TriageQueueItem) => void | Promise<void>;
  onReject: (item: TriageQueueItem) => void;
  onAcceptAllInChat: (chatId: string) => void | Promise<void>;
  /** Opens the source chat in a new tab (e.g. /chat). */
  onOpenChat?: (chatId: string) => void;
  onPersistSuggestion?: (item: TriageQueueItem, patch: Partial<EditableTodoSuggestion>) => void;
  onChatNameChange?: (chatId: string, chatName: string) => void;
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
  onOpenChat,
  onPersistSuggestion,
  onChatNameChange,
}: TodoSuggestionTriageProps) {
  const [cursor, setCursor] = useState(0);
  const [editingField, setEditingField] = useState<TriageEditField | null>(null);
  const current = items[cursor];

  useEffect(() => {
    if (cursor >= items.length && items.length > 0) setCursor(items.length - 1);
    if (items.length === 0) setCursor(0);
  }, [items.length, cursor]);

  const progressPct = items.length > 0 ? Math.round(((cursor + 1) / items.length) * 100) : 0;

  const goNext = useCallback(() => {
    setEditingField(null);
    setCursor((c) => Math.min(c + 1, Math.max(0, items.length - 1)));
  }, [items.length]);

  const handleReject = useCallback(() => {
    if (!current || editingField) return;
    onReject(current);
    if (cursor >= items.length - 1 && cursor > 0) setCursor((c) => c - 1);
  }, [current, cursor, items.length, onReject, editingField]);

  const handleAccept = useCallback(async () => {
    if (!current || editingField) return;
    await onAccept(current);
    if (cursor >= items.length - 1 && cursor > 0) setCursor((c) => c - 1);
  }, [current, cursor, items.length, onAccept, editingField]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingField) return;
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
  }, [current, handleAccept, handleReject, onAcceptAllInChat, editingField]);

  if (items.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-wa-text-secondary">
        Keine Vorschläge in der Triage-Warteschlange.
      </p>
    );
  }

  if (!current) return null;

  return (
    <div className="flex flex-col items-center px-2 py-4">
      <div className="mb-4 w-full max-w-md">
        <div className="mb-1.5 flex items-center justify-between text-xs text-wa-text-secondary">
          <span>
            Vorschlag <span className="font-medium text-wa-text-primary">{cursor + 1}</span> von{" "}
            {items.length}
          </span>
          <span className="tabular-nums text-wa-green">{progressPct}%</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-wa-border/60">
          <div
            className="h-full rounded-full bg-wa-green transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {onPersistSuggestion ? (
        <TodoSuggestionTriageCard
          item={current}
          editingField={editingField}
          onEditingFieldChange={setEditingField}
          onPersistSuggestion={onPersistSuggestion}
          onChatNameChange={onChatNameChange}
        />
      ) : (
        <div className="w-full max-w-md rounded-2xl border border-wa-border bg-wa-panel-secondary/60 p-5">
          <p className="text-base font-semibold text-wa-text-primary">{current.suggestion.title}</p>
        </div>
      )}

      <div className="mt-5 flex w-full max-w-md flex-wrap justify-center gap-2">
        {onOpenChat && (
          <button
            type="button"
            onClick={() => onOpenChat(current.chatId)}
            disabled={Boolean(editingField)}
            title="Chat in neuem Tab öffnen"
            className="rounded-xl border border-wa-border bg-wa-panel px-4 py-2.5 text-sm font-medium text-wa-text-primary transition hover:bg-wa-panel-secondary disabled:opacity-40"
          >
            Chat öffnen
          </button>
        )}
        <button
          type="button"
          onClick={handleReject}
          disabled={Boolean(editingField)}
          title="Ablehnen (J / ←)"
          className="rounded-xl border border-red-400/40 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-500/15 disabled:opacity-40 dark:text-red-300"
        >
          Ablehnen
          <span className="ml-1.5 hidden text-xs opacity-70 sm:inline">J</span>
        </button>
        <button
          type="button"
          onClick={() => void handleAccept()}
          disabled={Boolean(editingField)}
          title="Annehmen (K / →)"
          className="rounded-xl bg-wa-green px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-40"
        >
          Annehmen
          <span className="ml-1.5 hidden text-xs opacity-80 sm:inline">K</span>
        </button>
        <button
          type="button"
          onClick={() => void onAcceptAllInChat(current.chatId)}
          disabled={Boolean(editingField)}
          title="Alle Vorschläge dieses Chats annehmen (A)"
          className="rounded-xl border border-wa-border bg-wa-panel-secondary/80 px-3 py-2.5 text-xs font-medium text-wa-text-primary transition hover:bg-wa-panel disabled:opacity-40"
        >
          Alle aus Chat
          <span className="ml-1 opacity-70">A</span>
        </button>
      </div>

      <p className="mt-4 max-w-md text-center text-[11px] leading-relaxed text-wa-text-secondary">
        {editingField ? (
          <>Feld bearbeiten · Esc speichern &amp; schließen · Shortcuts pausiert</>
        ) : (
          <>Auf Chat, Titel, Frist oder Details tippen zum Bearbeiten · J ablehnen · K annehmen</>
        )}
      </p>

      {cursor < items.length - 1 && !editingField && (
        <button
          type="button"
          onClick={goNext}
          className="mt-2 text-xs text-wa-text-secondary underline-offset-2 hover:text-wa-text-primary hover:underline"
        >
          Überspringen ohne Aktion
        </button>
      )}
    </div>
  );
}
