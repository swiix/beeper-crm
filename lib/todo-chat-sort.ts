import type { BeeperChat } from "@/lib/types";
import { getChatLastActivityIso } from "@/lib/todo-chat-inbox-status";

export function isTodoChatPinned(chat: BeeperChat, localPinnedChatIds: string[]): boolean {
  if (!chat.id) return false;
  if (localPinnedChatIds.includes(chat.id)) return true;
  return chat.isPinned === true;
}

function lastActivityMs(chat: BeeperChat): number {
  const iso = getChatLastActivityIso(chat);
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/** Pinned chats first (local pin order, then Beeper pin), then by last activity desc. */
export function sortTodoChatsForDisplay(
  chats: BeeperChat[],
  localPinnedChatIds: string[]
): BeeperChat[] {
  const localPinOrder = new Map(localPinnedChatIds.map((id, index) => [id, index]));

  return [...chats].sort((a, b) => {
    const aPinned = isTodoChatPinned(a, localPinnedChatIds);
    const bPinned = isTodoChatPinned(b, localPinnedChatIds);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;

    if (aPinned && bPinned) {
      const aLocal = a.id ? localPinOrder.get(a.id) : undefined;
      const bLocal = b.id ? localPinOrder.get(b.id) : undefined;
      if (aLocal != null && bLocal != null) return aLocal - bLocal;
      if (aLocal != null && bLocal == null) return -1;
      if (aLocal == null && bLocal != null) return 1;
    }

    return lastActivityMs(b) - lastActivityMs(a);
  });
}

export function sortTodoChatIds(
  chatIds: string[],
  chatsById: Map<string, BeeperChat>,
  localPinnedChatIds: string[]
): string[] {
  const chats = chatIds
    .map((id) => chatsById.get(id))
    .filter((chat): chat is BeeperChat => chat != null && Boolean(chat.id));
  return sortTodoChatsForDisplay(chats, localPinnedChatIds).map((chat) => chat.id);
}
