"use client";

import { useMemo } from "react";
import { clampChatMessageCount } from "@/lib/chat-message-limits";
import type {
  TodoAnalyzeAttachmentMode,
  TodoAnalyzeMaxAgeUnit,
  TodoAnalyzeScanMode,
} from "@/lib/settings";

export type TodoAnalyzeSettingsValues = {
  promptSuffix: string;
  onePromptAllChats: string;
  scanMode: TodoAnalyzeScanMode;
  maxAgeValue: number;
  maxAgeUnit: TodoAnalyzeMaxAgeUnit;
  maxMessages: number;
  attachmentMode: TodoAnalyzeAttachmentMode;
  analyzeForce: boolean;
};

export function computeAnalyzeMaxAgeDays(
  maxAgeValue: number,
  maxAgeUnit: TodoAnalyzeMaxAgeUnit
): number {
  const value = Math.max(1, Math.round(maxAgeValue || 1));
  if (maxAgeUnit === "weeks") return value * 7;
  if (maxAgeUnit === "months") return value * 30;
  return value;
}

export function buildAnalyzeRequestFields(settings: TodoAnalyzeSettingsValues) {
  const maxAgeDays = computeAnalyzeMaxAgeDays(settings.maxAgeValue, settings.maxAgeUnit);
  const scanMode = settings.scanMode;
  return {
    messageScanMode: scanMode,
    maxMessages: scanMode === "age" ? undefined : Math.max(0, Math.round(settings.maxMessages || 0)),
    maxMessageAgeDays: scanMode === "count" ? undefined : maxAgeDays,
    attachmentMode: settings.attachmentMode,
    force: settings.analyzeForce,
    promptSuffix: settings.promptSuffix.trim() || undefined,
    onePrompt: settings.onePromptAllChats.trim() || undefined,
  };
}

type TodoAnalyzeSettingsFormProps = {
  values: TodoAnalyzeSettingsValues;
  onChange: (patch: Partial<TodoAnalyzeSettingsValues>) => void;
  idPrefix: string;
  showOnePrompt?: boolean;
  showPromptSuffix?: boolean;
  preview?: {
    selectedChatCount: number;
    visibleChatCount: number;
  };
};

export function TodoAnalyzeSettingsForm({
  values,
  onChange,
  idPrefix,
  showOnePrompt = true,
  showPromptSuffix = true,
  preview,
}: TodoAnalyzeSettingsFormProps) {
  const maxAgeDays = useMemo(
    () => computeAnalyzeMaxAgeDays(values.maxAgeValue, values.maxAgeUnit),
    [values.maxAgeValue, values.maxAgeUnit]
  );

  const scanSummary =
    values.scanMode === "both"
      ? `max ${values.maxMessages} Nachrichten und max ${maxAgeDays} Tage`
      : values.scanMode === "age"
        ? `nur Nachrichten aus den letzten ${maxAgeDays} Tagen`
        : `nur die letzten ${values.maxMessages} Nachrichten`;

  return (
    <div className="space-y-3">
      {showPromptSuffix && (
        <div>
          <label htmlFor={`${idPrefix}-prompt-suffix`} className="block text-xs font-medium text-wa-text-secondary">
            Zusatz zum Prompt (wird an den System-Prompt angehängt)
          </label>
          <textarea
            id={`${idPrefix}-prompt-suffix`}
            placeholder="z. B. Berücksichtige nur geschäftliche Todos. Ignoriere private Verabredungen."
            value={values.promptSuffix}
            onChange={(e) => onChange({ promptSuffix: e.target.value })}
            rows={2}
            className="mt-1 w-full rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none"
          />
        </div>
      )}
      {showOnePrompt && (
        <div>
          <label htmlFor={`${idPrefix}-one-prompt`} className="block text-xs font-medium text-wa-text-secondary">
            One-Prompt (nur für „One-Prompt auf alle sichtbaren Chats“)
          </label>
          <textarea
            id={`${idPrefix}-one-prompt`}
            placeholder="Freier Prompt für alle Chats. Nur Ergebnisse aus diesem Prompt werden übernommen."
            value={values.onePromptAllChats}
            onChange={(e) => onChange({ onePromptAllChats: e.target.value })}
            rows={4}
            className="mt-1 w-full rounded-lg border border-blue-400/30 bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-blue-400 focus:outline-none"
          />
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block text-xs text-wa-text-secondary">
          Analyse-Modus
          <select
            value={values.scanMode}
            onChange={(e) => onChange({ scanMode: e.target.value as TodoAnalyzeScanMode })}
            title="Nach Alter, Nachrichtenanzahl oder beidem filtern"
            className="mt-1 w-full rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary"
          >
            <option value="both">Beides (Alter + Anzahl)</option>
            <option value="age">Nur Alter</option>
            <option value="count">Nur Anzahl</option>
          </select>
        </label>
        <label className="block text-xs text-wa-text-secondary">
          Max. Alter
          <div className="mt-1 flex gap-1">
            <input
              type="number"
              min={1}
              value={values.maxAgeValue}
              onChange={(e) => {
                const v = Math.max(1, parseInt(e.target.value || "1", 10) || 1);
                onChange({ maxAgeValue: v });
              }}
              disabled={values.scanMode === "count"}
              className="w-20 rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary disabled:opacity-50"
            />
            <select
              value={values.maxAgeUnit}
              onChange={(e) => onChange({ maxAgeUnit: e.target.value as TodoAnalyzeMaxAgeUnit })}
              disabled={values.scanMode === "count"}
              title="Einheit für maximales Nachrichtsalter"
              className="flex-1 rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary disabled:opacity-50"
            >
              <option value="days">Tage</option>
              <option value="weeks">Wochen</option>
              <option value="months">Monate</option>
            </select>
          </div>
        </label>
        <label className="block text-xs text-wa-text-secondary">
          Letzte X Nachrichten (max. 50)
          <input
            type="number"
            min={0}
            max={50}
            value={values.maxMessages}
            onChange={(e) => {
              const n = clampChatMessageCount(parseInt(e.target.value || "0", 10) || 0);
              onChange({ maxMessages: n });
            }}
            disabled={values.scanMode === "age"}
            className="mt-1 w-full rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary disabled:opacity-50"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-xs text-wa-text-secondary">
          <span>Analyse-Tiefe</span>
          <select
            value={values.attachmentMode}
            onChange={(e) => onChange({ attachmentMode: e.target.value as TodoAnalyzeAttachmentMode })}
            title="Schnell: nur Text; Vollständig: inkl. Bilder/Audio (mehr Kosten)"
            className="rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary"
          >
            <option value="fast">Schnell (ohne Bilder/Audio)</option>
            <option value="full">Vollständig (mit Bilder/Audio)</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-wa-text-secondary">
          <input
            type="checkbox"
            checked={values.analyzeForce}
            onChange={(e) => onChange({ analyzeForce: e.target.checked })}
            className="h-4 w-4 rounded border-wa-border bg-wa-input-bg text-wa-green"
          />
          Cache ignorieren (Erzwingen)
        </label>
      </div>
      <p className="text-[11px] text-wa-text-secondary">Aktuell: {scanSummary}.</p>
      {preview && (
        <p className="text-[11px] text-wa-text-secondary">
          Vorschau: Wird analysiert mit {values.attachmentMode === "fast" ? "Schnell-Modus" : "Vollständig-Modus"}
          ; Auswahl: {preview.selectedChatCount} Chat(s), Sichtbar: {preview.visibleChatCount} Chat(s), Force:{" "}
          {values.analyzeForce ? "ja" : "nein"}.
        </p>
      )}
    </div>
  );
}
