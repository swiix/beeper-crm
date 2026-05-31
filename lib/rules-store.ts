/**
 * Persisted automation rules (data/rules.json).
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

export interface StoredRules {
  /** When a chat has more than this many follow-ups (no reply), set contact stage to Lost. Default 5. */
  maxFollowUpsBeforeLost: number;
  /** Comma-separated keywords: if analysis text contains any, set contact (when Unzugeordnet) to Lead. */
  autoLeadKeywords: string;
  /** Comma-separated keywords: if analysis text contains any, set contact (when Unzugeordnet) to Qualified. */
  autoQualifiedKeywords: string;
  /** Comma-separated keywords: if any of your messages in the chat contains one, set contact (when Unzugeordnet) to Lead. E.g. for cold DMs. */
  autoLeadMessageKeywords: string;
  /** Max number of chat analyses run in parallel (e.g. "Alle Chats analysieren", "Analyse für alle Kontakte"). Default 5. */
  analysisConcurrency: number;
}

const DEFAULT_RULES: StoredRules = {
  maxFollowUpsBeforeLost: 5,
  autoLeadKeywords: "",
  autoQualifiedKeywords: "",
  autoLeadMessageKeywords: "",
  analysisConcurrency: 5,
};

const FILE_NAME = "rules.json";

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), FILE_NAME);
}

export function readRules(): StoredRules {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return DEFAULT_RULES;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const r = parsed as Record<string, unknown>;
      const concurrency = typeof r.analysisConcurrency === "number" && r.analysisConcurrency >= 1
        ? Math.min(50, Math.round(r.analysisConcurrency))
        : DEFAULT_RULES.analysisConcurrency;
      return {
        ...DEFAULT_RULES,
        maxFollowUpsBeforeLost:
          typeof r.maxFollowUpsBeforeLost === "number" && !Number.isNaN(r.maxFollowUpsBeforeLost) && r.maxFollowUpsBeforeLost >= 0
            ? Math.round(r.maxFollowUpsBeforeLost)
            : DEFAULT_RULES.maxFollowUpsBeforeLost,
        autoLeadKeywords: typeof r.autoLeadKeywords === "string" ? r.autoLeadKeywords : "",
        autoQualifiedKeywords: typeof r.autoQualifiedKeywords === "string" ? r.autoQualifiedKeywords : "",
        autoLeadMessageKeywords: typeof r.autoLeadMessageKeywords === "string" ? r.autoLeadMessageKeywords : "",
        analysisConcurrency: concurrency,
      };
    }
  } catch {
    // use default on parse error
  }
  return DEFAULT_RULES;
}

export function writeRules(rules: StoredRules): void {
  const filePath = getFilePath();
  const concurrency = typeof rules.analysisConcurrency === "number" && rules.analysisConcurrency >= 1
    ? Math.min(50, Math.round(rules.analysisConcurrency))
    : DEFAULT_RULES.analysisConcurrency;
  const safe: StoredRules = {
    maxFollowUpsBeforeLost: Math.max(0, Math.round(rules.maxFollowUpsBeforeLost)),
    autoLeadKeywords: typeof rules.autoLeadKeywords === "string" ? rules.autoLeadKeywords : "",
    autoQualifiedKeywords: typeof rules.autoQualifiedKeywords === "string" ? rules.autoQualifiedKeywords : "",
    autoLeadMessageKeywords: typeof rules.autoLeadMessageKeywords === "string" ? rules.autoLeadMessageKeywords : "",
    analysisConcurrency: concurrency,
  };
  fs.writeFileSync(filePath, JSON.stringify(safe, null, 2), "utf-8");
}
