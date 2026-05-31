/**
 * Shared SWR config and fetcher for client-side caching.
 * Deduplication, stale-while-revalidate, optional revalidation.
 */

export const SWR_CONFIG = {
  /** Don't refetch on window focus to avoid flashing when switching tabs */
  revalidateOnFocus: false,
  /** Dedupe requests within 5s */
  dedupingInterval: 5_000,
  /** Keep previous data while revalidating */
  keepPreviousData: true,
  /** Retry once on error */
  errorRetryCount: 1,
} as const;

export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? res.statusText);
  return data as T;
}
