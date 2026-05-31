/**
 * Auto Lead / Auto Qualified: derive stage from analysis text and comma-separated keywords.
 * Only applied when contact is Unzugeordnet. Qualified keywords take precedence over Lead.
 * All keyword matching is case-insensitive (keywords and text are lowercased before comparison).
 */

import type { ContactAnalysis } from "@/lib/types";

export type KeywordStage = "Qualified" | "Lead";

function analysisToSearchText(analysis: ContactAnalysis): string {
  const parts = [
    analysis.summary,
    analysis.branche,
    analysis.wunsch,
    analysis.pain,
    analysis.stage,
    analysis.kaufkraft,
  ].filter(Boolean);
  return parts.map(String).join(" ").toLowerCase();
}

/**
 * Build keyword search corpus:
 * - normalized analysis text fields,
 * - raw JSON analysis text,
 * - optional plain chat text context.
 */
function buildKeywordSearchText(analysis: ContactAnalysis, chatText?: string): string {
  const analysisText = analysisToSearchText(analysis);
  let rawJsonText = "";
  try {
    rawJsonText = JSON.stringify(analysis);
  } catch {
    rawJsonText = "";
  }
  const combined = [analysisText, rawJsonText, chatText ?? ""]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return combined;
}

/**
 * Parse comma-separated keywords into trimmed, non-empty strings (lowercase for matching).
 */
export function parseKeywords(raw: string): string[] {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Always use plain "includes" matching (case-insensitive by prior lowercasing).
 */
function includesKeyword(textLower: string, keywordLower: string): boolean {
  return textLower.includes(keywordLower);
}

/**
 * Returns true if the given message text contains any of the comma-separated keywords (case-insensitive).
 * Used for "Auto Lead by message": when your sent message contains a keyword, contact becomes Lead.
 */
export function messageTextMatchesKeywords(text: string | undefined, keywordsRaw: string): boolean {
  if (!text || typeof text !== "string") return false;
  const keywords = parseKeywords(keywordsRaw);
  if (keywords.length === 0) return false;
  const lower = text.toLowerCase();
  return keywords.some((k) => includesKeyword(lower, k));
}

/**
 * If analysis text contains any of the given keywords, return the stage; otherwise null.
 * Qualified is checked first, then Lead.
 */
export function getStageFromKeywordRules(
  analysis: ContactAnalysis | null | undefined,
  rules: { autoLeadKeywords?: string; autoQualifiedKeywords?: string },
  chatText?: string
): KeywordStage | null {
  if (!analysis) return null;
  const text = buildKeywordSearchText(analysis, chatText);
  const qualified = parseKeywords(rules.autoQualifiedKeywords ?? "");
  const lead = parseKeywords(rules.autoLeadKeywords ?? "");
  for (const k of qualified) {
    if (k && includesKeyword(text, k)) return "Qualified";
  }
  for (const k of lead) {
    if (k && includesKeyword(text, k)) return "Lead";
  }
  return null;
}

/**
 * Auto stage for analysis:
 * 1) keyword rules (Qualified has priority),
 * 2) fallback to normalized analysis.stage (Qualified/Lead).
 */
export function getAutoStageFromAnalysis(
  analysis: ContactAnalysis | null | undefined,
  rules: { autoLeadKeywords?: string; autoQualifiedKeywords?: string },
  chatText?: string
): KeywordStage | null {
  if (!analysis) return null;
  const keywordStage = getStageFromKeywordRules(analysis, rules, chatText);
  if (keywordStage) return keywordStage;

  const rawStage = typeof analysis.stage === "string" ? analysis.stage.trim().toLowerCase() : "";
  if (rawStage === "qualified") return "Qualified";
  if (rawStage === "lead") return "Lead";
  return null;
}
