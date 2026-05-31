import { describe, expect, it } from "vitest";
import { assertTodoSyncTarget } from "@/lib/todo-auto-sync";

describe("todo-auto-sync", () => {
  it("assertTodoSyncTarget blocks wrong target (default google)", () => {
    expect(assertTodoSyncTarget("google")).toBeNull();
    expect(assertTodoSyncTarget("reclaim")).toMatch(/Google Tasks/i);
  });
});
