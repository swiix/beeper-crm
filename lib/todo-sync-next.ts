export const GOOGLE_NEXT_TITLE_PREFIX = "upnext ";

/** Prefix Google Task title when marking a todo as Up Next. */
export function applyGoogleNextTitle(title: string, markAsNext: boolean): string {
  const trimmed = title.trim();
  if (!markAsNext || !trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith(GOOGLE_NEXT_TITLE_PREFIX)) return trimmed;
  return `${GOOGLE_NEXT_TITLE_PREFIX}${trimmed}`;
}
