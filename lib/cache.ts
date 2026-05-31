/**
 * In-memory TTL cache with prefix invalidation.
 * Used for Beeper API responses and AI analysis results.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();
const DEFAULT_TTL_MS = 60_000; // 1 minute
const MAX_ENTRIES = 500;

function now(): number {
  return Date.now();
}

function evictIfNeeded(): void {
  if (store.size < MAX_ENTRIES) return;
  const sorted = [...store.entries()].sort(
    (a, b) => (a[1] as Entry<unknown>).expiresAt - (b[1] as Entry<unknown>).expiresAt
  );
  const toDelete = Math.ceil(MAX_ENTRIES * 0.2);
  for (let i = 0; i < toDelete && i < sorted.length; i++) {
    store.delete(sorted[i][0]);
  }
}

/**
 * Get cached value. Returns undefined if missing or expired.
 */
export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  if (now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

/**
 * Set cached value with optional TTL in milliseconds.
 */
export function cacheSet<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  evictIfNeeded();
  store.set(key, {
    value,
    expiresAt: now() + ttlMs,
  });
}

/**
 * Remove a single key.
 */
export function cacheDelete(key: string): void {
  store.delete(key);
}

/**
 * Remove all keys that start with the given prefix.
 */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** TTL presets (ms) */
export const CACHE_TTL = {
  ACCOUNTS: 60_000,      // 1 min
  CHATS: 300_000,        // 5 min
  CHAT_DETAIL: 300_000,  // 5 min
  MESSAGES: 300_000,     // 5 min
  ANALYSIS: 604_800_000, // 7 days
  TRANSCRIPT: 86400_000, // 24 h – transcribed audio
} as const;
