"use client";

import { useEffect, useMemo, useState } from "react";
import {
  applyTodoAnalyzePreset,
  detectPresetFromValues,
  getLastTodoAnalyzePreset,
  setLastTodoAnalyzePreset,
  TODO_ANALYZE_PRESETS,
  type TodoAnalyzePresetId,
} from "@/lib/todo-analyze-presets";
import { ONE_PROMPT_TEMPLATES } from "@/lib/todo-one-prompt-templates";
import { TodoAnalyzeSettingsForm, type TodoAnalyzeSettingsValues } from "@/components/todo/TodoAnalyzeSettingsForm";
import { buildAnalyzeRequestFields } from "@/components/todo/TodoAnalyzeSettingsForm";

export type AnalyzeSettingsModalMode = "all" | "selection" | "single" | "one-prompt";

export type AnalyzePreviewStats = {
  total: number;
  previewed: number;
  truncated: boolean;
  withSuggestions: number;
  cacheFresh: number;
  needsAnalyze: number;
  estimatedMinutes: number;
  attachmentMode: string;
  force: boolean;
  onePromptMode: boolean;
};

type TodoAnalyzeSettingsDialogProps = {
  open: boolean;
  mode: AnalyzeSettingsModalMode;
  draft: TodoAnalyzeSettingsValues;
  onDraftChange: (patch: Partial<TodoAnalyzeSettingsValues>) => void;
  onClose: () => void;
  onConfirm: () => void;
  selectedChatName?: string | null;
  previewScope: { selectedChatCount: number; visibleChatCount: number };
  chatIdsForPreview: string[];
  initialPresetId?: TodoAnalyzePresetId | null;
  emphasizeOnePrompt?: boolean;
};

const MODE_TITLES: Record<AnalyzeSettingsModalMode, string> = {
  all: "Vorschläge für alle sichtbaren Chats",
  selection: "Auswahl analysieren",
  single: "Todo-Vorschläge laden",
  "one-prompt": "One-Prompt auf alle sichtbaren Chats",
};

const CONFIRM_LABELS: Record<AnalyzeSettingsModalMode, string> = {
  all: "Analysieren starten",
  selection: "Auswahl analysieren",
  single: "Analysieren",
  "one-prompt": "One-Prompt starten",
};

