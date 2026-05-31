/**
 * Normalize Beeper API responses to our BeeperChat/BeeperMessage shape.
 * API uses title/preview; we use name/lastMessage for UI.
 */

interface RawChatItem {
  id?: string;
  accountID?: string;
  title?: string;
  preview?: { text?: string; senderName?: string; timestamp?: string; isSender?: boolean };
  participants?: { items?: Array<{ imgURL?: string }> };
  isArchived?: boolean;
  [key: string]: unknown;
}

/** Map API chat item to UI shape: name from title, lastMessage from preview (incl. isSender), image from first participant */
export function normalizeChatItem(raw: RawChatItem): Record<string, unknown> {
  const preview = raw.preview;
  const firstParticipant = raw.participants?.items?.[0];
  return {
    ...raw,
    name: raw.title ?? raw.id ?? "",
    lastMessage: preview
      ? {
          text: preview.text,
          senderName: preview.senderName,
          timestamp: preview.timestamp,
          isSender: preview.isSender,
        }
      : undefined,
    image: firstParticipant?.imgURL,
  };
}

export function normalizeChatsResponse(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const d = data as {
    items?: RawChatItem[];
    hasMore?: boolean;
    oldestCursor?: string;
    nextCursor?: string;
    newestCursor?: string;
  };
  if (!Array.isArray(d.items)) return data;
  const items = d.items.map(normalizeChatItem);
  // Some bridges (e.g. Instagram) return nextCursor only; SWR infinite paging expects oldestCursor.
  let oldestCursor = d.oldestCursor ?? d.nextCursor ?? null;
  if (d.hasMore && oldestCursor == null && items.length > 0) {
    const last = items[items.length - 1] as RawChatItem & { sortKey?: string };
    const preview = last.preview as { sortKey?: string } | undefined;
    if (typeof last.sortKey === "string") oldestCursor = last.sortKey;
    else if (preview && typeof preview.sortKey === "string") oldestCursor = preview.sortKey;
  }
  return {
    ...d,
    items,
    ...(oldestCursor != null ? { oldestCursor } : {}),
  };
}

export function normalizeChatDetailResponse(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  return normalizeChatItem(data as RawChatItem);
}
