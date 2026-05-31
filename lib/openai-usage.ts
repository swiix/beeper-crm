import { getDb } from "@/lib/db";

export type OpenAiUsageCategory =
  | "todo_analyze"
  | "vision"
  | "smart_sort"
  | "whisper_transcribe";

export type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export function trackOpenAiUsageEvent(params: {
  category: OpenAiUsageCategory;
  model: string;
  usage?: OpenAiUsage | null;
  chatId?: string | null;
  atMs?: number;
}): void {
  const db = getDb();
  const t = params.atMs ?? Date.now();
  const u = params.usage ?? null;
  const promptTokens = typeof u?.prompt_tokens === "number" ? u.prompt_tokens : null;
  const completionTokens = typeof u?.completion_tokens === "number" ? u.completion_tokens : null;
  const totalTokens =
    typeof u?.total_tokens === "number"
      ? u.total_tokens
      : promptTokens != null || completionTokens != null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : null;

  db.prepare(
    "INSERT INTO openai_usage_events (category, model, prompt_tokens, completion_tokens, total_tokens, chat_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(params.category, params.model, promptTokens, completionTokens, totalTokens, params.chatId ?? null, t);
}

type SummaryRow = {
  category: string;
  model: string;
  request_count: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export function getOpenAiUsageSummary(params: { sinceMs: number }): {
  sinceMs: number;
  totals: SummaryRow;
  byCategoryAndModel: SummaryRow[];
} {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT
        category,
        model,
        COUNT(*) as request_count,
        COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens
      FROM openai_usage_events
      WHERE created_at >= ?
      GROUP BY category, model
      ORDER BY total_tokens DESC, request_count DESC
    `
    )
    .all(params.sinceMs) as SummaryRow[];

  const totals = rows.reduce<SummaryRow>(
    (acc, r) => ({
      category: "all",
      model: "all",
      request_count: acc.request_count + (r.request_count ?? 0),
      prompt_tokens: acc.prompt_tokens + (r.prompt_tokens ?? 0),
      completion_tokens: acc.completion_tokens + (r.completion_tokens ?? 0),
      total_tokens: acc.total_tokens + (r.total_tokens ?? 0),
    }),
    { category: "all", model: "all", request_count: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  );

  return { sinceMs: params.sinceMs, totals, byCategoryAndModel: rows };
}

