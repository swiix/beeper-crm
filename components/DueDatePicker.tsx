"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MONTH_NAMES_DE,
  WEEKDAY_SHORT_DE,
  addLocalDays,
  addLocalMonths,
  buildCalendarMonthGrid,
  formatHmDisplay,
  formatYmdDisplay,
  localCalendarTodayYmd,
  nextWeekdayYmd,
  nextWorkdayYmd,
  parseYmd,
} from "@/lib/date-local";
import { DEFAULT_DUE_TIME, type DueDateTime, isValidHm, isValidYmd } from "@/lib/due-datetime";

export type DueDatePickerProps = {
  value: DueDateTime;
  onChange: (value: DueDateTime) => void;
  onClose?: () => void;
  defaultOpen?: boolean;
  variant?: "compact" | "default";
  /** When true, selecting a day or shortcut commits immediately and closes */
  commitOnSelect?: boolean;
  className?: string;
};

type QuickPick = { label: string; apply: (ctx: { today: string; from: string }) => DueDateTime };

type QuickPickGroup = { title: string; picks: QuickPick[] };

function buildQuickPickGroups(): QuickPickGroup[] {
  return [
    {
      title: "Schnell",
      picks: [
        { label: "Heute", apply: ({ today }) => ({ date: today, time: DEFAULT_DUE_TIME }) },
        { label: "Morgen", apply: ({ today }) => ({ date: addLocalDays(today, 1), time: DEFAULT_DUE_TIME }) },
        { label: "Übermorgen", apply: ({ today }) => ({ date: addLocalDays(today, 2), time: DEFAULT_DUE_TIME }) },
        {
          label: "Werktag",
          apply: ({ from }) => ({ date: nextWorkdayYmd(from), time: DEFAULT_DUE_TIME }),
        },
        {
          label: "Nächster Mo",
          apply: ({ from }) => ({ date: nextWeekdayYmd(from, 0), time: DEFAULT_DUE_TIME }),
        },
        {
          label: "Nächster Fr",
          apply: ({ from }) => ({ date: nextWeekdayYmd(from, 4), time: DEFAULT_DUE_TIME }),
        },
        {
          label: "Nächste Woche",
          apply: ({ today }) => ({
            date: nextWeekdayYmd(addLocalDays(today, 1), 0),
            time: DEFAULT_DUE_TIME,
          }),
        },
      ],
    },
    {
      title: "Verschieben",
      picks: [
        { label: "+1 Tag", apply: ({ from }) => ({ date: addLocalDays(from, 1), time: DEFAULT_DUE_TIME }) },
        { label: "+2 Tage", apply: ({ from }) => ({ date: addLocalDays(from, 2), time: DEFAULT_DUE_TIME }) },
        { label: "+3 Tage", apply: ({ from }) => ({ date: addLocalDays(from, 3), time: DEFAULT_DUE_TIME }) },
        { label: "+7 Tage", apply: ({ from }) => ({ date: addLocalDays(from, 7), time: DEFAULT_DUE_TIME }) },
        { label: "+14 Tage", apply: ({ from }) => ({ date: addLocalDays(from, 14), time: DEFAULT_DUE_TIME }) },
        { label: "+1 Mo.", apply: ({ from }) => ({ date: addLocalMonths(from, 1), time: DEFAULT_DUE_TIME }) },
        { label: "+3 Mo.", apply: ({ from }) => ({ date: addLocalMonths(from, 3), time: DEFAULT_DUE_TIME }) },
      ],
    },
  ];
}

const PICKER_CHIP_CLASS =
  "rounded-full border border-wa-border bg-wa-panel-secondary px-2 py-0.5 text-[11px] font-medium text-wa-text-primary transition hover:border-wa-green/40 hover:bg-wa-green/10 active:scale-[0.98]";

const TIME_PRESETS = ["20:00", "12:00", "17:00"] as const;

