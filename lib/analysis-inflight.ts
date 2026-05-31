/**
 * Coalesce concurrent OpenAI analysis requests for the same chat + view (one billable run).
 */

const inflight = new Map<string, Promise<unknown>>();

export function inflightAnalysisKey(chatId: string, isTinder: boolean): string {
  return `${chatId}:${isTinder ? "tinder" : "default"}`;
}

/**
 * If a request for the same key is already running, await that promise instead of starting another run.
 */
export async function getOrRunInflightAnalysis<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }
  const p = factory().finally(() => {
    inflight.delete(key);
  }) as Promise<T>;
  inflight.set(key, p);
  return p;
}
