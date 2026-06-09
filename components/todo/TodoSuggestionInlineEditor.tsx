"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { DueDatePicker } from "@/components/DueDatePicker";
import {
  suggestionDueToDateTime,
  syncDueDateFromDateTime,
  type DueDateTime,
} from "@/lib/due-datetime";
import type { TodoSuggestionItem } from "@/lib/todo-db";
import { ReclaimSyntaxControls } from "@/components/todo/ReclaimSyntaxControls";
import type { ReclaimSyntaxFields } from "@/lib/reclaim-task-syntax";
import { suggestionToSyntaxFields } from "@/lib/reclaim-task-syntax";

export type SuggestionEditFocus = "title" | "due" | "notes";

export type EditableTodoSuggestion = TodoSuggestionItem & { due_time?: string | null };

export type TodoSuggestionInlineEditorProps = {
  suggestion: EditableTodoSuggestion;
  initialFocus?: SuggestionEditFocus;
  onPersist: (patch: Partial<EditableTodoSuggestion>) => void;
  onFinish: () => void;
  /** Save edits and accept the suggestion as a todo. */
  onAccept?: (item: EditableTodoSuggestion) => void | Promise<void>;
  /** Always-visible fields (e.g. triage card); no Esc-to-close or Fertig button. */
  embedded?: boolean;
};

