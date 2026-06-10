"use client";

import { formatAnalyzeCostUsd } from "@/lib/openai-cost";

export type AnalyzeCostSummary = {
  label: string;
  costUsd: number;
  totalTokens?: number | null;
};

type AnalyzeCostBannerProps = {
  summary: AnalyzeCostSummary;
  onDismiss?: () => void;
};

/** Visible in-app cost summary after a chat scan (OpenAI estimate). */
export function AnalyzeCostBanner({ summary, onDismiss }: AnalyzeCostBannerProps) {
  const tokenHint =
    typeof summary.totalTokens === "number" && summary.totalTokens > 0
      ? ` · ${summary.totalTokens.toLocaleString("de-DE")} Tokens`
      : summary.costUsd <= 0
        ? " · Cache/Delta (kein API-Call)"
        : "";

  return (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-wa-green/35 bg-wa-green/10 px-3 py-2 text-xs">
      <p className="text-wa-text-primary">
        <span className="font-medium">Scan-Kosten ({summary.label}):</span>{" "}
        <span className="font-semibold text-wa-green">{formatAnalyzeCostUsd(summary.costUsd)} USD</span>
        <span className="text-wa-text-secondary">{tokenHint}</span>
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded px-1.5 py-0.5 text-wa-text-secondary hover:bg-wa-panel-secondary hover:text-wa-text-primary"
          title="Hinweis schließen"
          aria-label="Scan-Kosten schließen"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function analyzeCostFromPayload(
  label: string,
  payload: { estimated_cost_usd?: unknown; usage?: { total_tokens?: number } } | null | undefined
): AnalyzeCostSummary {
  const costUsd =
    typeof payload?.estimated_cost_usd === "number" && Number.isFinite(payload.estimated_cost_usd)
      ? payload.estimated_cost_usd
      : 0;
  const totalTokens =
    typeof payload?.usage?.total_tokens === "number" && payload.usage.total_tokens > 0
      ? payload.usage.total_tokens
      : null;
  return { label, costUsd, totalTokens };
}
