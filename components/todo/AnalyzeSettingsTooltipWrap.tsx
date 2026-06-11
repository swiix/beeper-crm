"use client";

import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

type AnalyzeSettingsTooltipWrapProps = {
  content: string;
  children: React.ReactNode;
  className?: string;
};

/** Hover tooltip for analyze buttons; portal avoids scroll clipping and works on disabled buttons. */
export function AnalyzeSettingsTooltipWrap({
  content,
  children,
  className,
}: AnalyzeSettingsTooltipWrapProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  const show = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor || !content.trim()) return;
    const rect = anchor.getBoundingClientRect();
    const maxWidth = Math.min(352, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - maxWidth - 8);
    setPosition({ top: rect.bottom + 8, left });
    setOpen(true);
  }, [content]);

  const hide = useCallback(() => setOpen(false), []);

  const lines = content.split("\n");

  return (
    <>
      <span
        ref={anchorRef}
        className={cn("block", className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: position.top, left: position.left }}
            className="pointer-events-none fixed z-[200] w-max max-w-[min(22rem,calc(100vw-1rem))] rounded-lg border border-wa-border bg-wa-panel px-3 py-2 text-left text-[11px] leading-relaxed text-wa-text-primary shadow-glass-lg"
            onMouseEnter={show}
            onMouseLeave={hide}
          >
            {lines.map((line, index) =>
              line.trim() === "" ? (
                <span key={`gap-${index}`} className="block h-1.5" aria-hidden />
              ) : (
                <span key={`${index}-${line.slice(0, 24)}`} className="block whitespace-pre-wrap break-words">
                  {line}
                </span>
              )
            )}
          </div>,
          document.body
        )}
    </>
  );
}
