/**
 * Persisted cache TTL settings (data/cache-settings.json).
 * Values are stored in minutes; convert to ms when used.
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

export type CacheTTLKey =
  | "accounts"
  | "chats"
  | "chatDetail"
  | "analysis"
  | "transcript";

export interface CacheTTLSettings {
  /** TTL in minutes */
  accounts: number;
  chats: number;
  chatDetail: number;
  analysis: number;
  transcript: number;
}

const DEFAULT_TTL_MINUTES: CacheTTLSettings = {
  accounts: 1,
  chats: 5,
  chatDetail: 5,
  analysis: 10080, // 7 days
  transcript: 1440, // 24 h
};

const FILE_NAME = "cache-settings.json";

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), FILE_NAME);
}

function clampMinutes(value: unknown, defaultVal: number, min = 0, max = 525600): number {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function readCacheSettings(): CacheTTLSettings {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return DEFAULT_TTL_MINUTES;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_TTL_MINUTES;
    const p = parsed as Record<string, unknown>;
    return {
      accounts: clampMinutes(p.accounts, DEFAULT_TTL_MINUTES.accounts),
      chats: clampMinutes(p.chats, DEFAULT_TTL_MINUTES.chats),
      chatDetail: clampMinutes(p.chatDetail, DEFAULT_TTL_MINUTES.chatDetail),
      analysis: clampMinutes(p.analysis, DEFAULT_TTL_MINUTES.analysis),
      transcript: clampMinutes(p.transcript, DEFAULT_TTL_MINUTES.transcript),
    };
  } catch {
    return DEFAULT_TTL_MINUTES;
  }
}

export function writeCacheSettings(settings: CacheTTLSettings): void {
  const filePath = getFilePath();
  const safe: CacheTTLSettings = {
    accounts: clampMinutes(settings.accounts, DEFAULT_TTL_MINUTES.accounts),
    chats: clampMinutes(settings.chats, DEFAULT_TTL_MINUTES.chats),
    chatDetail: clampMinutes(settings.chatDetail, DEFAULT_TTL_MINUTES.chatDetail),
    analysis: clampMinutes(settings.analysis, DEFAULT_TTL_MINUTES.analysis),
    transcript: clampMinutes(settings.transcript, DEFAULT_TTL_MINUTES.transcript),
  };
  fs.writeFileSync(filePath, JSON.stringify(safe, null, 2), "utf-8");
}

/** Get TTL in milliseconds for a given cache key. Uses persisted settings or default. */
export function getCacheTTLMs(key: CacheTTLKey): number {
  const settings = readCacheSettings();
  const minutes = settings[key];
  return minutes * 60 * 1000;
}
