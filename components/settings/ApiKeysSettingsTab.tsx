"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SettingsError,
  SettingsLoading,
  SettingsSection,
} from "./SettingsSection";

import type { ApiKeySource, ApiKeysStatusResponse } from "@/lib/api-keys-ui";

function SourceBadge({ source }: { source: ApiKeySource }) {
  if (source === "env") {
    return (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
        .env.local
      </span>
    );
  }
  if (source === "settings") {
    return (
      <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-300">
        gespeichert
      </span>
    );
  }
  return null;
}

function ConfiguredBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        configured
          ? "bg-green-500/15 text-green-600 dark:text-green-400"
          : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      }`}
    >
      {configured ? "Konfiguriert" : "Fehlt"}
    </span>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none";

const saveBtnClass =
  "rounded-lg bg-wa-green px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50";

const clearBtnClass =
  "rounded-lg border border-wa-border px-3 py-1.5 text-xs text-wa-text-secondary hover:bg-wa-panel-secondary disabled:opacity-50";

export function ApiKeysSettingsTab() {
  const [status, setStatus] = useState<ApiKeysStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingField, setSavingField] = useState<string | null>(null);

  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [beeperApiUrl, setBeeperApiUrl] = useState("");
  const [beeperMcpToken, setBeeperMcpToken] = useState("");
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");
  const [googleTasksRedirectUri, setGoogleTasksRedirectUri] = useState("");
  const [reclaimApiToken, setReclaimApiToken] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/api-keys");
      const data = (await res.json()) as ApiKeysStatusResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Laden fehlgeschlagen");
      setStatus(data);
      setBeeperApiUrl(data.beeper.url);
      setGoogleTasksRedirectUri(data.google.redirectUri ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "API-Schlüssel konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const saveKeys = async (body: Record<string, unknown>, field: string) => {
    setSavingField(field);
    setError(null);
    try {
      const res = await fetch("/api/settings/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as ApiKeysStatusResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Speichern fehlgeschlagen");
      setStatus(data);
      if ("openaiApiKey" in body) setOpenaiApiKey("");
      if ("beeperMcpToken" in body) setBeeperMcpToken("");
      if ("googleClientId" in body) setGoogleClientId("");
      if ("googleClientSecret" in body) setGoogleClientSecret("");
      if ("reclaimApiToken" in body) setReclaimApiToken("");
      if (data.beeper.url) setBeeperApiUrl(data.beeper.url);
      setGoogleTasksRedirectUri(data.google.redirectUri ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSavingField(null);
    }
  };

  if (loading) return <SettingsLoading label="Lade API-Schlüssel…" />;

  return (
    <>
      <p className="text-sm text-wa-text-secondary">
        Schlüssel werden lokal unter <code className="rounded bg-wa-input-bg px-1 text-xs">data/api-keys-settings.json</code>{" "}
        gespeichert und überschreiben Werte aus <code className="rounded bg-wa-input-bg px-1 text-xs">.env.local</code>.
        Bereits gesetzte .env-Werte bleiben aktiv, bis du hier einen neuen Wert speicherst.
      </p>
      {error && <SettingsError message={error} />}

      <SettingsSection
        title="Beeper Desktop"
        description="API-Zugang für Chats, Nachrichten und Focus. Token: Beeper → Einstellungen → Entwickler."
      >
        <div className="flex flex-wrap items-center gap-2">
          <ConfiguredBadge configured={status?.beeper.tokenConfigured ?? false} />
          {status?.beeper.urlSource && <SourceBadge source={status.beeper.urlSource} />}
          {status?.beeper.tokenSource && status.beeper.tokenSource !== status.beeper.urlSource && (
            <SourceBadge source={status.beeper.tokenSource} />
          )}
        </div>
        <label htmlFor="beeper-api-url" className="mt-3 block text-xs text-wa-text-secondary">
          API-URL
        </label>
        <input
          id="beeper-api-url"
          type="url"
          value={beeperApiUrl}
          onChange={(e) => setBeeperApiUrl(e.target.value)}
          placeholder="http://localhost:23373"
          className={inputClass}
        />
        <label htmlFor="beeper-mcp-token" className="mt-3 block text-xs text-wa-text-secondary">
          MCP-Token
        </label>
        <input
          id="beeper-mcp-token"
          type="password"
          value={beeperMcpToken}
          onChange={(e) => setBeeperMcpToken(e.target.value)}
          placeholder={
            status?.beeper.tokenHint
              ? `Neuer Token (aktuell ${status.beeper.tokenHint})`
              : "Bearer-Token aus Beeper Desktop"
          }
          autoComplete="off"
          className={inputClass}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={savingField === "beeper" || (!beeperApiUrl.trim() && !beeperMcpToken.trim())}
            onClick={() =>
              saveKeys(
                {
                  ...(beeperApiUrl.trim() ? { beeperApiUrl: beeperApiUrl.trim() } : {}),
                  ...(beeperMcpToken.trim() ? { beeperMcpToken: beeperMcpToken.trim() } : {}),
                },
                "beeper"
              )
            }
            className={saveBtnClass}
          >
            {savingField === "beeper" ? "Prüfe & speichere…" : "Beeper speichern"}
          </button>
          {(status?.beeper.urlSource === "settings" || status?.beeper.tokenSource === "settings") && (
            <button
              type="button"
              disabled={savingField === "beeper-clear"}
              onClick={() =>
                saveKeys(
                  {
                    clearBeeperApiUrl: status?.beeper.urlSource === "settings",
                    clearBeeperMcpToken: status?.beeper.tokenSource === "settings",
                  },
                  "beeper-clear"
                )
              }
              className={clearBtnClass}
            >
              Gespeicherte Werte entfernen
            </button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="OpenAI"
        description="Für Chat-Analyse, Todo-Extraktion, Transkription und Bilderkennung."
      >
        <div className="flex flex-wrap items-center gap-2">
          <ConfiguredBadge configured={status?.openai.configured ?? false} />
          {status?.openai.source && <SourceBadge source={status.openai.source} />}
        </div>
        <label htmlFor="openai-api-key" className="mt-3 block text-xs text-wa-text-secondary">
          API-Key
        </label>
        <input
          id="openai-api-key"
          type="password"
          value={openaiApiKey}
          onChange={(e) => setOpenaiApiKey(e.target.value)}
          placeholder={
            status?.openai.hint ? `Neuer Key (aktuell ${status.openai.hint})` : "sk-proj-…"
          }
          autoComplete="off"
          className={inputClass}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={savingField === "openai" || !openaiApiKey.trim()}
            onClick={() => saveKeys({ openaiApiKey: openaiApiKey.trim() }, "openai")}
            className={saveBtnClass}
          >
            {savingField === "openai" ? "Prüfe & speichere…" : "OpenAI speichern"}
          </button>
          {status?.openai.source === "settings" && (
            <button
              type="button"
              disabled={savingField === "openai-clear"}
              onClick={() => saveKeys({ clearOpenaiApiKey: true }, "openai-clear")}
              className={clearBtnClass}
            >
              Gespeicherten Key entfernen
            </button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Google Tasks (OAuth)"
        description="Client-ID und Secret aus der Google Cloud Console. OAuth-Verbindung erfolgt unter Todo → Sync."
      >
        <div className="flex flex-wrap items-center gap-2">
          <ConfiguredBadge
            configured={(status?.google.clientIdConfigured && status?.google.clientSecretConfigured) ?? false}
          />
          {status?.google.clientIdSource && <SourceBadge source={status.google.clientIdSource} />}
        </div>
        <label htmlFor="google-client-id" className="mt-3 block text-xs text-wa-text-secondary">
          Client ID
        </label>
        <input
          id="google-client-id"
          type="text"
          value={googleClientId}
          onChange={(e) => setGoogleClientId(e.target.value)}
          placeholder={
            status?.google.clientIdConfigured
              ? "Neue Client ID eingeben zum Ersetzen"
              : "Google OAuth Client ID"
          }
          autoComplete="off"
          className={inputClass}
        />
        <label htmlFor="google-client-secret" className="mt-3 block text-xs text-wa-text-secondary">
          Client Secret
        </label>
        <input
          id="google-client-secret"
          type="password"
          value={googleClientSecret}
          onChange={(e) => setGoogleClientSecret(e.target.value)}
          placeholder={
            status?.google.clientSecretHint
              ? `Neues Secret (aktuell ${status.google.clientSecretHint})`
              : "Google OAuth Client Secret"
          }
          autoComplete="off"
          className={inputClass}
        />
        <label htmlFor="google-redirect-uri" className="mt-3 block text-xs text-wa-text-secondary">
          Redirect URI (optional)
        </label>
        <input
          id="google-redirect-uri"
          type="url"
          value={googleTasksRedirectUri}
          onChange={(e) => setGoogleTasksRedirectUri(e.target.value)}
          placeholder="http://localhost:3002/api/google-tasks/callback"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-wa-text-secondary">
          Leer lassen für automatisch <code className="rounded bg-wa-input-bg px-1">/api/google-tasks/callback</code>{" "}
          auf dem aktuellen Host.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={
              savingField === "google" ||
              (!googleClientId.trim() && !googleClientSecret.trim() && !googleTasksRedirectUri.trim())
            }
            onClick={() =>
              saveKeys(
                {
                  ...(googleClientId.trim() ? { googleClientId: googleClientId.trim() } : {}),
                  ...(googleClientSecret.trim() ? { googleClientSecret: googleClientSecret.trim() } : {}),
                  ...(googleTasksRedirectUri.trim()
                    ? { googleTasksRedirectUri: googleTasksRedirectUri.trim() }
                    : {}),
                  verifyOpenai: false,
                  verifyBeeper: false,
                  verifyReclaim: false,
                },
                "google"
              )
            }
            className={saveBtnClass}
          >
            {savingField === "google" ? "Speichere…" : "Google speichern"}
          </button>
          {(status?.google.clientIdSource === "settings" ||
            status?.google.clientSecretSource === "settings" ||
            status?.google.redirectUriSource === "settings") && (
            <button
              type="button"
              disabled={savingField === "google-clear"}
              onClick={() =>
                saveKeys(
                  {
                    clearGoogleClientId: status?.google.clientIdSource === "settings",
                    clearGoogleClientSecret: status?.google.clientSecretSource === "settings",
                    clearGoogleTasksRedirectUri: status?.google.redirectUriSource === "settings",
                    verifyOpenai: false,
                    verifyBeeper: false,
                    verifyReclaim: false,
                  },
                  "google-clear"
                )
              }
              className={clearBtnClass}
            >
              Gespeicherte Werte entfernen
            </button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Reclaim"
        description="API-Token für Todo-Sync. Reclaim → Developer → API Token."
      >
        <div className="flex flex-wrap items-center gap-2">
          <ConfiguredBadge configured={status?.reclaim.tokenConfigured ?? false} />
          {status?.reclaim.connected && (
            <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400">
              Verbunden
            </span>
          )}
          {status?.reclaim.tokenSource && <SourceBadge source={status.reclaim.tokenSource} />}
        </div>
        {status?.reclaim.email && (
          <p className="mt-2 text-xs text-green-600 dark:text-green-400">
            Angemeldet als {status.reclaim.email}
            {status.reclaim.tokenHint ? ` · ${status.reclaim.tokenHint}` : ""}
          </p>
        )}
        <label htmlFor="reclaim-api-token" className="mt-3 block text-xs text-wa-text-secondary">
          API-Token
        </label>
        <input
          id="reclaim-api-token"
          type="password"
          value={reclaimApiToken}
          onChange={(e) => setReclaimApiToken(e.target.value)}
          placeholder={
            status?.reclaim.tokenHint
              ? `Neuer Token (aktuell ${status.reclaim.tokenHint})`
              : "Reclaim API Token einfügen"
          }
          autoComplete="off"
          className={inputClass}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={savingField === "reclaim" || !reclaimApiToken.trim()}
            onClick={() =>
              saveKeys(
                { reclaimApiToken: reclaimApiToken.trim(), verifyOpenai: false, verifyBeeper: false },
                "reclaim"
              )
            }
            className={saveBtnClass}
          >
            {savingField === "reclaim" ? "Prüfe & speichere…" : "Reclaim speichern"}
          </button>
          {status?.reclaim.tokenSource === "settings" && (
            <button
              type="button"
              disabled={savingField === "reclaim-clear"}
              onClick={() =>
                saveKeys(
                  { clearReclaimApiToken: true, verifyOpenai: false, verifyBeeper: false },
                  "reclaim-clear"
                )
              }
              className={clearBtnClass}
            >
              Token entfernen
            </button>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
