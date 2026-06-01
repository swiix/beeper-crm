/**
 * Prewarm transcript cache for chats before running analysis.
 * Fetches messages per chat and transcribes all audio so analysis uses full content.
 */

import { beeperJson } from "@/lib/beeper";
import { runWithConcurrency } from "@/lib/run-with-concurrency";
import { MAX_CHAT_MESSAGES } from "@/lib/chat-message-limits";
import { getTranscript } from "@/lib/transcribe";
import {
  fetchLastChatMessages,
  isAudioAttachment,
  type BeeperMessagesResponse,
} from "@/lib/beeper-chat-messages";

const MESSAGE_LIMIT = MAX_CHAT_MESSAGES;

interface MessageItem {
  text?: string;
  senderName?: string;
  isSender?: boolean;
  attachments?: Array<{ type?: string; srcURL?: string; id?: string }>;
  sortKey?: string;
  timestamp?: string;
}

export async function fetchLastMessages(chatId: string, limit: number): Promise<MessageItem[]> {
  return fetchLastChatMessages<MessageItem, MessageItem>(
    chatId,
    {
      limit,
      fetchPage: (path) => beeperJson<BeeperMessagesResponse<MessageItem>>(path),
    },
    (m) => ({
      text: m.text,
      senderName: m.senderName,
      isSender: m.isSender,
      attachments: m.attachments,
      sortKey: m.sortKey,
      timestamp: m.timestamp,
    })
  );
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
