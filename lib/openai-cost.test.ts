import { describe, expect, it } from "vitest";
import {
  buildAnalyzeUsageCostMeta,
  estimateOpenAiUsageUsd,
  formatAnalyzeCostUsd,
  zeroAnalyzeUsageCostMeta,
} from "./openai-cost";

describe("estimateOpenAiUsageUsd", () => {
  it("computes gpt-4o-mini cost from prompt and completion tokens", () => {
    const usd = estimateOpenAiUsageUsd({
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 10_000, completion_tokens: 2_000, total_tokens: 12_000 },
    });
    expect(usd).toBeCloseTo(0.0027, 6);
  });

  it("returns zero for empty usage", () => {
    expect(estimateOpenAiUsageUsd({ model: "gpt-4o-mini", usage: null })).toBe(0);
  });
});

describe("buildAnalyzeUsageCostMeta", () => {
  it("includes normalized usage and cost", () => {
    const meta = buildAnalyzeUsageCostMeta({ prompt_tokens: 1000, completion_tokens: 200 });
    expect(meta.usage.total_tokens).toBe(1200);
    expect(meta.estimated_cost_usd).toBeGreaterThan(0);
  });

  it("zero meta for cache hits", () => {
    expect(zeroAnalyzeUsageCostMeta().estimated_cost_usd).toBe(0);
  });
});

describe("formatAnalyzeCostUsd", () => {
  it("formats small amounts with extra precision", () => {
    expect(formatAnalyzeCostUsd(0.0027)).toBe("$0.0027");
    expect(formatAnalyzeCostUsd(0)).toBe("$0.00");
  });
});