export function DueDatePicker({
  value,
  onChange,
  onClose,
  defaultOpen = false,
  variant = "default",
  commitOnSelect = false,
  className = "",
}: DueDatePickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<DueDateTime>(value);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const today = localCalendarTodayYmd();
  const anchorYmd = isValidYmd(draft.date) ? draft.date : today;
  const parsed = parseYmd(anchorYmd) ?? parseYmd(today)!;
  const [viewYear, setViewYear] = useState(parsed.year);
  const [viewMonth, setViewMonth] = useState(parsed.month);

  const quickPickGroups = useMemo(() => buildQuickPickGroups(), []);
  const grid = useMemo(() => buildCalendarMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  useEffect(() => {
    setDraft(value);
    if (isValidYmd(value.date)) {
      const p = parseYmd(value.date);
      if (p) {
        setViewYear(p.year);
        setViewMonth(p.month);
      }
    }
  }, [value]);

  const updatePanelPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 320;
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (left < 8) left = 8;
    let top = rect.bottom + 4;
    const maxH = 520;
    if (top + maxH > window.innerHeight - 8) top = Math.max(8, rect.top - maxH - 4);
    setPanelPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  const commit = useCallback(
    (next: DueDateTime) => {
      setDraft(next);
      onChange(next);
      if (commitOnSelect) {
        setOpen(false);
        onClose?.();
      }
    },
    [commitOnSelect, onChange, onClose]
  );

  const applyAndMaybeClose = useCallback(
    (next: DueDateTime) => {
      commit(next);
      if (!commitOnSelect) {
        setOpen(false);
        onClose?.();
      }
    },
    [commit, commitOnSelect, onClose]
  );

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
      onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDraft(value);
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, value]);

  const displayLabel = useMemo(() => {
    if (!isValidYmd(draft.date)) return "Frist setzen";
    const d = formatYmdDisplay(draft.date);
    const t = formatHmDisplay(draft.time);
    return t ? `${d} ${t}` : d;
  }, [draft.date, draft.time]);

  const setTimePart = (hm: string) => {
    const date = isValidYmd(draft.date) ? draft.date : today;
    setDraft({ date, time: hm });
  };

  const panel = open && panelPos && typeof document !== "undefined" ? (
    createPortal(
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Frist wählen"
        className="z-[200] w-[min(320px,calc(100vw-16px))] rounded-xl border border-wa-border bg-wa-panel p-3 shadow-xl"
        style={{ position: "fixed", top: panelPos.top, left: panelPos.left }}
      >
        <div className="space-y-2.5">
          {quickPickGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-wa-text-secondary">
                {group.title}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {group.picks.map((pick) => (
                  <button
                    key={pick.label}
                    type="button"
                    onClick={() => {
                      const next = pick.apply({ today, from: anchorYmd });
                      if (commitOnSelect) applyAndMaybeClose(next);
                      else setDraft(next);
                    }}
                    className={PICKER_CHIP_CLASS}
                  >
                    {pick.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              if (viewMonth === 1) {
                setViewMonth(12);
                setViewYear((y) => y - 1);
              } else setViewMonth((m) => m - 1);
            }}
            className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary"
            aria-label="Vorheriger Monat"
          >
            ◀
          </button>
          <span className="text-sm font-medium text-wa-text-primary">
            {MONTH_NAMES_DE[viewMonth - 1]} {viewYear}
          </span>
          <button
            type="button"
            onClick={() => {
              if (viewMonth === 12) {
                setViewMonth(1);
                setViewYear((y) => y + 1);
              } else setViewMonth((m) => m + 1);
            }}
            className="rounded p-1 text-wa-text-secondary hover:bg-wa-panel-secondary"
            aria-label="Nächster Monat"
          >
            ▶
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-0.5 text-center text-[10px] text-wa-text-secondary">
          {WEEKDAY_SHORT_DE.map((w) => (
            <div key={w} className="py-0.5 font-medium">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {grid.map((cell) => {
            const selected = draft.date === cell.ymd;
            return (
              <button
                key={cell.ymd}
                type="button"
                onClick={() => {
                  const next: DueDateTime = {
                    date: cell.ymd,
                    time: isValidHm(draft.time) ? draft.time : DEFAULT_DUE_TIME,
                  };
                  if (commitOnSelect) applyAndMaybeClose(next);
                  else setDraft(next);
                }}
                className={[
                  "h-8 rounded text-xs",
                  cell.inMonth ? "text-wa-text-primary" : "text-wa-text-secondary/50",
                  cell.isToday && !selected ? "ring-1 ring-wa-green/60" : "",
                  selected ? "bg-blue-600 font-medium text-white" : "hover:bg-wa-panel-secondary",
                ].join(" ")}
              >
                {parseYmd(cell.ymd)?.day}
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-wa-border pt-3">
          <div className="text-xs font-medium text-wa-text-secondary">Uhrzeit</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <input
              type="time"
              value={isValidHm(draft.time) ? draft.time : DEFAULT_DUE_TIME}
              onChange={(e) => setTimePart(e.target.value || DEFAULT_DUE_TIME)}
              className="rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary"
            />
            {TIME_PRESETS.map((t) => (
              <button key={t} type="button" onClick={() => setTimePart(t)} className={PICKER_CHIP_CLASS}>
                {t}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const n = new Date();
                const hm = `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
                setTimePart(hm);
              }}
              className={PICKER_CHIP_CLASS}
            >
              Jetzt
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-wa-border pt-2">
          <button
            type="button"
            onClick={() => applyAndMaybeClose({ date: null, time: null })}
            className="text-xs text-wa-text-secondary hover:text-wa-text-primary"
          >
            Löschen
          </button>
          {!commitOnSelect && (
            <button
              type="button"
              onClick={() => applyAndMaybeClose(draft)}
              className="rounded bg-wa-green px-3 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              Übernehmen
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const next: DueDateTime = {
                date: today,
                time: isValidHm(draft.time) ? draft.time : DEFAULT_DUE_TIME,
              };
              if (commitOnSelect) applyAndMaybeClose(next);
              else setDraft(next);
            }}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            Heute
          </button>
        </div>
      </div>,
      document.body
    )
  ) : null;

  const compact = variant === "compact";

  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open) updatePanelPosition();
          setOpen((o) => !o);
        }}
        className={[
          "flex items-center gap-1 rounded border border-wa-border bg-wa-input-bg text-wa-text-primary hover:border-wa-green/50",
          compact ? "px-1.5 py-0.5 text-xs" : "w-full px-2 py-1 text-sm",
          open ? "border-blue-500 ring-1 ring-blue-500/30" : "",
        ].join(" ")}
        title="Frist wählen"
      >
        <span className="truncate">{displayLabel}</span>
        <span className="shrink-0 opacity-60" aria-hidden>
          📅
        </span>
      </button>
      {panel}
    </div>
  );
}
