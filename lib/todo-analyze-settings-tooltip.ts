import {
  computeAnalyzeMaxAgeDays,
  type TodoAnalyzeSettingsValues,
} from "@/components/todo/TodoAnalyzeSettingsForm";
import {
  detectPresetFromValues,
  TODO_ANALYZE_PRESETS,
  type TodoAnalyzePresetId,
} from "@/lib/todo-analyze-presets";

const PRESET_LABEL_BY_ID: Record<TodoAnalyzePresetId, string> = {
  daily_fast: "Schnell (täglich)",
  thorough: "Gründlich",
  cache_only: "Nur ohne Cache",
  force_refresh: "Alles neu",
  custom: "Eigene",
};

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function presetLabel(presetId: TodoAnalyzePresetId): string {
  return TODO_ANALYZE_PRESETS.find((p) => p.id === presetId)?.label ?? PRESET_LABEL_BY_ID[presetId];
}

function scanModeLabel(settings: TodoAnalyzeSettingsValues): string {
  const days = computeAnalyzeMaxAgeDays(settings.maxAgeValue, settings.maxAgeUnit);
  if (settings.scanMode === "both") {
    return `${days} Tage · max. ${settings.maxMessages} Nachrichten`;
  }
  if (settings.scanMode === "age") {
    return `nur ${days} Tage`;
  }
  return `nur ${settings.maxMessages} Nachrichten`;
}

function scanModeDetail(settings: TodoAnalyzeSettingsValues): string {
  if (settings.scanMode === "both") return "Alter + Anzahl";
  if (settings.scanMode === "age") return "Nur Alter";
  return "Nur Anzahl";
}

/** Multi-line native tooltip text for analyze quick-run buttons. */
export function formatTodoAnalyzeSettingsTooltip(
  settings: TodoAnalyzeSettingsValues,
  options?: {
    presetId?: TodoAnalyzePresetId | null;
    actionHint?: string;
  }
): string {
  const presetId = options?.presetId ?? detectPresetFromValues(settings);
  const lines = [
    `Preset: ${presetLabel(presetId)}`,
    `Analyse-Modus: ${scanModeDetail(settings)}`,
    `Scan: ${scanModeLabel(settings)}`,
    `Analyse-Tiefe: ${settings.attachmentMode === "fast" ? "Schnell (ohne Bilder/Audio)" : "Vollständig (mit Bilder/Audio)"}`,
    `Cache ignorieren: ${settings.analyzeForce ? "ja" : "nein"}`,
  ];

  const suffix = settings.promptSuffix.trim();
  if (suffix) lines.push(`Prompt-Zusatz: ${truncate(suffix, 140)}`);

  const onePrompt = settings.onePromptAllChats.trim();
  if (onePrompt) lines.push(`One-Prompt: ${truncate(onePrompt, 140)}`);

  if (options?.actionHint) {
    lines.push("");
    lines.push(options.actionHint);
  }

  return lines.join("\n");
}
