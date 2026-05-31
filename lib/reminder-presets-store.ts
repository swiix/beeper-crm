/**
 * Persisted reminder presets for TinderChat and CRM (data/reminder-presets.json).
 * Each preset: type "hours" (offset from now) or "days" (with optional fixed time HH:mm).
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

export interface ReminderPreset {
  id: string;
  /** Display label, e.g. "In 1 h", "Morgen 6:00" */
  label: string;
  type: "hours" | "days";
  /** Number of hours or days */
  value: number;
  /** For type "days": fixed time of day "HH:mm" (24h). Omit = use current time. */
  time?: string;
}

export interface StoredReminderPresets {
  presets: ReminderPreset[];
}

const DEFAULT_PRESETS: ReminderPreset[] = [
  { id: "1", label: "In 1 h", type: "hours", value: 1 },
  { id: "2", label: "Morgen 6:00", type: "days", value: 1, time: "06:00" },
  { id: "3", label: "In 7 Tagen 6:00", type: "days", value: 7, time: "06:00" },
];

const FILE_NAME = "reminder-presets.json";

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), FILE_NAME);
}

function parseTime(s: string): { h: number; m: number } | null {
  const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(s.trim());
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

function isValidPreset(p: unknown): p is ReminderPreset {
  if (!p || typeof p !== "object") return false;
  const x = p as Record<string, unknown>;
  if (typeof x.id !== "string" || !x.id.trim()) return false;
  if (typeof x.label !== "string") return false;
  if (x.type !== "hours" && x.type !== "days") return false;
  const v = Number(x.value);
  if (Number.isNaN(v) || v < 0) return false;
  if (x.type === "hours" && v > 720) return false;
  if (x.type === "days" && v > 365) return false;
  if (x.time !== undefined && x.time !== null) {
    if (typeof x.time !== "string" || !parseTime(x.time)) return false;
  }
  return true;
}

export function readReminderPresets(): StoredReminderPresets {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return { presets: DEFAULT_PRESETS };
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { presets: DEFAULT_PRESETS };
    const arr = (parsed as Record<string, unknown>).presets;
    if (!Array.isArray(arr)) return { presets: DEFAULT_PRESETS };
    const presets = arr.filter(isValidPreset).map((p) => ({
      id: String(p.id).trim(),
      label: String(p.label).trim() || p.id,
      type: p.type,
      value: Math.round(Number(p.value)),
      time: p.time != null ? String(p.time).trim() : undefined,
    }));
    if (presets.length === 0) return { presets: DEFAULT_PRESETS };
    return { presets };
  } catch {
    return { presets: DEFAULT_PRESETS };
  }
}

export function writeReminderPresets(stored: StoredReminderPresets): void {
  const filePath = getFilePath();
  const presets = (stored.presets ?? []).filter(isValidPreset).map((p) => ({
    id: String(p.id).trim(),
    label: String(p.label).trim() || p.id,
    type: p.type,
    value: Math.round(Number(p.value)),
    time: p.time != null ? String(p.time).trim() : undefined,
  }));
  fs.writeFileSync(
    filePath,
    JSON.stringify({ presets }, null, 2),
    "utf-8"
  );
}

export { parseTime };
