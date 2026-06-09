"use client";

import { cn } from "@/lib/cn";

type SuggestionNextToggleProps = {
  active: boolean;
  onChange: (active: boolean) => void;
  className?: string;
  disabled?: boolean;
};

/** Toggle Up Next for external sync (Reclaim onDeck / Google title prefix). */
export function SuggestionNextToggle({ active, onChange, className, disabled }: SuggestionNextToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      title={
        active
          ? "Als Up Next markiert (Reclaim: onDeck · Google: upnext in Klammern)"
          : "Als Up Next markieren (Reclaim: onDeck · Google: upnext in Klammern)"
      }
      onClick={() => onChange(!active)}
      className={cn(
        "tg-chip inline-flex items-center gap-1.5 text-xs font-medium",
        active && "tg-chip-active",
        disabled && "opacity-50",
        className
      )}
    >
      <span aria-hidden>{active ? "▶" : "○"}</span>
      Next
    </button>
  );
}
