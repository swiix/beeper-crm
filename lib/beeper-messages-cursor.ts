/**
 * Beeper GET /v1/chats/{chatId}/messages returns `items` with the newest message first.
 * For `direction=before` pagination, the cursor must reference the oldest message in the
 * current page (last element in `items`), unless the API provides `nextCursor` / `oldestCursor`.
 *
 * Using `items[0].sortKey` (newest) breaks paging for bridges (Instagram, WhatsApp, etc.)
 * when `nextCursor` is omitted from the JSON response.
 */

export function resolveBeeperMessagesBeforeCursor(data: {
  items?: Array<{ sortKey?: string } | undefined> | undefined;
  nextCursor?: string | null;
  oldestCursor?: string | null;
}): string | null {
  const explicit = data.nextCursor ?? data.oldestCursor ?? null;
  if (explicit != null && String(explicit).length > 0) {
    return String(explicit);
  }
  const items = data.items ?? [];
  if (items.length === 0) return null;
  const oldestInPage = items[items.length - 1];
  return oldestInPage?.sortKey ?? null;
}
