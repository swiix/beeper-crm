"use client";

import { useEffect, useMemo, useState } from "react";
import type { TodoWorkMode } from "@/lib/todo-work-mode";

export type TodoCommandAction = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

type TodoCommandPaletteProps = {
  open: boolean;
  onClose: () => void;
  actions: TodoCommandAction[];
};

export function TodoCommandPalette({ open, onClose, actions }: TodoCommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) => a.label.toLowerCase().includes(q) || (a.hint?.toLowerCase().includes(q) ?? false)
    );
  }, [actions, query]);

  if (!open) return null;

  return (
    <div
      className="tg-overlay fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="tg-modal w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="search"
          autoFocus
          placeholder="Aktion suchen…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && filtered[0]) {
              filtered[0].run();
              onClose();
            }
          }}
          className="tg-input w-full rounded-none border-0 border-b border-[rgb(var(--tg-border))] bg-transparent px-4 py-3 text-sm focus:ring-0"
        />
        <ul className="max-h-64 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <li className="px-4 py-2 text-sm text-wa-text-secondary">Keine Treffer</li>
          )}
          {filtered.map((action) => (
            <li key={action.id}>
              <button
                type="button"
                onClick={() => {
                  action.run();
                  onClose();
                }}
                className="flex w-full flex-col px-4 py-2 text-left hover:bg-wa-green/10"
              >
                <span className="text-sm font-medium text-wa-text-primary">{action.label}</span>
                {action.hint && <span className="text-xs text-wa-text-secondary">{action.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export const WORK_MODE_LABELS: Record<TodoWorkMode, string> = {
  inbox: "Inbox",
  review: "Review",
  bulk: "Bulk",
};
