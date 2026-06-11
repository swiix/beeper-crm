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
import {
  TodoAnalyzeSettingsForm,
  computeAnalyzeMaxAgeDays,
  type TodoAnalyzeSettingsValues,
} from "@/components/todo/TodoAnalyzeSettingsForm";
import { buildAnalyzeRequestFields } from "@/components/todo/TodoAnalyzeSettingsForm";
import { formatAnalyzeCostUsd } from "@/lib/openai-cost";

export type AnalyzeSettingsModalMode = "all" | "selection" | "single" | "one-prompt";

export type AnalyzePreviewStats = {
  total: number;
  previewed: number;
  truncated: boolean;
  withSuggestions: number;
  cacheFresh: number;
  needsAnalyze: number;
  estimatedMinutes: number;
  estimated_cost_usd?: number;
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`h-4 w-4 shrink-0 text-wa-text-secondary transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
        clipRule="evenodd"
      />
    </svg>
  );
}

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
  const [previewError, setPreviewError] = useState(false);

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
      setPreviewError(false);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      setPreviewLoading(true);
      setPreviewError(false);
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
          if (data && typeof data.total === "number") {
            setPreview(data as AnalyzePreviewStats);
          } else {
            setPreview(null);
            setPreviewError(true);
          }
        })
        .catch(() => {
          setPreview(null);
          setPreviewError(true);
        })
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

  const activePreset = useMemo(
    () => TODO_ANALYZE_PRESETS.find((p) => p.id === presetId) ?? null,
    [presetId]
  );

  const settingsSummary = useMemo(() => {
    const days = computeAnalyzeMaxAgeDays(draft.maxAgeValue, draft.maxAgeUnit);
    const depth = draft.attachmentMode === "fast" ? "ohne Bilder/Audio" : "mit Bildern/Audio";
    const scan =
      draft.scanMode === "both"
        ? `${days} Tage · max. ${draft.maxMessages} Nachrichten`
        : draft.scanMode === "age"
          ? `${days} Tage`
          : `${draft.maxMessages} Nachrichten`;
    return `${scan} · ${depth}${draft.analyzeForce ? " · Cache ignorieren" : ""}`;
  }, [draft]);

  const estimatedCostUsd =
    typeof preview?.estimated_cost_usd === "number" ? preview.estimated_cost_usd : null;

  if (!open) return null;

  const showOnePrompt = mode === "one-prompt" || emphasizeOnePrompt;
  const confirmDisabled = mode === "one-prompt" && !draft.onePromptAllChats.trim();
  const showPreviewPanel =
    chatIdsForPreview.length > 0 && (previewLoading || preview != null || previewError);

  return (
    <div
      className="tg-overlay fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analyze-settings-modal-title"
      onClick={onClose}
    >
      <div
        className="tg-modal flex max-h-[min(90vh,720px)] w-full max-w-xl flex-col font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-[rgb(var(--tg-border))] px-5 py-4">
          <h2 id="analyze-settings-modal-title" className="text-base font-semibold leading-snug text-wa-text-primary">
            {MODE_TITLES[mode]}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-wa-text-secondary">
            {mode === "single"
              ? `Einstellungen für ${selectedChatName ?? "diesen Chat"}. Esc schließt ohne Analyse.`
              : `Gilt für ${previewScope.selectedChatCount.toLocaleString("de-DE")} Chat(s). Esc schließt ohne Analyse.`}
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section>
            <p className="tg-section-label">Preset</p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {TODO_ANALYZE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPreset(p.id)}
                  className={`tg-chip text-left ${presetId === p.id ? "tg-chip-active" : ""}`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => selectPreset("custom")}
                className={`tg-chip text-left ${presetId === "custom" ? "tg-chip-active" : ""}`}
              >
                Eigene
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-wa-text-secondary">
              {presetId === "custom"
                ? "Manuelle Einstellungen unter „Erweitert“."
                : (activePreset?.description ?? settingsSummary)}
            </p>
            {presetId !== "custom" && (
              <p className="mt-1 text-[10px] text-wa-text-secondary/80">{settingsSummary}</p>
            )}
          </section>

          {showPreviewPanel && (
            <section className="rounded-glass-control border border-wa-green/25 bg-wa-green/5 px-3 py-3">
              {previewLoading && (
                <p className="text-xs text-wa-text-secondary">Vorschau wird berechnet…</p>
              )}
              {!previewLoading && previewError && (
                <p className="text-xs text-wa-text-secondary">
                  Vorschau nicht verfügbar. Analyse startet trotzdem mit den gewählten Einstellungen.
                </p>
              )}
              {!previewLoading && preview && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-wa-text-secondary">Chats</p>
                    <p className="mt-0.5 font-semibold text-wa-text-primary">
                      {preview.total.toLocaleString("de-DE")}
                      {preview.truncated ? "*" : ""}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-wa-text-secondary">Neu analysieren</p>
                    <p className="mt-0.5 font-semibold text-amber-700 dark:text-amber-300">
                      ~{preview.needsAnalyze.toLocaleString("de-DE")}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-wa-text-secondary">Aus Cache</p>
                    <p className="mt-0.5 font-semibold text-wa-green">
                      ~{preview.cacheFresh.toLocaleString("de-DE")}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-wa-text-secondary">Geschätzte Kosten</p>
                    <p className="mt-0.5 font-semibold text-wa-green">
                      {formatAnalyzeCostUsd(estimatedCostUsd ?? 0)} USD
                    </p>
                  </div>
                  {(preview.estimatedMinutes > 0 || preview.withSuggestions > 0) && (
                    <p className="col-span-2 text-[11px] text-wa-text-secondary sm:col-span-4">
                      {preview.estimatedMinutes > 0 && <>ca. {preview.estimatedMinutes} Min · </>}
                      {preview.withSuggestions > 0 && (
                        <>{preview.withSuggestions.toLocaleString("de-DE")} mit gespeicherten Vorschlägen · </>
                      )}
                      {scanFields.attachmentMode === "fast" ? "Schnell-Modus" : "Vollständig (Bilder/Audio)"}
                      {preview.force ? " · Cache ignorieren" : ""}
                      {preview.truncated ? " · *Vorschau auf Teilmenge" : ""}
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {chatIdsForPreview.length === 0 && (
            <p className="rounded-glass-control border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-wa-text-secondary">
              Keine Chats im gewählten Scope.
            </p>
          )}

          {!showOnePrompt && (
            <section>
              <label
                htmlFor="analyze-settings-modal-prompt-suffix"
                className="block text-xs font-medium text-wa-text-secondary"
              >
                Zusatz zum Prompt
              </label>
              <textarea
                id="analyze-settings-modal-prompt-suffix"
                placeholder="Optional: z. B. nur geschäftliche Todos, keine Duplikate"
                value={draft.promptSuffix}
                onChange={(e) => {
                  onDraftChange({ promptSuffix: e.target.value });
                  setPresetId("custom");
                }}
                rows={3}
                className="tg-input mt-1.5 min-h-[4.5rem] resize-y"
              />
            </section>
          )}

          {showOnePrompt && (
            <section className="space-y-2">
              <p className="text-xs font-medium text-wa-text-secondary">One-Prompt Vorlagen</p>
              <div className="flex flex-wrap gap-1.5">
                {ONE_PROMPT_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => onDraftChange({ onePromptAllChats: tpl.prompt })}
                    className="rounded-full border border-blue-400/30 bg-blue-500/10 px-2.5 py-1 text-[11px] text-blue-800 transition-colors hover:bg-blue-500/20 dark:text-blue-200"
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
                className="tg-input mt-1.5 min-h-[5rem] resize-y border-blue-400/30 focus:border-blue-400 focus:ring-blue-400/20"
              />
            </section>
          )}

          <section>
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              className="flex w-full items-center justify-between rounded-glass-control border border-[rgb(var(--tg-border)/0.25)] px-3 py-2.5 text-left text-xs font-medium text-wa-text-secondary transition-colors hover:bg-white/5"
            >
              <span>Erweiterte Einstellungen</span>
              <ChevronIcon open={advancedOpen} />
            </button>
            {advancedOpen && (
              <div className="mt-2 rounded-glass-control border border-[rgb(var(--tg-border)/0.2)] p-3">
                <TodoAnalyzeSettingsForm
                  idPrefix="analyze-settings-modal-advanced"
                  values={draft}
                  onChange={(patch) => {
                    onDraftChange(patch);
                    setPresetId("custom");
                  }}
                  showOnePrompt={false}
                  showPromptSuffix={showOnePrompt}
                />
              </div>
            )}
          </section>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[rgb(var(--tg-border))] px-5 py-4">
          <div className="min-w-0 text-xs text-wa-text-secondary">
            {preview && !previewLoading && estimatedCostUsd != null && (
              <>
                Geschätzt{" "}
                <span className="font-semibold text-wa-green">{formatAnalyzeCostUsd(estimatedCostUsd)} USD</span>
                {preview.needsAnalyze > 0 && (
                  <span className="text-wa-text-secondary/80">
                    {" "}
                    · {preview.needsAnalyze.toLocaleString("de-DE")} API-Calls
                  </span>
                )}
              </>
            )}
            {previewLoading && <span className="text-wa-text-secondary/80">Kosten werden geschätzt…</span>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="tg-btn-secondary px-4 py-2 text-sm">
              Abbrechen
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirmDisabled}
              className={`px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 ${
                mode === "one-prompt" ? "tg-btn-primary bg-blue-600" : "tg-btn-primary"
              }`}
            >
              {CONFIRM_LABELS[mode]}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
