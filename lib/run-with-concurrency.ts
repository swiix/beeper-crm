/**
 * Run async tasks with a concurrency limit. At most `limit` tasks run at once;
 * when one finishes, the next is started.
 */
export async function runWithConcurrency<T>(
  limit: number,
  items: T[],
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let index = 0;
  const next = async (): Promise<void> => {
    const i = index++;
    if (i >= items.length) return;
    await fn(items[i], i);
    await next();
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
}
