"use client";

import { cn } from "@/lib/cn";
import type { ReclaimScheduleType, ReclaimSyntaxFields } from "@/lib/reclaim-task-syntax";
import { SuggestionNextToggle } from "@/components/todo/SuggestionNextToggle";

type ReclaimSyntaxControlsProps = {
  value: ReclaimSyntaxFields;
  onChange: (patch: Partial<ReclaimSyntaxFields>) => void;
  className?: string;
  disabled?: boolean;
};

/** Toggles for Reclaim Google Tasks title syntax (type, upnext, nosplit, not before). */
export function ReclaimSyntaxControls({ value, onChange, className, disabled }: ReclaimSyntaxControlsProps) {
  const scheduleType = value.reclaim_schedule_type ?? null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <SuggestionNextToggle
        active={value.mark_as_next === true}
        disabled={disabled}
        onChange={(next) => onChange({ mark_as_next: next })}
      />
      <div className="tg-segmented inline-flex shrink-0" role="group" aria-label="Scheduling hours">
        {(["work", "personal"] as ReclaimScheduleType[]).map((type) => {
          const active = scheduleType === type;
          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              title={type === "work" ? "Working Hours" : "Personal Hours"}
              onClick={() =>
                onChange({ reclaim_schedule_type: active ? null : type })
              }
              className={cn(
                "tg-segmented-item px-2 py-1 text-[11px] capitalize",
                active ? "tg-segmented-item-active" : "tg-segmented-item-inactive"
              )}
            >
              {type}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value.reclaim_no_split === true}
        disabled={disabled}
        title="Task als ein Block planen (nosplit)"
        onClick={() => onChange({ reclaim_no_split: !value.reclaim_no_split })}
        className={cn(
          "tg-chip text-xs font-medium",
          value.reclaim_no_split && "tg-chip-active",
          disabled && "opacity-50"
        )}
      >
        No split
      </button>
      <label className="inline-flex items-center gap-1.5 text-xs text-wa-text-secondary">
        <span className="whitespace-nowrap">Not before</span>
        <input
          type="date"
          disabled={disabled}
          value={value.reclaim_not_before ?? ""}
          onChange={(e) => onChange({ reclaim_not_before: e.target.value || null })}
          className="tg-input max-w-[9rem] py-1 text-xs"
        />
      </label>
    </div>
  );
}
