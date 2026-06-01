import { describe, expect, it } from "vitest";
import { chatMatchesInboxFilter, computeTodoChatInboxStatus } from "@/lib/todo-chat-inbox-status";

describe("todo-chat-inbox-status", () => {
  it("returns ignored when flagged", () => {
    expect(
      computeTodoChatInboxStatus({
        chatId: "c1",
        ignored: true,
        openSuggestionCount: 5,
        meta: undefined,
        chatLastActivity: null,
      })
    ).toBe("ignored");
  });

  it("returns has_open when suggestions in state", () => {
    expect(
      computeTodoChatInboxStatus({
        chatId: "c1",
        ignored: false,
        openSuggestionCount: 2,
        meta: undefined,
        chatLastActivity: null,
      })
    ).toBe("has_open");
  });

  it("filters stale chats", () => {
    expect(chatMatchesInboxFilter("stale", "stale")).toBe(true);
    expect(chatMatchesInboxFilter("never", "stale")).toBe(false);
  });
});
