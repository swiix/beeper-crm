import { describe, expect, it } from "vitest";
import { isTodoChatPinned, sortTodoChatsForDisplay, sortTodoChatIds } from "@/lib/todo-chat-sort";
import type { BeeperChat } from "@/lib/types";

function chat(id: string, lastActivity: string, isPinned = false): BeeperChat {
  return { id, lastActivity, isPinned };
}

describe("todo-chat-sort", () => {
  it("treats local and Beeper pins as pinned", () => {
    expect(isTodoChatPinned(chat("a", "2026-01-01"), ["a"])).toBe(true);
    expect(isTodoChatPinned(chat("b", "2026-01-01", true), [])).toBe(true);
    expect(isTodoChatPinned(chat("c", "2026-01-01"), [])).toBe(false);
  });

  it("sorts pinned chats before others and keeps local pin order", () => {
    const chats = [
      chat("old", "2026-06-01"),
      chat("pinned-beeper", "2026-01-01", true),
      chat("pinned-local-2", "2026-01-01"),
      chat("pinned-local-1", "2026-01-01"),
      chat("recent", "2026-06-10"),
    ];
    const sorted = sortTodoChatsForDisplay(chats, ["pinned-local-1", "pinned-local-2"]);
    expect(sorted.map((c) => c.id)).toEqual([
      "pinned-local-1",
      "pinned-local-2",
      "pinned-beeper",
      "recent",
      "old",
    ]);
  });

  it("sorts chat ids using chat metadata", () => {
    const byId = new Map<string, BeeperChat>([
      ["a", chat("a", "2026-06-01")],
      ["b", chat("b", "2026-06-02", true)],
    ]);
    expect(sortTodoChatIds(["a", "b"], byId, [])).toEqual(["b", "a"]);
  });
});
