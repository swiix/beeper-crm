/**
 * Reclaim API token storage (data/reclaim-settings.json).
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

export interface ReclaimSettings {
  apiToken: string | null;
}

const FILE_NAME = "reclaim-settings.json";

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), FILE_NAME);
}

function defaultReclaimSettings(): ReclaimSettings {
  return { apiToken: null };
}

export function readReclaimSettings(): ReclaimSettings {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return defaultReclaimSettings();
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return defaultReclaimSettings();
    const token = (parsed as Record<string, unknown>).apiToken;
    return {
      apiToken: typeof token === "string" && token.trim() ? token.trim() : null,
    };
  } catch {
    return defaultReclaimSettings();
  }
}

export function writeReclaimSettings(settings: ReclaimSettings): void {
  const filePath = getFilePath();
  const token = settings.apiToken?.trim() || null;
  fs.writeFileSync(filePath, JSON.stringify({ apiToken: token }, null, 2), "utf-8");
}

export function getReclaimApiToken(): string | null {
  return readReclaimSettings().apiToken;
}

/** Last 4 chars for UI hint without exposing the full token. */
export function getReclaimTokenHint(token: string | null): string | null {
  if (!token || token.length < 4) return token ? "••••" : null;
  return `••••${token.slice(-4)}`;
}
