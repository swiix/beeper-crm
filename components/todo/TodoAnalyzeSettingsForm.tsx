"use client";

import { useMemo, type ReactNode } from "react";
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
  /** Single-column layout for narrow containers (e.g. analyze modal). */
  compactLayout?: boolean;
  preview?: {
    selectedChatCount: number;
    visibleChatCount: number;
  };
};

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-wa-text-secondary">
      {children}
    </label>
  );
}

export function TodoAnalyzeSettingsForm({
  values,
  onChange,
  idPrefix,
  showOnePrompt = true,
  showPromptSuffix = true,
  compactLayout = false,
  preview,
}: TodoAnalyzeSettingsFormProps) {
  const maxAgeDays = useMemo(
    () => computeAnalyzeMaxAgeDays(values.maxAgeValue, values.maxAgeUnit),
    [values.maxAgeValue, values.maxAgeUnit]
  );

  const scanSummary =
    values.scanMode === "both"
      ? `max. ${values.maxMessages} Nachrichten und max. ${maxAgeDays} Tage`
      : values.scanMode === "age"
        ? `nur Nachrichten aus den letzten ${maxAgeDays} Tagen`
        : `nur die letzten ${values.maxMessages} Nachrichten`;

  const gridClass = compactLayout ? "grid grid-cols-1 gap-3" : "grid grid-cols-1 gap-3 md:grid-cols-3";

  return (
    <div className="space-y-3">
      {showPromptSuffix && (
        <div>
          <FieldLabel htmlFor={`${idPrefix}-prompt-suffix`}>Zusatz zum Prompt</FieldLabel>
          <textarea
            id={`${idPrefix}-prompt-suffix`}
            placeholder="z. B. nur geschäftliche Todos, keine Duplikate"
            value={values.promptSuffix}
            onChange={(e) => onChange({ promptSuffix: e.target.value })}
            rows={2}
            className="tg-input min-h-[3.5rem] resize-y"
          />
        </div>
      )}
      {showOnePrompt && (
        <div>
          <FieldLabel htmlFor={`${idPrefix}-one-prompt`}>One-Prompt</FieldLabel>
          <textarea
            id={`${idPrefix}-one-prompt`}
            placeholder="Freier Prompt für alle Chats…"
            value={values.onePromptAllChats}
            onChange={(e) => onChange({ onePromptAllChats: e.target.value })}
            rows={4}
            className="tg-input min-h-[5rem] resize-y border-blue-400/30 focus:border-blue-400 focus:ring-blue-400/20"
          />
        </div>
      )}

      <div className={gridClass}>
        <div>
          <FieldLabel htmlFor={`${idPrefix}-scan-mode`}>Analyse-Modus</FieldLabel>
          <select
            id={`${idPrefix}-scan-mode`}
            value={values.scanMode}
            onChange={(e) => onChange({ scanMode: e.target.value as TodoAnalyzeScanMode })}
            className="tg-input py-1.5"
          >
            <option value="both">Beides (Alter + Anzahl)</option>
            <option value="age">Nur Alter</option>
            <option value="count">Nur Anzahl</option>
          </select>
        </div>

        <div>
          <FieldLabel htmlFor={`${idPrefix}-max-age`}>Max. Alter</FieldLabel>
          <div className="flex gap-2">
            <input
              id={`${idPrefix}-max-age`}
              type="number"
              min={1}
              value={values.maxAgeValue}
              onChange={(e) => {
                const v = Math.max(1, parseInt(e.target.value || "1", 10) || 1);
                onChange({ maxAgeValue: v });
              }}
              disabled={values.scanMode === "count"}
              className="tg-input w-20 shrink-0 py-1.5 disabled:opacity-50"
            />
            <select
              value={values.maxAgeUnit}
              onChange={(e) => onChange({ maxAgeUnit: e.target.value as TodoAnalyzeMaxAgeUnit })}
              disabled={values.scanMode === "count"}
              aria-label="Einheit für maximales Nachrichtsalter"
              className="tg-input min-w-0 flex-1 py-1.5 disabled:opacity-50"
            >
              <option value="days">Tage</option>
              <option value="weeks">Wochen</option>
              <option value="months">Monate</option>
            </select>
          </div>
        </div>

        <div>
          <FieldLabel htmlFor={`${idPrefix}-max-messages`}>Letzte Nachrichten (max. 50)</FieldLabel>
          <input
            id={`${idPrefix}-max-messages`}
            type="number"
            min={0}
            max={50}
            value={values.maxMessages}
            onChange={(e) => {
              const n = clampChatMessageCount(parseInt(e.target.value || "0", 10) || 0);
              onChange({ maxMessages: n });
            }}
            disabled={values.scanMode === "age"}
            className="tg-input py-1.5 disabled:opacity-50"
          />
        </div>
      </div>

      <div className={compactLayout ? "space-y-3" : "flex flex-wrap items-center gap-3"}>
        <div className={compactLayout ? "w-full" : undefined}>
          <FieldLabel htmlFor={`${idPrefix}-attachment-mode`}>Analyse-Tiefe</FieldLabel>
          <select
            id={`${idPrefix}-attachment-mode`}
            value={values.attachmentMode}
            onChange={(e) => onChange({ attachmentMode: e.target.value as TodoAnalyzeAttachmentMode })}
            className="tg-input w-full py-1.5"
          >
            <option value="fast">Schnell (ohne Bilder/Audio)</option>
            <option value="full">Vollständig (mit Bilder/Audio)</option>
          </select>
        </div>
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
          Auswahl: {preview.selectedChatCount} Chat(s), sichtbar: {preview.visibleChatCount} Chat(s), Force:{" "}
          {values.analyzeForce ? "ja" : "nein"}.
        </p>
      )}
    </div>
  );
}
