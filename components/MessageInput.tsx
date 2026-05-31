"use client";

import { useState, useRef, useEffect, useMemo } from "react";

/** Reply suggestions when the contact wrote last (answer them). */
const DEFAULT_REPLY_SUGGESTIONS = [
  "Danke für deine Nachricht!",
  "Kann ich dir mehr Infos geben?",
  "Melde mich gleich bei dir.",
];

/**
 * Follow-up suggestions when I was the last sender (friendly nudge so they answer).
 * Harmonzi-style: value-first, soft, not pushy – "maybe it got lost", offer help.
 */
const FOLLOW_UP_SUGGESTIONS = [
  "Hast du meine letzte Nachricht gesehen? Kein Stress – melde dich, wenn du Zeit hast.",
  "Falls es untergegangen ist: Ich wollte nur kurz nachhaken – gib Bescheid, wenn du Fragen hast.",
  "Wollte nur sichergehen, dass nichts untergegangen ist. Melde dich gern, wenn ich dir helfen kann.",
];

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  /** Up to 3 reply suggestions (from AI analysis or defaults). Used when contact wrote last. */
  suggestions?: string[];
  /** When true, show follow-up suggestions (nudge) instead of reply suggestions. */
  lastSenderIsMe?: boolean;
  /** When true, prefill the input with the first suggestion (from settings). Default off. */
  autoInsertFirstSuggestion?: boolean;
  /** When set from outside (e.g. click on suggestion in CRM panel), insert this text into the input. Cleared after insert via onInserted. */
  insertText?: string | null;
  /** Called after insertText was applied so parent can clear it. */
  onInserted?: () => void;
  /** When provided, Shift+Enter calls this instead of inserting a newline (e.g. jump to next chat). */
  onShiftEnter?: () => void;
}

export function MessageInput({ onSend, disabled, suggestions, lastSenderIsMe, autoInsertFirstSuggestion, insertText, onInserted, onShiftEnter }: MessageInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const displaySuggestions = useMemo(() => {
    const list = lastSenderIsMe
      ? FOLLOW_UP_SUGGESTIONS
      : (suggestions?.length ? suggestions : DEFAULT_REPLY_SUGGESTIONS);
    return list.slice(0, 3);
  }, [lastSenderIsMe, suggestions]);

  useEffect(() => {
    if (!autoInsertFirstSuggestion || displaySuggestions.length === 0) return;
    setText((prev) => (prev.trim() === "" ? displaySuggestions[0] : prev));
  }, [autoInsertFirstSuggestion, displaySuggestions]);

  useEffect(() => {
    if (insertText == null || insertText === "") return;
    setText(String(insertText).trim());
    textareaRef.current?.focus();
    onInserted?.();
  }, [insertText, onInserted]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const sendNow = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSend(t);
    setText("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendNow();
  };

  const handleSuggestionClick = (suggestion: string, e: React.MouseEvent) => {
    const trimmed = suggestion.trim();
    if (!trimmed) return;
    if (e.shiftKey) {
      if (!disabled) {
        onSend(trimmed);
        setText("");
      }
    } else {
      setText(trimmed);
      textareaRef.current?.focus();
    }
  };

  return (
    <footer className="shrink-0 border-t border-wa-border bg-wa-panel-secondary p-3 pb-4">
      {displaySuggestions.length > 0 && (
        <div className="mb-2">
          <div className="flex flex-col gap-2">
            {displaySuggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={(e) => handleSuggestionClick(s, e)}
                disabled={disabled}
                className="w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-left text-sm text-wa-text-primary transition-colors hover:border-wa-green hover:bg-wa-green/10 disabled:opacity-50 whitespace-normal break-words"
                title="Klicken: in Eingabe übernehmen · Shift+Klick: sofort senden"
              >
                {s}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-wa-text-secondary">
            Klick = übernehmen · Shift+Klick = sofort senden
          </p>
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              sendNow();
              return;
            }
            if (e.key === "Enter" && e.shiftKey) {
              if (onShiftEnter) {
                e.preventDefault();
                onShiftEnter();
              }
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as React.FormEvent);
            }
          }}
          placeholder={onShiftEnter ? "Nachricht eingeben… (Enter/Cmd+Enter = Senden, Shift+Enter = nächster Chat)" : "Nachricht eingeben… (Enter/Cmd+Enter = Senden, Shift+Enter = neue Zeile)"}
          rows={1}
          disabled={disabled}
          title={onShiftEnter ? "Enter oder Cmd/Ctrl+Enter = Senden · Shift+Enter = nächster Chat" : "Enter oder Cmd/Ctrl+Enter = Senden · Shift+Enter = neue Zeile"}
          className="max-h-[120px] min-h-[42px] flex-1 resize-none rounded-lg border border-wa-border bg-wa-input-bg px-4 py-2.5 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none focus:ring-1 focus:ring-wa-green disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!text.trim() || disabled}
          title="Nachricht senden (oder Enter)"
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-wa-green text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          aria-label="Senden"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </form>
      <p className="mt-1.5 text-[10px] text-wa-text-secondary">
        {onShiftEnter ? "Enter/Cmd/Ctrl+Enter = Senden · Shift+Enter = nächster Chat" : "Enter/Cmd/Ctrl+Enter = Senden · Shift+Enter = neue Zeile"}
      </p>
    </footer>
  );
}