export function TodoAnalyzeSettingsDialog({
  open,
  mode,
  draft,
  onDraftChange,
  onClose,
  onConfirm,
  selectedChatName,
  previewScope,
  chatIdsForPreview,
  initialPresetId,
  emphasizeOnePrompt = false,
}: TodoAnalyzeSettingsDialogProps) {
  const [presetId, setPresetId] = useState<TodoAnalyzePresetId>("daily_fast");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState<AnalyzePreviewStats | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const last = getLastTodoAnalyzePreset();
    const detected = initialPresetId ?? last ?? detectPresetFromValues(draft);
    const id = detected === "custom" ? detectPresetFromValues(draft) : detected;
    setPresetId(id);
    if (id !== "custom" && id !== detectPresetFromValues(draft)) {
      onDraftChange(applyTodoAnalyzePreset(id, draft));
    }
    setAdvancedOpen(id === "custom");
  }, [open, initialPresetId]);

  useEffect(() => {
    if (!open || chatIdsForPreview.length === 0) {
      setPreview(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      setPreviewLoading(true);
      fetch("/api/todo-list/analyze/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatIds: chatIdsForPreview,
          settings: draft,
          forOnePrompt: mode === "one-prompt",
        }),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (data && typeof data.total === "number") setPreview(data as AnalyzePreviewStats);
        })
        .catch(() => {})
        .finally(() => setPreviewLoading(false));
    }, 400);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [open, draft, chatIdsForPreview, mode]);

  const selectPreset = (id: TodoAnalyzePresetId) => {
    setPresetId(id);
    if (id !== "custom") {
      onDraftChange(applyTodoAnalyzePreset(id, draft));
      setAdvancedOpen(false);
    } else {
      setAdvancedOpen(true);
    }
  };

  const handleConfirm = () => {
    setLastTodoAnalyzePreset(presetId);
    onConfirm();
  };

  const scanFields = useMemo(() => buildAnalyzeRequestFields(draft), [draft]);

  if (!open) return null;

  const showOnePrompt = mode === "one-prompt" || emphasizeOnePrompt;
  const confirmDisabled = mode === "one-prompt" && !draft.onePromptAllChats.trim();

  return (
    <div
      className="tg-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analyze-settings-modal-title"
      onClick={onClose}
    >
      <div
        className="tg-modal flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[rgb(var(--tg-border))] p-4">
          <h2 id="analyze-settings-modal-title" className="text-sm font-semibold text-wa-text-primary">
            {MODE_TITLES[mode]}
          </h2>
          <p className="mt-1 text-xs text-wa-text-secondary">
            {mode === "single"
              ? `Einstellungen für ${selectedChatName ?? "diesen Chat"}. Esc schließt ohne Analyse.`
              : `Gilt für ${previewScope.selectedChatCount} Chat(s). Esc schließt ohne Analyse.`}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-wa-text-secondary">Preset</p>
            <div className="flex flex-wrap gap-1.5">
              {TODO_ANALYZE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.description}
                  onClick={() => selectPreset(p.id)}
                  className={`tg-chip ${presetId === p.id ? "tg-chip-active" : ""}`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => selectPreset("custom")}
                title="Alle Felder manuell einstellen"
                className={`tg-chip ${presetId === "custom" ? "tg-chip-active" : ""}`}
              >
                Eigene
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="analyze-settings-modal-prompt-suffix" className="block text-xs font-medium text-wa-text-secondary">
              Zusatz zum Prompt
            </label>
            <textarea
              id="analyze-settings-modal-prompt-suffix"
              placeholder="Optional: z. B. nur geschäftliche Todos"
              value={draft.promptSuffix}
              onChange={(e) => {
                onDraftChange({ promptSuffix: e.target.value });
                setPresetId("custom");
              }}
              rows={2}
              className="tg-input mt-1 w-full resize-y"
            />
          </div>

          {showOnePrompt && (
            <div>
              <p className="mb-1 text-xs font-medium text-wa-text-secondary">One-Prompt Vorlagen</p>
              <div className="mb-2 flex flex-wrap gap-1">
                {ONE_PROMPT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => onDraftChange({ onePromptAllChats: tpl.prompt })}
                    className="rounded border border-blue-400/30 bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-800 dark:text-blue-200 hover:bg-blue-500/20"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
              <label htmlFor="analyze-settings-modal-one-prompt" className="block text-xs font-medium text-wa-text-secondary">
                One-Prompt
              </label>
              <textarea
                id="analyze-settings-modal-one-prompt"
                placeholder="Freier Prompt für alle Chats…"
                value={draft.onePromptAllChats}
                onChange={(e) => onDraftChange({ onePromptAllChats: e.target.value })}
                rows={4}
                className="mt-1 w-full rounded-lg border border-blue-400/30 bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-blue-400 focus:outline-none"
              />
            </div>
          )}

          <div className="tg-surface-muted p-2.5 text-[11px] text-wa-text-secondary">
            {previewLoading && <p>Vorschau wird berechnet…</p>}
            {!previewLoading && preview && (
              <p>
                <span className="font-medium text-wa-text-primary">{preview.total}</span> Chat(s)
                {preview.truncated ? " (Vorschau auf Teilmenge)" : ""}
                {" · "}
                <span className="text-wa-green">~{preview.cacheFresh} aus Cache</span>
                {" · "}
                <span className="text-amber-700 dark:text-amber-300">~{preview.needsAnalyze} neu</span>
                {preview.estimatedMinutes > 0 && (
                  <>
                    {" · "}
                    ca. {preview.estimatedMinutes} Min
                  </>
                )}
                {" · "}
                {scanFields.attachmentMode === "fast" ? "Schnell" : "Vollständig"}
                {preview.force ? " · Force" : ""}
              </p>
            )}
            {!previewLoading && !preview && chatIdsForPreview.length === 0 && (
              <p>Keine Chats im gewählten Scope.</p>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className="tg-surface flex w-full items-center justify-between px-2 py-1.5 text-left text-xs font-medium text-wa-text-secondary hover:bg-white/5"
            >
              <span>Erweitert</span>
              <span aria-hidden>{advancedOpen ? "▼" : "▶"}</span>
            </button>
            {advancedOpen && (
              <div className="tg-surface mt-2 p-2">
                <TodoAnalyzeSettingsForm
                  idPrefix="analyze-settings-modal-advanced"
                  values={draft}
                  onChange={(patch) => {
                    onDraftChange(patch);
                    setPresetId("custom");
                  }}
                  showOnePrompt={false}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[rgb(var(--tg-border))] p-4">
          <button type="button" onClick={onClose} className="tg-btn-secondary px-3 py-1.5 text-sm">
            Abbrechen
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className={`px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${
              mode === "one-prompt" ? "tg-btn-primary bg-blue-600" : "tg-btn-primary"
            }`}
          >
            {CONFIRM_LABELS[mode]}
          </button>
        </div>
      </div>
    </div>
  );
}
