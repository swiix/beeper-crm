/**
 * API keys and secrets stored in data/api-keys-settings.json.
 * Values saved in the file override environment variables; env is used as fallback when a key is absent from the file.
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";

export type ApiKeysSettings = {
  openaiApiKey: string | null;
  beeperApiUrl: string | null;
  beeperMcpToken: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  googleTasksRedirectUri: string | null;
  reclaimApiToken: string | null;
};

export type ApiKeyField = keyof ApiKeysSettings;

const FILE_NAME = "api-keys-settings.json";
const LEGACY_RECLAIM_FILE = "reclaim-settings.json";

const ENV_BY_FIELD: Record<ApiKeyField, string | null> = {
  openaiApiKey: "OPENAI_API_KEY",
  beeperApiUrl: "BEEPER_API_URL",
  beeperMcpToken: "BEEPER_MCP_TOKEN",
  googleClientId: "GOOGLE_CLIENT_ID",
  googleClientSecret: "GOOGLE_CLIENT_SECRET",
  googleTasksRedirectUri: "GOOGLE_TASKS_REDIRECT_URI",
  reclaimApiToken: "RECLAIM_API_TOKEN",
};

const DEFAULTS: ApiKeysSettings = {
  openaiApiKey: null,
  beeperApiUrl: null,
  beeperMcpToken: null,
  googleClientId: null,
  googleClientSecret: null,
  googleTasksRedirectUri: null,
  reclaimApiToken: null,
};

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), FILE_NAME);
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseStored(raw: unknown): Partial<Record<ApiKeyField, string | null>> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const out: Partial<Record<ApiKeyField, string | null>> = {};
  for (const field of Object.keys(DEFAULTS) as ApiKeyField[]) {
    if (!(field in obj)) continue;
    out[field] = normalizeOptionalString(obj[field]);
  }
  return out;
}

function migrateLegacyReclaim(stored: Partial<Record<ApiKeyField, string | null>>): Partial<Record<ApiKeyField, string | null>> {
  if (stored.reclaimApiToken !== undefined) return stored;
  try {
    const legacyPath = path.join(ensureProjectDataDir(), LEGACY_RECLAIM_FILE);
    if (!fs.existsSync(legacyPath)) return stored;
    const legacyRaw = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as unknown;
    if (!legacyRaw || typeof legacyRaw !== "object") return stored;
    const token = normalizeOptionalString((legacyRaw as Record<string, unknown>).apiToken);
    if (!token) return stored;
    return { ...stored, reclaimApiToken: token };
  } catch {
    return stored;
  }
}

export function readApiKeysStored(): Partial<Record<ApiKeyField, string | null>> {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) {
      return migrateLegacyReclaim({});
    }
    const parsed = parseStored(JSON.parse(fs.readFileSync(filePath, "utf-8")));
    return migrateLegacyReclaim(parsed);
  } catch {
    return migrateLegacyReclaim({});
  }
}

export function writeApiKeysStored(patch: Partial<Record<ApiKeyField, string | null>>): void {
  const current = readApiKeysStored();
  const next: Partial<Record<ApiKeyField, string | null>> = { ...current };
  for (const [key, value] of Object.entries(patch) as [ApiKeyField, string | null | undefined][]) {
    if (value === undefined) continue;
    next[key] = normalizeOptionalString(value);
  }
  const filePath = getFilePath();
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
}

export type ApiKeySource = "settings" | "env" | "none";

export function getApiKeySource(field: ApiKeyField): ApiKeySource {
  const stored = readApiKeysStored();
  if (field in stored) {
    return stored[field] ? "settings" : "none";
  }
  const envName = ENV_BY_FIELD[field];
  if (envName && process.env[envName]?.trim()) return "env";
  return "none";
}

export function resolveApiKey(field: ApiKeyField): string | null {
  const stored = readApiKeysStored();
  if (field in stored) {
    return stored[field] ?? null;
  }
  const envName = ENV_BY_FIELD[field];
  if (!envName) return null;
  return normalizeOptionalString(process.env[envName]);
}

/** Last 4 chars for UI hint without exposing the full secret. */
export function getSecretHint(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

export function getOpenAiApiKey(): string | null {
  return resolveApiKey("openaiApiKey");
}

export function getBeeperApiUrl(): string {
  return resolveApiKey("beeperApiUrl") ?? "http://localhost:23373";
}

export function getBeeperMcpToken(): string {
  return resolveApiKey("beeperMcpToken") ?? "";
}

export function getGoogleClientId(): string | null {
  return resolveApiKey("googleClientId");
}

export function getGoogleClientSecret(): string | null {
  return resolveApiKey("googleClientSecret");
}

export function getGoogleTasksRedirectUriFromSettings(): string | null {
  return resolveApiKey("googleTasksRedirectUri");
}

export function getReclaimApiTokenFromSettings(): string | null {
  return resolveApiKey("reclaimApiToken");
}

export type ApiKeysStatus = {
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
  };
};

export function getApiKeysStatus(): ApiKeysStatus {
  const openaiKey = getOpenAiApiKey();
  const beeperUrl = getBeeperApiUrl();
  const beeperToken = getBeeperMcpToken();
  const googleClientId = getGoogleClientId();
  const googleClientSecret = getGoogleClientSecret();
  const redirectUri = getGoogleTasksRedirectUriFromSettings();
  const reclaimToken = getReclaimApiTokenFromSettings();

  return {
    openai: {
      configured: !!openaiKey,
      hint: getSecretHint(openaiKey),
      source: getApiKeySource("openaiApiKey"),
    },
    beeper: {
      url: beeperUrl,
      urlSource: getApiKeySource("beeperApiUrl"),
      tokenConfigured: !!beeperToken,
      tokenHint: getSecretHint(beeperToken || null),
      tokenSource: getApiKeySource("beeperMcpToken"),
    },
    google: {
      clientIdConfigured: !!googleClientId,
      clientIdHint: googleClientId ? getSecretHint(googleClientId) : null,
      clientIdSource: getApiKeySource("googleClientId"),
      clientSecretConfigured: !!googleClientSecret,
      clientSecretHint: getSecretHint(googleClientSecret),
      clientSecretSource: getApiKeySource("googleClientSecret"),
      redirectUri,
      redirectUriSource: getApiKeySource("googleTasksRedirectUri"),
    },
    reclaim: {
      tokenConfigured: !!reclaimToken,
      tokenHint: getSecretHint(reclaimToken),
      tokenSource: getApiKeySource("reclaimApiToken"),
    },
  };
}
