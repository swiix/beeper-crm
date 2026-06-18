/**
 * Client-side API key status shape (GET /api/settings/api-keys).
 */

import type { AppView } from "@/lib/app-routes";

export type ApiKeySource = "settings" | "env" | "none";

export type ApiKeysStatusResponse = {
  openai: { configured: boolean; hint: string | null; source: ApiKeySource };
  beeper: {
    url: string;
    urlSource: ApiKeySource;
    tokenConfigured: boolean;
    tokenHint: string | null;
    tokenSource: ApiKeySource;
  };
  google: {
    clientIdConfigured: boolean;
    clientIdHint: string | null;
    clientIdSource: ApiKeySource;
    clientSecretConfigured: boolean;
    clientSecretHint: string | null;
    clientSecretSource: ApiKeySource;
    redirectUri: string | null;
    redirectUriSource: ApiKeySource;
  };
  reclaim: {
    tokenConfigured: boolean;
    tokenHint: string | null;
    tokenSource: ApiKeySource;
    connected?: boolean;
    email?: string | null;
  };
};

export type ApiKeyRequirement = "beeper" | "openai" | "google" | "reclaim";

export const API_KEY_REQUIREMENT_LABELS: Record<ApiKeyRequirement, string> = {
  beeper: "Beeper MCP-Token",
  openai: "OpenAI API-Key",
  google: "Google OAuth (Client ID & Secret)",
  reclaim: "Reclaim API-Token",
};

export function isApiKeyRequirementMet(
  status: ApiKeysStatusResponse,
  requirement: ApiKeyRequirement
): boolean {
  switch (requirement) {
    case "beeper":
      return status.beeper.tokenConfigured;
    case "openai":
      return status.openai.configured;
    case "google":
      return status.google.clientIdConfigured && status.google.clientSecretConfigured;
    case "reclaim":
      return status.reclaim.tokenConfigured;
    default:
      return true;
  }
}

export function getMissingApiKeyRequirements(
  status: ApiKeysStatusResponse,
  requirements: ApiKeyRequirement[]
): ApiKeyRequirement[] {
  const unique = [...new Set(requirements)];
  return unique.filter((req) => !isApiKeyRequirementMet(status, req));
}

export function apiKeyRequirementsForView(
  view: AppView,
  options?: { todoSyncTarget?: "google" | "reclaim" }
): ApiKeyRequirement[] {
  switch (view) {
    case "chat":
    case "kpi":
      return ["beeper"];
    case "crm":
    case "tinder":
      return ["beeper", "openai"];
    case "todo": {
      const reqs: ApiKeyRequirement[] = ["beeper", "openai"];
      if (options?.todoSyncTarget === "google") reqs.push("google");
      if (options?.todoSyncTarget === "reclaim") reqs.push("reclaim");
      return reqs;
    }
    default:
      return [];
  }
}

export function formatMissingApiKeysMessage(missing: ApiKeyRequirement[]): string {
  if (missing.length === 0) return "";
  const labels = missing.map((key) => API_KEY_REQUIREMENT_LABELS[key]);
  if (labels.length === 1) {
    return `${labels[0]} ist nicht konfiguriert — einige Funktionen sind deaktiviert.`;
  }
  return `Folgende API-Schlüssel fehlen: ${labels.join(", ")}. Einige Funktionen sind deaktiviert.`;
}

export const API_KEYS_SETTINGS_HREF = "/settings?tab=api";
