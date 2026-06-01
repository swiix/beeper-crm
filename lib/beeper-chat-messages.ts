import { resolveBeeperMessagesBeforeCursor } from "@/lib/beeper-messages-cursor";

export interface ChatMessageAttachment {
  type?: string;
  srcURL?: string;
  id?: string;
}

export interface ChatMessageBase {
  text?: string;
  senderName?: string;
  isSender?: boolean;
  timestamp?: string;
  sortKey?: string;
  attachments?: ChatMessageAttachment[];
}

export interface BeeperMessagesResponse<TMessage extends { sortKey?: string }> {
  items?: TMessage[];
  hasMore?: boolean;
}

export type BeeperMessagesFetcher<TMessage extends { sortKey?: string }> = (
  path: string,
  page: number
) => Promise<BeeperMessagesResponse<TMessage>>;

export interface FetchLastChatMessagesOptions<TMessage extends { sortKey?: string }> {
  limit: number | null;
  minTimestampMs?: number | null;
  hardFetchCap?: number;
  onPage?: (page: number) => void;
  fetchPage: BeeperMessagesFetcher<TMessage>;
}

export function isAudioAttachment(att: { type?: string }): boolean {
  return (att.type ?? "").toLowerCase() === "audio";
}

export async function fetchLatestChatMarker<TMessage extends { sortKey?: string; timestamp?: string }>(
  chatId: string,
  fetchPage: BeeperMessagesFetcher<TMessage>
): Promise<{ sortKey: string | null; timestamp: string | null }> {
  const path = `/v1/chats/${encodeURIComponent(chatId)}/messages`;
  const data = await fetchPage(path, 1);
  const newest = data?.items?.[0];
  return {
    sortKey: newest?.sortKey ?? null,
    timestamp: typeof newest?.timestamp === "string" ? newest.timestamp : null,
  };
}

export async function fetchLastChatMessages<TMessage extends { sortKey?: string; timestamp?: string }, TOut>(
  chatId: string,
  options: FetchLastChatMessagesOptions<TMessage>,
  mapMessage: (message: TMessage) => TOut
): Promise<TOut[]> {
  const { limit, minTimestampMs = null, hardFetchCap = Number.POSITIVE_INFINITY, onPage, fetchPage } = options;
  const collected: TOut[] = [];
  let cursor: string | null = null;
  let page = 0;

  for (;;) {
    page += 1;
    onPage?.(page);
    const params = new URLSearchParams();
    if (cursor) {
      params.set("cursor", cursor);
      params.set("direction", "before");
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const path = `/v1/chats/${encodeURIComponent(chatId)}/messages${suffix}`;
    const data = await fetchPage(path, page);
    const items = data?.items ?? [];
    let addedFromPage = 0;
    for (const message of items) {
      const ts = typeof message.timestamp === "string" ? new Date(message.timestamp).getTime() : NaN;
      if (minTimestampMs != null && Number.isFinite(ts) && ts < minTimestampMs) {
        continue;
      }
      collected.push(mapMessage(message));
      addedFromPage += 1;
      if (limit != null && limit > 0 && collected.length >= limit) break;
    }
    const hasMore = data?.hasMore ?? false;
    const nextCursor = resolveBeeperMessagesBeforeCursor(data ?? {});
    if ((limit != null && limit > 0 && collected.length >= limit) || !hasMore || !nextCursor) break;
    if (collected.length >= hardFetchCap) break;
    if (minTimestampMs != null && addedFromPage === 0) break;
    cursor = nextCursor;
  }

  const limited = limit != null && limit > 0 ? collected.slice(0, limit) : collected;
  limited.reverse();
  return limited;
}
