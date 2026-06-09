"use client";

import { useMemo, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { sanitizeNotesHtml } from "@/lib/sanitize-notes-html";

type RichTextNotesProps = {
  text: string;
  className?: string;
  title?: string;
  /** Click opens editor; link clicks are not intercepted. */
  onActivate?: () => void;
  showIcon?: boolean;
};

export function RichTextNotes({ text, className, title, onActivate, showIcon = true }: RichTextNotesProps) {
  const html = useMemo(() => sanitizeNotesHtml(text), [text]);

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a")) return;
    onActivate?.();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onActivate) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  };

  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate ? handleClick : undefined}
      onKeyDown={onActivate ? handleKeyDown : undefined}
      title={title}
      className={cn("tg-rich-text max-w-full break-words text-left", onActivate && "cursor-pointer hover:underline", className)}
    >
      {showIcon && <span className="mr-0.5" aria-hidden>📝 </span>}
      <span dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
