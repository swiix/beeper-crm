import { describe, expect, it } from "vitest";
import { applyTodoAnalyzePreset, detectPresetFromValues, suggestPresetForChat } from "@/lib/todo-analyze-presets";
import type { TodoAnalyzeSettingsValues } from "@/components/todo/TodoAnalyzeSettingsForm";

const base: TodoAnalyzeSettingsValues = {
  promptSuffix: "",
  onePromptAllChats: "",
  scanMode: "both",
  maxAgeValue: 7,
  maxAgeUnit: "days",
  maxMessages: 30,
  attachmentMode: "fast",
  analyzeForce: false,
};

describe("todo-analyze-presets", () => {
  it("applyTodoAnalyzePreset sets thorough values", () => {
    const out = applyTodoAnalyzePreset("thorough", base);
    expect(out.attachmentMode).toBe("full");
    expect(out.maxMessages).toBe(50);
  });

  it("detectPresetFromValues recognizes daily_fast", () => {
    expect(detectPresetFromValues(base)).toBe("daily_fast");
  });

  it("suggestPresetForChat prefers thorough for groups", () => {
    expect(suggestPresetForChat({ id: "1", type: "group" } as never)).toBe("thorough");
  });
});
