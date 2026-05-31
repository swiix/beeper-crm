/**
 * Browser event so CRM view refetches /api/crm/analysis (SQLite-backed) after chat analyses complete.
 * Fire once per logical batch to avoid redundant SWR work.
 */

export const CRM_ANALYSIS_UPDATED_EVENT = "beeper-crm-analysis-updated";

export function dispatchCrmAnalysisUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CRM_ANALYSIS_UPDATED_EVENT));
}
