import { describe, expect, it } from "vitest";
import { formatTodoAnalyzeSettingsTooltip } from "@/lib/todo-analyze-settings-tooltip";
import type { TodoAnalyzeSettingsValues } from "@/components/todo/TodoAnalyzeSettingsForm";

const base: TodoAnalyzeSettingsValues = {
  promptSuffix: "nur offene todos",
  onePromptAllChats: "",
  scanMode: "both",
  maxAgeValue: 7,
  maxAgeUnit: "days",
  maxMessages: 30,
  attachmentMode: "fast",
  analyzeForce: false,
};

describe("formatTodoAnalyzeSettingsTooltip", () => {
  it("includes preset, scan, depth, cache and prompt suffix", () => {
    const text = formatTodoAnalyzeSettingsTooltip(base, { presetId: "daily_fast" });
    expect(text).toContain("Preset: Schnell (täglich)");
    expect(text).toContain("7 Tage · max. 30 Nachrichten");
    expect(text).toContain("Schnell (ohne Bilder/Audio)");
    expect(text).toContain("Cache ignorieren: nein");
    expect(text).toContain("Prompt-Zusatz: nur offene todos");
  });

  it("appends action hint on a separate line", () => {
    const text = formatTodoAnalyzeSettingsTooltip(base, {
      presetId: "custom",
      actionHint: "Shift+Klick: Einstellungen",
    });
    expect(text).toContain("Preset: Eigene");
    expect(text.endsWith("Shift+Klick: Einstellungen")).toBe(true);
  });
});
