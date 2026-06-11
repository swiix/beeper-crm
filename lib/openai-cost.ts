import type { OpenAiUsage } from "@/lib/openai-usage";

export const TODO_ANALYZE_MODEL = "gpt-4o-mini";

type ModelPricing = {
  inputPer1M: number;
  outputPer1M: number;
};

/** USD per 1M tokens (OpenAI list pricing, update when models change). */
const MODEL_PRICING_USD: Record<string, ModelPricing> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-2024-08-06": { inputPer1M: 2.5, outputPer1M: 10 },
};

export type AnalyzeUsageCostMeta = {
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  estimated_cost_usd: number;
};

function normalizeUsage(usage?: OpenAiUsage | null): AnalyzeUsageCostMeta["usage"] {
  const prompt = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completion = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0;
  const total =
    typeof usage?.total_tokens === "number" && usage.total_tokens > 0
      ? usage.total_tokens
      : prompt + completion;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
  };
}

/** Estimate OpenAI request cost in USD from token usage. */
export function estimateOpenAiUsageUsd(params: {
  model: string;
  usage?: OpenAiUsage | null;
}): number {
  const pricing = MODEL_PRICING_USD[params.model];
  if (!pricing) return 0;
  const usage = normalizeUsage(params.usage);
  const inputCost = (usage.prompt_tokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.completion_tokens / 1_000_000) * pricing.outputPer1M;
  return Number((inputCost + outputCost).toFixed(6));
}

export function zeroAnalyzeUsageCostMeta(model = TODO_ANALYZE_MODEL): AnalyzeUsageCostMeta {
  return {
    model,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    estimated_cost_usd: 0,
  };
}

export function buildAnalyzeUsageCostMeta(
  usage?: OpenAiUsage | null,
  model = TODO_ANALYZE_MODEL
): AnalyzeUsageCostMeta {
  const normalized = normalizeUsage(usage);
  return {
    model,
    usage: normalized,
    estimated_cost_usd: estimateOpenAiUsageUsd({ model, usage: normalized }),
  };
}

/** Rough USD estimate for batch todo analyze (gpt-4o-mini). */
export function estimateAnalyzeBatchCostUsd(params: {
  chatsToAnalyze: number;
  maxMessages: number;
  attachmentMode: "fast" | "full";
}): number {
  const chats = Math.max(0, Math.round(params.chatsToAnalyze));
  if (chats === 0) return 0;
  const msgs = Math.max(1, Math.min(50, Math.round(params.maxMessages || 30)));
  const attachmentFactor = params.attachmentMode === "full" ? 2.2 : 1;
  const promptTokensPerChat = Math.round((1200 + msgs * 100) * attachmentFactor);
  const completionTokensPerChat = 350;
  return estimateOpenAiUsageUsd({
    model: TODO_ANALYZE_MODEL,
    usage: {
      prompt_tokens: promptTokensPerChat * chats,
      completion_tokens: completionTokensPerChat * chats,
      total_tokens: (promptTokensPerChat + completionTokensPerChat) * chats,
    },
  });
}

/** Human-readable USD for scan notifications. */
export function formatAnalyzeCostUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Read estimated_cost_usd from analyze API payloads. */
export function readAnalyzeCostUsd(payload: { estimated_cost_usd?: unknown } | null | undefined): number {
  if (typeof payload?.estimated_cost_usd !== "number" || !Number.isFinite(payload.estimated_cost_usd)) {
    return 0;
  }
  return payload.estimated_cost_usd;
}
