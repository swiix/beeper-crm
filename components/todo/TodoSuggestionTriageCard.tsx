"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DueDatePicker } from "@/components/DueDatePicker";
import { RichTextNotes } from "@/components/RichTextNotes";
import { SuggestionNextToggle } from "@/components/todo/SuggestionNextToggle";
import type { EditableTodoSuggestion } from "@/components/todo/TodoSuggestionInlineEditor";
import type { TodoSuggestionItem } from "@/lib/todo-db";

export type TriageQueueItem = {
  chatId: string;
  chatName: string;
  suggestion: TodoSuggestionItem;
  indexInChat: number;
};
import {
  formatDueDateTimeRelative,
  suggestionDueToDateTime,
  syncDueDateFromDateTime,
  type DueDateTime,
} from "@/lib/due-datetime";

export type TriageEditField = "chat" | "title" | "due" | "notes" | "duration";

type TodoSuggestionTriageCardProps = {
  item: TriageQueueItem;
  editingField: TriageEditField | null;
  onEditingFieldChange: (field: TriageEditField | null) => void;
  onPersistSuggestion?: (item: TriageQueueItem, patch: Partial<EditableTodoSuggestion>) => void;
  onChatNameChange?: (chatId: string, chatName: string) => void;
  onOpenChat?: (chatId: string) => void;
};

const DURATION_QUICK_PICKS = [
  { label: "15 Min", hours: 0.25 },
  { label: "30 Min", hours: 0.5 },
  { label: "1 h", hours: 1 },
  { label: "1,5 h", hours: 1.5 },
  { label: "2 h", hours: 2 },
] as const;

function DurationQuickBadges({
  activeHours,
  onPick,
}: {
  activeHours: number | null;
  onPick: (hours: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Schnellauswahl Dauer">
      {DURATION_QUICK_PICKS.map((pick) => {
        const isActive = activeHours != null && Math.abs(activeHours - pick.hours) < 0.01;
        return (
          <button
            key={pick.label}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPick(pick.hours);
            }}
            className={[
              "tg-chip text-[11px]",
              isActive ? "tg-chip-active" : "",
            ].join(" ")}
          >
            {pick.label}
          </button>
        );
      })}
    </div>
  );
}

function formatEstimatedHours(suggestion: EditableTodoSuggestion): string | null {
  if (suggestion.estimated_time_hours != null) return `${suggestion.estimated_time_hours} h`;
  if (suggestion.estimated_time_minutes != null && suggestion.estimated_time_minutes > 0) {
    const h = suggestion.estimated_time_minutes / 60;
    return h < 1 ? `${suggestion.estimated_time_minutes} Min` : `${h.toFixed(1).replace(".", ",")} h`;
  }
  return null;
}

