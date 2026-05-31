/** Local calendar helpers (Europe/Berlin-style wall clock, no TZ library). */

export const WEEKDAY_SHORT_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
export const MONTH_NAMES_DE = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
] as const;

export function localCalendarTodayYmd(): string {
  const n = new Date();
  const y = n.getFullYear();
  const m = String(n.getMonth() + 1).padStart(2, "0");
  const d = String(n.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addLocalDays(fromYmd: string, deltaDays: number): string {
  const d = new Date(fromYmd + "T12:00:00");
  if (Number.isNaN(d.getTime())) {
    return addLocalDays(localCalendarTodayYmd(), deltaDays);
  }
  d.setDate(d.getDate() + deltaDays);
  return ymdFromDate(d);
}

export function addLocalMonths(fromYmd: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromYmd);
  if (!m) {
    return addLocalMonths(localCalendarTodayYmd(), months);
  }
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const d = new Date(y, mo + months, day);
  return ymdFromDate(d);
}

export function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(ymd: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
}

export function formatYmdDisplay(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  const [, y, mo, d] = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
  return `${d}.${mo}.${y}`;
}

export function formatHmDisplay(hm: string | null | undefined): string {
  if (!hm || !/^\d{2}:\d{2}$/.test(hm)) return "";
  return hm;
}

/** Monday = 0 … Sunday = 6 */
export function mondayBasedWeekdayFromYmd(ymd: string): number {
  const d = new Date(ymd + "T12:00:00");
  const js = d.getDay();
  return js === 0 ? 6 : js - 1;
}

/** Next occurrence of weekday (Mon=0 … Sun=6), strictly after `fromYmd` if same day use +7 unless includeToday */
export function nextWeekdayYmd(fromYmd: string, weekday: number, includeToday = false): string {
  const cur = mondayBasedWeekdayFromYmd(fromYmd);
  let diff = weekday - cur;
  if (diff < 0 || (diff === 0 && !includeToday)) diff += 7;
  if (diff === 0 && includeToday) return fromYmd;
  return addLocalDays(fromYmd, diff);
}

/** Next Mon–Fri strictly after `fromYmd` (Fri → Mon, weekend → Mon). */
export function nextWorkdayYmd(fromYmd: string): string {
  let candidate = addLocalDays(fromYmd, 1);
  for (let i = 0; i < 10; i++) {
    if (mondayBasedWeekdayFromYmd(candidate) <= 4) return candidate;
    candidate = addLocalDays(candidate, 1);
  }
  return addLocalDays(fromYmd, 1);
}

export type CalendarDayCell = {
  ymd: string;
  inMonth: boolean;
  isToday: boolean;
};

/** 6 rows × 7 cols, week starts Monday */
export function buildCalendarMonthGrid(year: number, month: number): CalendarDayCell[] {
  const today = localCalendarTodayYmd();
  const firstOfMonth = new Date(year, month - 1, 1);
  const startYmd = ymdFromDate(firstOfMonth);
  const offset = mondayBasedWeekdayFromYmd(startYmd);
  const gridStart = addLocalDays(startYmd, -offset);
  const cells: CalendarDayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const ymd = addLocalDays(gridStart, i);
    const p = parseYmd(ymd);
    cells.push({
      ymd,
      inMonth: p != null && p.year === year && p.month === month,
      isToday: ymd === today,
    });
  }
  return cells;
}
