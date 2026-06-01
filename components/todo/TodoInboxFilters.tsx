"use client";

import type { TodoInboxFilterId } from "@/lib/todo-chat-inbox-status";

const FILTER_OPTIONS: { id: TodoInboxFilterId; label: string }[] = [
  { id: "all", label: "Alle sichtbaren" },
  { id: "has_open", label: "Mit Vorschlägen" },
  { id: "stale", label: "Veraltet" },
  { id: "never", label: "Noch nicht / leer" },
];

type TodoInboxFiltersProps = {
  value: TodoInboxFilterId;
  onChange: (id: TodoInboxFilterId) => void;
};

export function TodoInboxFilters({ value, onChange }: TodoInboxFiltersProps) {
  return (
    <label className="mb-2 block text-xs text-wa-text-secondary">
      Inbox-Filter
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TodoInboxFilterId)}
        title="Chats nach Analyse-Status filtern"
        className="mt-1 w-full rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary"
      >
        {FILTER_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
