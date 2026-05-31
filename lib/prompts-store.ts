/**
 * Persisted analysis prompts (data/prompts.json). Used by analyze-chat and settings API.
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

export const DEFAULT_ANALYSIS_SYSTEM_PROMPT = `Du bist ein CRM-Assistent für Instagram-Akquise und Sales. Analysiere den Chat-Verlauf und antworte NUR mit einem einzelnen JSON-Objekt (kein anderer Text), mit exakt diesen Keys:
- summary: kurze Zusammenfassung des Chat-Verlaufs (2-4 Sätze): worum geht es, was wurde besprochen, aktueller Stand
- branche: kurze Beschreibung der vermuteten Branche/Beruf (1 Satz)
- kaufkraft: Zahl von 1 bis 10 (1 = nicht kaufbereit, 10 = kaufbereit). Nur die Zahl als Zahl oder String ausgeben, z.B. 7 oder "7".
- wunsch: was der Kontakt offenbar will (1-2 Sätze)
- pain: welches Problem/Bedürfnis erkennbar ist (1-2 Sätze)
- stage: eine CRM-Stage: "Lead", "Qualified", "Offer", "Won", "Lost" oder "Friends"
- nextMessageSuggestions: Array mit genau 5 kurzen Antwortvorschlägen (Harmonzi-Style: freundlich, wertschätzend, zielorientiert), die wir als nächste Nachricht senden könnten. Wichtig: Das Array muss immer genau 5 Einträge haben – niemals weniger. Bei Platzmangel ergänze weitere passende, kurze Vorschläge.

Pflicht: Das JSON muss immer alle Keys enthalten: summary, branche, wunsch, pain, kaufkraft, stage, nextMessageSuggestions. Keinen Key weglassen. Bei fehlender Information nutze z.B. "nicht erkennbar" oder bei nextMessageSuggestions ein Array mit Platzhalter-Texten. nextMessageSuggestions muss immer genau 5 Strings enthalten.

Antworte nur mit dem JSON, ohne Markdown oder Erklärungen.
Regel: Verwende in allen Textfeldern (summary, branche, wunsch, pain, nextMessageSuggestions) keine Bindestriche als Aufzählungszeichen oder am Zeilenanfang. Formuliere in Fließtext bzw. ganzen Sätzen, keine Stichpunkt-Listen mit "-".`;

export interface StoredPrompts {
  analysisSystemPrompt: string;
  /** Optional extra guidance appended only for nextMessageSuggestions (Quick Reply). */
  quickReplyPromptSuffix?: string;
  /** Number of answer suggestions in Tinder view (1–10). Default 5. */
  tinderSuggestionsCount?: number;
  /** Optional prompt suffix appended only for Tinder analysis (view=tinder). */
  tinderPromptSuffix?: string;
  /** Optional extra guidance only for the Tinder summary field ("summary"). */
  tinderSummaryPromptSuffix?: string;
}

export const DEFAULT_TINDER_SUGGESTIONS_COUNT = 5;
export const MIN_TINDER_SUGGESTIONS = 1;
export const MAX_TINDER_SUGGESTIONS = 10;

const FILE_NAME = "prompts.json";

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), FILE_NAME);
}

export function readPrompts(): StoredPrompts {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) {
      return { analysisSystemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT };
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "analysisSystemPrompt" in parsed) {
      const p = parsed as StoredPrompts;
      if (typeof p.analysisSystemPrompt === "string" && p.analysisSystemPrompt.trim()) {
        const count = p.tinderSuggestionsCount;
        const n =
          typeof count === "number" && !Number.isNaN(count)
            ? Math.min(MAX_TINDER_SUGGESTIONS, Math.max(MIN_TINDER_SUGGESTIONS, Math.round(count)))
            : DEFAULT_TINDER_SUGGESTIONS_COUNT;
        return {
          ...p,
          quickReplyPromptSuffix:
            typeof p.quickReplyPromptSuffix === "string" ? p.quickReplyPromptSuffix : undefined,
          tinderSuggestionsCount: n,
          tinderPromptSuffix: typeof p.tinderPromptSuffix === "string" ? p.tinderPromptSuffix : undefined,
          tinderSummaryPromptSuffix:
            typeof p.tinderSummaryPromptSuffix === "string" ? p.tinderSummaryPromptSuffix : undefined,
        };
      }
    }
  } catch {
    // use default on parse error or missing
  }
  return { analysisSystemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT };
}

export function writePrompts(prompts: StoredPrompts): void {
  const filePath = getFilePath();
  fs.writeFileSync(filePath, JSON.stringify(prompts, null, 2), "utf-8");
}
