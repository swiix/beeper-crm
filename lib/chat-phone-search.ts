import type { BeeperChat } from "@/lib/types";

type ChatParticipantLike = {
  id?: string;
  name?: string;
  handle?: string;
  phoneNumber?: string;
};

/**
 * Beeper may return participants as an array or as `{ items: [...] }` (and occasionally a map).
 */
export function getChatParticipantItems(chat: { participants?: unknown }): ChatParticipantLike[] {
  const raw = chat.participants;
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw as ChatParticipantLike[];
  if (typeof raw !== "object") return [];
  const withItems = raw as { items?: unknown };
  if (Array.isArray(withItems.items)) return withItems.items as ChatParticipantLike[];
  const values = Object.values(raw as Record<string, unknown>);
  if (values.length > 0 && values.every((v) => v != null && typeof v === "object" && !Array.isArray(v))) {
    return values as ChatParticipantLike[];
  }
  return [];
}

/** Strip spaces and formatting; keep leading + and digits (min 7). */
export function normalizePhoneValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/[^\d+]/g, "");
  if (compact.length < 7) return null;
  return compact.startsWith("+") ? compact : compact;
}

/** Digits only — for substring matching (+49 172 … vs 491724066936). */
export function phoneDigitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function pushPhoneCandidate(out: string[], raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  out.push(trimmed);
  const normalized = normalizePhoneValue(trimmed);
  if (normalized) out.push(normalized);
  const digits = phoneDigitsOnly(trimmed);
  if (digits.length >= 7) out.push(digits);
  const wa = trimmed.match(/whatsapp_([0-9]{7,})/i);
  if (wa?.[1]) {
    out.push(`+${wa[1]}`);
    out.push(wa[1]);
  }
}

/** Collect phone-like strings from chat id, title/name, and participants. */
export function extractPhonesFromChat(chat: BeeperChat): string[] {
  const out: string[] = [];
  if (chat.id) pushPhoneCandidate(out, chat.id);
  if (chat.name) pushPhoneCandidate(out, chat.name);
  for (const p of getChatParticipantItems(chat)) {
    if (p.id) pushPhoneCandidate(out, p.id);
    if (p.name) pushPhoneCandidate(out, p.name);
    if (p.handle) pushPhoneCandidate(out, p.handle);
    if (typeof p.phoneNumber === "string") pushPhoneCandidate(out, p.phoneNumber);
  }
  return [...new Set(out)];
}

function textMatchesQuery(haystack: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const h = haystack.toLowerCase();
  const qLower = q.toLowerCase();
  if (h.includes(qLower)) return true;
  const hCompact = haystack.replace(/\s+/g, "").toLowerCase();
  const qCompact = q.replace(/\s+/g, "").toLowerCase();
  return qCompact.length > 0 && hCompact.includes(qCompact);
}

function phoneMatchesQuery(chat: BeeperChat, query: string): boolean {
  const qNorm = normalizePhoneValue(query);
  const qDigits = phoneDigitsOnly(query);
  if (!qNorm && qDigits.length < 4) return false;

  for (const hay of extractPhonesFromChat(chat)) {
    const hayNorm = normalizePhoneValue(hay);
    const hayDigits = phoneDigitsOnly(hay);
    if (qNorm && hayNorm && (hayNorm.includes(qNorm) || qNorm.includes(hayNorm))) return true;
    if (qDigits.length >= 4 && hayDigits.includes(qDigits)) return true;
  }
  return false;
}

/**
 * Filter chats by name/id; when searchPhones is true (e.g. WhatsApp account), also match phone numbers.
 * Spaces in the query are ignored for phone matching; name search accepts compact match without spaces.
 */
export function chatMatchesSearchQuery(
  chat: BeeperChat,
  query: string,
  options?: { searchPhones?: boolean }
): boolean {
  const q = query.trim();
  if (!q) return true;

  const name = (chat.name ?? getChatParticipantItems(chat)[0]?.name ?? "").toString();
  const id = (chat.id ?? "").toString();

  if (textMatchesQuery(name, q) || textMatchesQuery(id, q)) return true;
  if (options?.searchPhones && phoneMatchesQuery(chat, q)) return true;
  return false;
}
