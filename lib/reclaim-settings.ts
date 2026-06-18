/**
 * Reclaim API token storage — delegates to api-keys-settings.json.
 */

import {
  getReclaimApiTokenFromSettings,
  getSecretHint,
  writeApiKeysStored,
} from "@/lib/api-keys-settings";

export interface ReclaimSettings {
  apiToken: string | null;
}

export function readReclaimSettings(): ReclaimSettings {
  return { apiToken: getReclaimApiTokenFromSettings() };
}

export function writeReclaimSettings(settings: ReclaimSettings): void {
  writeApiKeysStored({ reclaimApiToken: settings.apiToken });
}

export function getReclaimApiToken(): string | null {
  return getReclaimApiTokenFromSettings();
}

/** Last 4 chars for UI hint without exposing the full token. */
export function getReclaimTokenHint(token: string | null): string | null {
  return getSecretHint(token);
}
