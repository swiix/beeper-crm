/**
 * Prewarm transcript cache for chats before running analysis.
 * Fetches messages per chat and transcribes all audio so analysis uses full content.
 */

import { beeperJson } from "@/lib/beeper";
import { resolveBeeperMessagesBeforeCursor } from "@/lib/beeper-messages-cursor";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { getTranscript } from "@/lib/transcribe";

const MESSAGE_LIMIT = 50;

interface MessageItem {
  text?: string;
  senderName?: string;
  isSender?: boolean;
  attachments?: Array<{ type?: string; srcURL?: string; id?: string }>;
}

function isAudioAttachment(att: { type?: string }): boolean {
  return (att.type ?? "").toLowerCase() === "audio";
}

interface BeeperMessagesResponse {
  items?: Array<MessageItem & { sortKey?: string }>;
  hasMore?: boolean;
}

export async function fetchLastMessages(chatId: string, limit: number): Promise<MessageItem[]> {
  const collected: MessageItem[] = [];
  let cursor: string | null = null;
  const pathBase = `/v1/chats/${encodeURIComponent(chatId)}/messages`;
  for (;;) {
    const params = new URLSearchParams();
    if (cursor) {
      params.set("cursor", cursor);
      params.set("direction", "before");
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const data = await beeperJson<BeeperMessagesResponse>(`${pathBase}${suffix}`);
    const items = data?.items ?? [];
    for (const m of items) {
      collected.push({
        text: m.text,
        senderName: m.senderName,
        isSender: m.isSender,
        attachments: m.attachments,
      });
    }
    const hasMore = data?.hasMore ?? false;
    const nextCursor = resolveBeeperMessagesBeforeCursor(data ?? {});
    if (collected.length >= limit || !hasMore || !nextCursor) break;
    cursor = nextCursor;
  }
  const last = collected.slice(0, limit);
  last.reverse();
  return last;
}

/** Transcribe all audio in messages for one chat (fills transcript cache). */
export async function prewarmTranscriptsForChat(chatId: string, limit: number = MESSAGE_LIMIT): Promise<void> {
  const messages = await fetchLastMessages(chatId, limit);
  const audioUrls = messages.flatMap((m) =>
    (m.attachments ?? [])
      .filter(isAudioAttachment)
      .map((att) => att.srcURL ?? att.id ?? "")
      .filter(Boolean)
  );
  await Promise.all(audioUrls.map((url) => getTranscript(url)));
}

const DEFAULT_CHAT_PREWARM_CONCURRENCY = 12;

/** Prewarm transcript cache for multiple chats with a concurrency limit. */
export async function prewarmTranscriptsForChats(
  chatIds: string[],
  concurrency: number = DEFAULT_CHAT_PREWARM_CONCURRENCY
): Promise<void> {
  const limit = Math.max(1, Math.min(50, Math.round(concurrency)));
  await runWithConcurrency(limit, chatIds, async (id) => {
    await prewarmTranscriptsForChat(id);
  });
}