/** Inline suggestion editor with custom due date/time picker. */
export function TodoSuggestionInlineEditor({
  suggestion,
  initialFocus,
  onPersist,
  onFinish,
  onAccept,
  embedded = false,
}: TodoSuggestionInlineEditorProps) {
  const [title, setTitle] = useState(suggestion.title);
  const [dueDateTime, setDueDateTime] = useState<DueDateTime>(() =>
    suggestionDueToDateTime(suggestion.due, suggestion.due_time)
  );
  const [duePickerOpen, setDuePickerOpen] = useState(false);
  const [notes, setNotes] = useState(() => suggestion.notes?.trim() ?? "");
  const [syntaxFields, setSyntaxFields] = useState<ReclaimSyntaxFields>(() => ({
    mark_as_next: suggestion.mark_as_next === true,
    reclaim_schedule_type: suggestion.reclaim_schedule_type ?? null,
    reclaim_not_before: suggestion.reclaim_not_before ?? null,
    reclaim_no_split: suggestion.reclaim_no_split === true,
  }));
  const [hoursStr, setHoursStr] = useState(() => {
    if (suggestion.estimated_time_hours != null) return String(suggestion.estimated_time_hours);
    if (suggestion.estimated_time_minutes != null) {
      return String(Number((suggestion.estimated_time_minutes / 60).toFixed(2)));
    }
    return "";
  });

  useEffect(() => {
    setTitle(suggestion.title);
    setDueDateTime(suggestionDueToDateTime(suggestion.due, suggestion.due_time));
    setNotes(suggestion.notes?.trim() ?? "");
    setSyntaxFields(suggestionToSyntaxFields(suggestion));
    if (suggestion.estimated_time_hours != null) setHoursStr(String(suggestion.estimated_time_hours));
    else if (suggestion.estimated_time_minutes != null) {
      setHoursStr(String(Number((suggestion.estimated_time_minutes / 60).toFixed(2))));
    } else setHoursStr("");
  }, [
    suggestion.title,
    suggestion.due,
    suggestion.due_time,
    suggestion.notes,
    suggestion.mark_as_next,
    suggestion.reclaim_schedule_type,
    suggestion.reclaim_not_before,
    suggestion.reclaim_no_split,
    suggestion.estimated_time_hours,
    suggestion.estimated_time_minutes,
  ]);

  const titleRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const flushDurationIntoParent = useCallback(() => {
    const raw = hoursStr.trim();
    const hours = raw === "" ? null : Number(raw.replace(",", "."));
    if (hours == null || Number.isNaN(hours) || hours < 0) {
      if (suggestion.estimated_time_minutes != null || suggestion.estimated_time_hours != null) {
        onPersist({ estimated_time_minutes: null, estimated_time_hours: null });
      }
      return;
    }
    const roundedHours = Number(hours.toFixed(2));
    const minutes = Math.round(roundedHours * 60);
    if (minutes !== suggestion.estimated_time_minutes || roundedHours !== suggestion.estimated_time_hours) {
      onPersist({ estimated_time_minutes: minutes, estimated_time_hours: roundedHours });
    }
  }, [hoursStr, onPersist, suggestion.estimated_time_hours, suggestion.estimated_time_minutes]);

  const persistAllFields = useCallback(() => {
    const tid = title.trim();
    if (tid && tid !== suggestion.title) onPersist({ title: tid });

    const dueNorm = syncDueDateFromDateTime(dueDateTime);
    const timeNorm = dueDateTime.time;
    if (dueNorm !== (suggestion.due ?? null) || timeNorm !== (suggestion.due_time ?? null)) {
      onPersist({ due: dueNorm, due_time: timeNorm });
    }

    const n = notes.trim() || null;
    if (n !== (suggestion.notes ?? null)) onPersist({ notes: n });

    flushDurationIntoParent();

    const currentSyntax = suggestionToSyntaxFields(suggestion);
    if (
      syntaxFields.mark_as_next !== currentSyntax.mark_as_next ||
      syntaxFields.reclaim_schedule_type !== currentSyntax.reclaim_schedule_type ||
      syntaxFields.reclaim_not_before !== currentSyntax.reclaim_not_before ||
      syntaxFields.reclaim_no_split !== currentSyntax.reclaim_no_split
    ) {
      onPersist({
        mark_as_next: syntaxFields.mark_as_next,
        reclaim_schedule_type: syntaxFields.reclaim_schedule_type,
        reclaim_not_before: syntaxFields.reclaim_not_before,
        reclaim_no_split: syntaxFields.reclaim_no_split,
      });
    }
  }, [
    title,
    dueDateTime,
    notes,
    suggestion,
    syntaxFields,
    onPersist,
    flushDurationIntoParent,
  ]);

  const buildMergedSuggestion = useCallback((): EditableTodoSuggestion => {
    const tid = title.trim() || suggestion.title;
    const dueNorm = syncDueDateFromDateTime(dueDateTime);
    const n = notes.trim() || null;
    const raw = hoursStr.trim();
    const hours = raw === "" ? null : Number(raw.replace(",", "."));
    let estimated_time_minutes: number | null = null;
    let estimated_time_hours: number | null = null;
    if (hours != null && !Number.isNaN(hours) && hours >= 0) {
      const roundedHours = Number(hours.toFixed(2));
      estimated_time_hours = roundedHours;
      estimated_time_minutes = Math.round(roundedHours * 60);
    }
    return {
      ...suggestion,
      title: tid,
      due: dueNorm,
      due_time: dueDateTime.time,
      notes: n,
      estimated_time_minutes,
      estimated_time_hours,
      mark_as_next: syntaxFields.mark_as_next,
      reclaim_schedule_type: syntaxFields.reclaim_schedule_type,
      reclaim_not_before: syntaxFields.reclaim_not_before,
      reclaim_no_split: syntaxFields.reclaim_no_split,
    };
  }, [title, dueDateTime, notes, hoursStr, syntaxFields, suggestion]);

  const persistFieldsAndClose = useCallback(() => {
    persistAllFields();
    if (!embedded) onFinish();
  }, [persistAllFields, embedded, onFinish]);

  const persistFieldsAndAccept = useCallback(async () => {
    const merged = buildMergedSuggestion();
    persistAllFields();
    if (onAccept) await onAccept(merged);
    if (!embedded) onFinish();
  }, [buildMergedSuggestion, persistAllFields, onAccept, embedded, onFinish]);

  useLayoutEffect(() => {
    if (embedded && !initialFocus) return;
    const id = requestAnimationFrame(() => {
      const focus = initialFocus ?? "title";
      if (focus === "title") {
        titleRef.current?.focus();
        titleRef.current?.select();
      } else if (focus === "notes") {
        notesRef.current?.focus();
        notesRef.current?.setSelectionRange(
          notesRef.current.value.length,
          notesRef.current.value.length
        );
      } else {
        setDuePickerOpen(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [initialFocus, embedded]);

  const onEnterSaveInput = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      e.preventDefault();
      if (embedded) persistAllFields();
      else persistFieldsAndClose();
    },
    [embedded, persistAllFields, persistFieldsAndClose]
  );

  const escapeCancelRef = useRef(false);
  useEffect(() => {
    if (embedded) return;
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      escapeCancelRef.current = true;
      e.preventDefault();
      onFinish();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onFinish, embedded]);

  const onNotesKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter") return;
      if (e.shiftKey) {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        setNotes((prev) => prev.slice(0, start) + "\n" + prev.slice(end));
        queueMicrotask(() => {
          const pos = start + 1;
          try {
            el.setSelectionRange(pos, pos);
          } catch {
            /* ignore */
          }
        });
        return;
      }
      e.preventDefault();
      if (embedded) persistAllFields();
      else persistFieldsAndClose();
    },
    [embedded, persistAllFields, persistFieldsAndClose]
  );

  const titleHint = embedded
    ? "Titel"
    : "Titel · Enter speichern & schließen · Esc abbrechen";
  const notesHint = embedded
    ? "Details / Notizen"
    : "Details · Enter speichern, Shift+Enter neue Zeile";

  return (
    <div className={embedded ? "space-y-2" : "mt-2 space-y-2"}>
      <div>
        <label className="block text-xs text-wa-text-secondary">{titleHint}</label>
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={(e) => {
            if (escapeCancelRef.current) {
              escapeCancelRef.current = false;
              return;
            }
            const v = e.target.value.trim();
            if (v && v !== suggestion.title) onPersist({ title: v });
          }}
          onKeyDown={onEnterSaveInput}
          className="mt-0.5 w-full rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-wa-text-primary"
        />
      </div>
      <div>
        <label className="block text-xs text-wa-text-secondary">Frist (Datum &amp; Uhrzeit)</label>
        <DueDatePicker
          className="mt-0.5"
          value={dueDateTime}
          defaultOpen={duePickerOpen || initialFocus === "due"}
          onChange={(next) => {
            setDueDateTime(next);
            onPersist({
              due: syncDueDateFromDateTime(next),
              due_time: next.time,
            });
          }}
          onClose={() => setDuePickerOpen(false)}
        />
      </div>
      <div>
        <label className="block text-xs text-wa-text-secondary">{notesHint}</label>
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={(e) => {
            if (escapeCancelRef.current) {
              escapeCancelRef.current = false;
              return;
            }
            const v = e.target.value.trim() || null;
            if (v !== (suggestion.notes ?? null)) onPersist({ notes: v });
          }}
          rows={embedded ? 3 : 4}
          onKeyDown={onNotesKeyDown}
          className="mt-0.5 w-full rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary"
        />
      </div>
      <div>
        <label className="block text-xs text-wa-text-secondary">Dauer (Stunden)</label>
        <input
          type="number"
          min={0}
          step={0.25}
          value={hoursStr}
          onChange={(e) => setHoursStr(e.target.value)}
          onBlur={() => {
            if (escapeCancelRef.current) {
              escapeCancelRef.current = false;
              return;
            }
            flushDurationIntoParent();
          }}
          onKeyDown={onEnterSaveInput}
          className="mt-0.5 w-full rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-wa-text-primary"
        />
      </div>
      <ReclaimSyntaxControls
        value={syntaxFields}
        onChange={(patch) => {
          const next = { ...syntaxFields, ...patch };
          setSyntaxFields(next);
          onPersist({
            mark_as_next: next.mark_as_next,
            reclaim_schedule_type: next.reclaim_schedule_type,
            reclaim_not_before: next.reclaim_not_before,
            reclaim_no_split: next.reclaim_no_split,
          });
        }}
      />
      {!embedded && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={persistFieldsAndClose}
            title="Alle Felder speichern und Bearbeitungsmodus beenden (wie Enter außer in der Beschreibung)"
            className="tg-btn-secondary px-3 py-1.5 text-xs"
          >
            Fertig (Speichern)
          </button>
          {onAccept && (
            <button
              type="button"
              onClick={() => void persistFieldsAndAccept()}
              title="Änderungen speichern und Vorschlag als Todo übernehmen"
              className="tg-btn-primary px-3 py-1.5 text-xs"
            >
              Speichern und akzeptieren
            </button>
          )}
        </div>
      )}
    </div>
  );
}