function TriageFieldShell({
  label,
  icon,
  active,
  onActivate,
  children,
  hint,
  footer,
}: {
  label: string;
  icon: string;
  active: boolean;
  onActivate: () => void;
  children: ReactNode;
  hint?: string;
  /** Rendered below the tap target (e.g. quick-pick chips). */
  footer?: ReactNode;
}) {
  if (active) {
    return (
      <div className="rounded-xl border border-wa-green/35 bg-wa-green/[0.06] px-3 py-2.5 shadow-sm ring-1 ring-wa-green/20 backdrop-blur-sm">
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-wa-green">
          <span aria-hidden>{icon}</span>
          {label}
        </div>
        {children}
        {hint && <p className="mt-1.5 text-[10px] text-wa-text-secondary">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-transparent transition hover:border-[rgb(var(--tg-border))] hover:bg-white/5">
      <button
        type="button"
        onClick={onActivate}
        className="group w-full px-3 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wa-green/40"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-wa-text-secondary group-hover:text-wa-text-primary">
            <span aria-hidden>{icon}</span>
            {label}
          </span>
          <span className="text-[10px] text-wa-text-secondary opacity-0 transition group-hover:opacity-100">
            Bearbeiten
          </span>
        </div>
        <div className="mt-1">{children}</div>
      </button>
      {footer && <div className="border-t border-wa-border/50 px-3 pb-2.5 pt-2">{footer}</div>}
    </div>
  );
}

export function TodoSuggestionTriageCard({
  item,
  editingField,
  onEditingFieldChange,
  onPersistSuggestion,
  onChatNameChange,
  onOpenChat,
}: TodoSuggestionTriageCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const durationRef = useRef<HTMLInputElement>(null);

  const suggestion = item.suggestion as EditableTodoSuggestion;
  const canEdit = Boolean(onPersistSuggestion);

  const [titleDraft, setTitleDraft] = useState(suggestion.title);
  const [notesDraft, setNotesDraft] = useState(() => suggestion.notes?.trim() ?? "");
  const [chatDraft, setChatDraft] = useState(item.chatName);
  const [dueDraft, setDueDraft] = useState<DueDateTime>(() =>
    suggestionDueToDateTime(suggestion.due, suggestion.due_time)
  );
  const [markAsNext, setMarkAsNext] = useState(() => suggestion.mark_as_next === true);
  const [hoursDraft, setHoursDraft] = useState(() => {
    if (suggestion.estimated_time_hours != null) return String(suggestion.estimated_time_hours);
    if (suggestion.estimated_time_minutes != null) {
      return String(Number((suggestion.estimated_time_minutes / 60).toFixed(2)));
    }
    return "";
  });

  useEffect(() => {
    setTitleDraft(suggestion.title);
    setNotesDraft(suggestion.notes?.trim() ?? "");
    setChatDraft(item.chatName);
    setDueDraft(suggestionDueToDateTime(suggestion.due, suggestion.due_time));
    setMarkAsNext(suggestion.mark_as_next === true);
    if (suggestion.estimated_time_hours != null) setHoursDraft(String(suggestion.estimated_time_hours));
    else if (suggestion.estimated_time_minutes != null) {
      setHoursDraft(String(Number((suggestion.estimated_time_minutes / 60).toFixed(2))));
    } else setHoursDraft("");
  }, [
    item.chatId,
    item.indexInChat,
    item.chatName,
    suggestion.title,
    suggestion.due,
    suggestion.due_time,
    suggestion.notes,
    suggestion.mark_as_next,
    suggestion.estimated_time_hours,
    suggestion.estimated_time_minutes,
  ]);

  useEffect(() => {
    onEditingFieldChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when card identity changes
  }, [item.chatId, item.indexInChat]);

  const dueLabel = formatDueDateTimeRelative(dueDraft);
  const durationLabel = formatEstimatedHours(suggestion);

  const flushTitle = useCallback(() => {
    const v = titleDraft.trim();
    if (v && v !== suggestion.title) onPersistSuggestion?.(item, { title: v });
  }, [titleDraft, suggestion.title, onPersistSuggestion, item]);

  const flushNotes = useCallback(() => {
    const v = notesDraft.trim() || null;
    if (v !== (suggestion.notes ?? null)) onPersistSuggestion?.(item, { notes: v });
  }, [notesDraft, suggestion.notes, onPersistSuggestion, item]);

  const flushChat = useCallback(() => {
    const v = chatDraft.trim();
    if (v && v !== item.chatName) onChatNameChange?.(item.chatId, v);
  }, [chatDraft, item, onChatNameChange]);

  const applyDurationHours = useCallback(
    (hours: number) => {
      const roundedHours = Number(hours.toFixed(2));
      const minutes = Math.round(roundedHours * 60);
      setHoursDraft(String(roundedHours));
      onPersistSuggestion?.(item, {
        estimated_time_minutes: minutes,
        estimated_time_hours: roundedHours,
      });
    },
    [item, onPersistSuggestion]
  );

  const activeDurationHours =
    suggestion.estimated_time_hours ??
    (suggestion.estimated_time_minutes != null
      ? Number((suggestion.estimated_time_minutes / 60).toFixed(2))
      : null);

  const flushDuration = useCallback(() => {
    const raw = hoursDraft.trim();
    const hours = raw === "" ? null : Number(raw.replace(",", "."));
    if (hours == null || Number.isNaN(hours) || hours < 0) {
      if (suggestion.estimated_time_minutes != null || suggestion.estimated_time_hours != null) {
        onPersistSuggestion?.(item, { estimated_time_minutes: null, estimated_time_hours: null });
      }
      return;
    }
    const roundedHours = Number(hours.toFixed(2));
    const minutes = Math.round(roundedHours * 60);
    if (minutes !== suggestion.estimated_time_minutes || roundedHours !== suggestion.estimated_time_hours) {
      onPersistSuggestion?.(item, { estimated_time_minutes: minutes, estimated_time_hours: roundedHours });
    }
  }, [hoursDraft, suggestion, onPersistSuggestion, item]);

  const closeField = useCallback(() => {
    onEditingFieldChange(null);
  }, [onEditingFieldChange]);

  useEffect(() => {
    if (!editingField || editingField === "due") return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (cardRef.current?.contains(target)) return;
      if ((target as Element).closest?.('[aria-label="Frist wählen"]')) return;
      if (editingField === "title") flushTitle();
      if (editingField === "notes") flushNotes();
      if (editingField === "chat") flushChat();
      if (editingField === "duration") flushDuration();
      closeField();
    };
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onPointerDown);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [editingField, flushTitle, flushNotes, flushChat, flushDuration, closeField]);

  useEffect(() => {
    if (!editingField || editingField === "due") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (editingField === "title") flushTitle();
      if (editingField === "notes") flushNotes();
      if (editingField === "chat") flushChat();
      if (editingField === "duration") flushDuration();
      closeField();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingField, flushTitle, flushNotes, flushChat, flushDuration, closeField]);

  useLayoutEffect(() => {
    if (!editingField) return;
    const id = requestAnimationFrame(() => {
      if (editingField === "title") {
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      } else if (editingField === "chat") {
        chatInputRef.current?.focus();
        chatInputRef.current?.select();
      } else if (editingField === "notes") {
        notesRef.current?.focus();
      } else if (editingField === "duration") {
        durationRef.current?.focus();
        durationRef.current?.select();
      }
    });
    return () => cancelAnimationFrame(id);
  }, [editingField]);

  const activate = (field: TriageEditField) => {
    if (!canEdit && field !== "chat") return;
    if (field === "chat" && !onChatNameChange) return;
    onEditingFieldChange(field);
  };

  return (
    <div
      ref={cardRef}
      className="w-full max-w-md overflow-hidden tg-panel shadow-glass"
    >
      <div className="space-y-1 p-2">
        {onChatNameChange && (
          <TriageFieldShell
            label="Chat"
            icon="💬"
            active={editingField === "chat"}
            onActivate={() => activate("chat")}
            footer={
              onOpenChat ? (
                <button
                  type="button"
                  disabled={Boolean(editingField && editingField !== "chat")}
                  onClick={() => onOpenChat(item.chatId)}
                  title="Zum Chat springen (in neuem Tab öffnen)"
                  className="w-full rounded-lg border border-wa-border bg-wa-panel px-3 py-2 text-sm font-medium text-wa-text-primary transition hover:border-wa-green/40 hover:text-wa-green disabled:opacity-40"
                >
                  Zum Chat springen
                </button>
              ) : undefined
            }
          >
            {editingField === "chat" ? (
              <input
                ref={chatInputRef}
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                onBlur={flushChat}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    flushChat();
                    closeField();
                  }
                }}
                className="w-full rounded-lg border border-wa-border bg-wa-input-bg px-2.5 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
              />
            ) : (
              <p className="truncate text-sm font-medium text-wa-text-primary">
                {item.chatName || <span className="italic text-wa-text-secondary">Chat-Name</span>}
              </p>
            )}
          </TriageFieldShell>
        )}

        <TriageFieldShell
          label="Titel"
          icon="✓"
          active={editingField === "title"}
          onActivate={() => activate("title")}
        >
          {editingField === "title" ? (
            <input
              ref={titleInputRef}
              type="text"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={flushTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  flushTitle();
                  closeField();
                }
              }}
              className="w-full rounded-lg border border-wa-border bg-wa-input-bg px-2.5 py-2 text-base font-semibold text-wa-text-primary focus:border-wa-green focus:outline-none"
            />
          ) : (
            <p className="text-base font-semibold leading-snug text-wa-text-primary">
              {suggestion.title?.trim() || (
                <span className="font-normal italic text-wa-text-secondary">Titel tippen…</span>
              )}
            </p>
          )}
        </TriageFieldShell>

        <TriageFieldShell
          label="Fälligkeit"
          icon="📅"
          active={editingField === "due"}
          onActivate={() => activate("due")}
          hint={editingField === "due" ? "Esc oder Klick außerhalb schließt den Kalender" : undefined}
        >
          {editingField === "due" ? (
            <DueDatePicker
              className="w-full"
              variant="compact"
              value={dueDraft}
              defaultOpen
              commitOnSelect
              onChange={(next) => {
                setDueDraft(next);
                onPersistSuggestion?.(item, {
                  due: syncDueDateFromDateTime(next),
                  due_time: next.time,
                });
              }}
              onClose={closeField}
            />
          ) : suggestion.due ? (
            <p className="text-sm font-medium text-wa-green">{dueLabel}</p>
          ) : (
            <p className="text-sm italic text-wa-text-secondary">Frist setzen…</p>
          )}
        </TriageFieldShell>

        <TriageFieldShell
          label="Details"
          icon="📝"
          active={editingField === "notes"}
          onActivate={() => activate("notes")}
          hint={editingField === "notes" ? "Enter speichern · Shift+Enter neue Zeile" : undefined}
        >
          {editingField === "notes" ? (
            <textarea
              ref={notesRef}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              onBlur={flushNotes}
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.shiftKey) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  flushNotes();
                  closeField();
                }
              }}
              className="w-full resize-y rounded-lg border border-wa-border bg-wa-input-bg px-2.5 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
            />
          ) : notesDraft ? (
            <RichTextNotes
              text={notesDraft}
              showIcon={false}
              className="line-clamp-4 text-sm leading-relaxed text-wa-text-secondary"
              onActivate={() => activate("notes")}
            />
          ) : (
            <p className="text-sm italic text-wa-text-secondary">Notizen hinzufügen…</p>
          )}
        </TriageFieldShell>

        {(durationLabel || editingField === "duration" || canEdit) && (
          <TriageFieldShell
            label="Dauer"
            icon="⏱"
            active={editingField === "duration"}
            onActivate={() => activate("duration")}
            footer={
              editingField !== "duration" && canEdit ? (
                <DurationQuickBadges activeHours={activeDurationHours} onPick={applyDurationHours} />
              ) : undefined
            }
          >
            {editingField === "duration" ? (
              <div className="space-y-2">
                <DurationQuickBadges activeHours={activeDurationHours} onPick={applyDurationHours} />
                <div className="flex items-center gap-2">
                  <input
                    ref={durationRef}
                    type="number"
                    min={0}
                    step={0.25}
                    value={hoursDraft}
                    onChange={(e) => setHoursDraft(e.target.value)}
                    onBlur={flushDuration}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        flushDuration();
                        closeField();
                      }
                    }}
                    className="w-24 rounded-lg border border-wa-border bg-wa-input-bg px-2.5 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                  />
                  <span className="text-xs text-wa-text-secondary">Stunden</span>
                </div>
              </div>
            ) : durationLabel ? (
              <p className="text-sm text-wa-text-primary">{durationLabel}</p>
            ) : (
              <p className="text-sm italic text-wa-text-secondary">Optional</p>
            )}
          </TriageFieldShell>
        )}
      </div>
      {canEdit && (
        <div className="border-t border-wa-border/50 px-3 py-2.5">
          <SuggestionNextToggle
            active={markAsNext}
            onChange={(next) => {
              setMarkAsNext(next);
              onPersistSuggestion?.(item, { mark_as_next: next });
            }}
          />
        </div>
      )}
    </div>
  );
}
