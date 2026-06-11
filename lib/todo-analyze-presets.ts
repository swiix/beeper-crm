import { MAX_CHAT_MESSAGES } from "@/lib/chat-message-limits";
import type { TodoAnalyzeSettingsValues } from "@/components/todo/TodoAnalyzeSettingsForm";
import { SETTING_KEYS } from "@/lib/settings";
import type { BeeperChat } from "@/lib/types";

export type TodoAnalyzePresetId =
  | "daily_fast"
  | "thorough"
  | "cache_only"
  | "force_refresh"
  | "custom";

export type TodoAnalyzePresetDef = {
  id: Exclude<TodoAnalyzePresetId, "custom">;
  label: string;
  description: string;
  values: Omit<TodoAnalyzeSettingsValues, "promptSuffix" | "onePromptAllChats">;
};

export const TODO_ANALYZE_PRESETS: TodoAnalyzePresetDef[] = [
  {
    id: "daily_fast",
    label: "Schnell (täglich)",
    description: "7 Tage, 30 Nachrichten, ohne Bilder/Audio",
    values: {
      scanMode: "both",
      maxAgeValue: 7,
      maxAgeUnit: "days",
      maxMessages: 30,
      attachmentMode: "fast",
      analyzeForce: false,
    },
  },
  {
    id: "thorough",
    label: "Gründlich",
    description: "30 Tage, 50 Nachrichten, mit Bildern/Audio",
    values: {
      scanMode: "both",
      maxAgeValue: 30,
      maxAgeUnit: "days",
      maxMessages: MAX_CHAT_MESSAGES,
      attachmentMode: "full",
      analyzeForce: false,
    },
  },
  {
    id: "cache_only",
    label: "Nur ohne Cache",
    description: "Schnell – überspringt Chats mit frischem Cache-Marker",
    values: {
      scanMode: "both",
      maxAgeValue: 7,
      maxAgeUnit: "days",
      maxMessages: 30,
      attachmentMode: "fast",
      analyzeForce: false,
    },
  },
  {
    id: "force_refresh",
    label: "Alles neu",
    description: "Gründlich – Cache wird ignoriert",
    values: {
      scanMode: "both",
      maxAgeValue: 30,
      maxAgeUnit: "days",
      maxMessages: MAX_CHAT_MESSAGES,
      attachmentMode: "full",
      analyzeForce: true,
    },
  },
];

const PRESET_MAP = new Map(TODO_ANALYZE_PRESETS.map((p) => [p.id, p]));

export function isTodoAnalyzePresetId(id: string): id is Exclude<TodoAnalyzePresetId, "custom"> {
  return PRESET_MAP.has(id as Exclude<TodoAnalyzePresetId, "custom">);
}

export function isStoredTodoAnalyzePresetId(id: string): id is TodoAnalyzePresetId {
  return id === "custom" || isTodoAnalyzePresetId(id);
}

export function applyTodoAnalyzePreset(
  presetId: Exclude<TodoAnalyzePresetId, "custom">,
  current: TodoAnalyzeSettingsValues
): TodoAnalyzeSettingsValues {
  const preset = PRESET_MAP.get(presetId);
  if (!preset) return current;
  return {
    ...current,
    ...preset.values,
  };
}

/** Settings for a quick run: custom keeps saved values, named presets merge their defaults. */
export function resolveQuickRunAnalyzeSettings(
  presetId: TodoAnalyzePresetId,
  current: TodoAnalyzeSettingsValues
): TodoAnalyzeSettingsValues {
  if (presetId === "custom") return current;
  return applyTodoAnalyzePreset(presetId, current);
}

export function detectPresetFromValues(values: TodoAnalyzeSettingsValues): TodoAnalyzePresetId {
  for (const preset of TODO_ANALYZE_PRESETS) {
    const v = preset.values;
    if (
      values.scanMode === v.scanMode &&
      values.maxAgeValue === v.maxAgeValue &&
      values.maxAgeUnit === v.maxAgeUnit &&
      values.maxMessages === v.maxMessages &&
      values.attachmentMode === v.attachmentMode &&
      values.analyzeForce === v.analyzeForce
    ) {
      return preset.id;
    }
  }
  return "custom";
}

/** Heuristic default preset from chat shape. */
export function suggestPresetForChat(chat: BeeperChat): Exclude<TodoAnalyzePresetId, "custom"> {
  if (chat.isArchived) return "cache_only";
  const type = (chat.type ?? "").toLowerCase();
  if (type === "group") return "thorough";
  return "daily_fast";
}

export const LAST_TODO_ANALYZE_PRESET_KEY = SETTING_KEYS.lastTodoAnalyzePreset;

export function getLastTodoAnalyzePreset(): TodoAnalyzePresetId | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(LAST_TODO_ANALYZE_PRESET_KEY);
  if (raw && isStoredTodoAnalyzePresetId(raw)) return raw;
  return null;
}

export function setLastTodoAnalyzePreset(id: TodoAnalyzePresetId): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(LAST_TODO_ANALYZE_PRESET_KEY, id);
}
