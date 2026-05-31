/**
 * Prewarm transcript cache for chats before running analysis.
 * Fetches messages per chat and transcribes all audio so analysis uses full content.
 */

import { beeperJson } from "@/lib/beeper";
import { resolveBeeperMessagesBeforeCursor } from "@/lib/beeper-messages-cursor";
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
  for (const m of messages) {
    const audioAttachments = (m.attachments ?? []).filter(isAudioAttachment);
    for (const att of audioAttachments) {
      const audioUrl = att.srcURL ?? att.id ?? "";
      if (audioUrl) await getTranscript(audioUrl);
    }
  }
}

/** Prewarm transcript cache for multiple chats. Runs per-chat in parallel. */
export async function prewarmTranscriptsForChats(chatIds: string[]): Promise<void> {
  await Promise.all(chatIds.map((id) => prewarmTranscriptsForChat(id)));
}
