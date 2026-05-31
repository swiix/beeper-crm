/**
 * Beeper Desktop API client (proxy backend).
 * All requests go to localhost Beeper with Bearer token.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("beeper");

const BASE = process.env.BEEPER_API_URL || "http://localhost:23373";
const TOKEN = process.env.BEEPER_MCP_TOKEN || "";

function headers(): HeadersInit {
  const h: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (TOKEN) {
    (h as Record<string, string>)["Authorization"] = `Bearer ${TOKEN}`;
  }
  return h;
}

/** User-friendly message when Beeper Desktop is not reachable. */
export const BEEPER_UNREACHABLE_MESSAGE =
  "Beeper Desktop ist nicht erreichbar. Bitte die Beeper-App starten und prüfen, ob sie unter der konfigurierten Adresse läuft (z. B. localhost:23373).";

function isConnectionError(e: unknown): boolean {
  if (e instanceof TypeError && e.message?.includes("fetch")) return true;
  if (e instanceof Error) {
    const msg = e.message.toLowerCase();
    const code = (e as NodeJS.ErrnoException).code?.toLowerCase();
    return (
      msg.includes("econnrefused") ||
      msg.includes("enotfound") ||
      msg.includes("network") ||
      msg.includes("failed to fetch") ||
      code === "econnrefused" ||
      code === "enotfound"
    );
  }
  return false;
}

export async function beeperFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  log.debug({ path, method: (options.method ?? "GET").toUpperCase() }, "beeper request");
  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...headers(), ...(options.headers as Record<string, string>) },
    });
    log.debug({ path, status: res.status }, "beeper response");
    return res;
  } catch (e) {
    if (isConnectionError(e)) {
      log.warn({ path, err: e }, "Beeper connection failed");
      throw new Error(BEEPER_UNREACHABLE_MESSAGE);
    }
    throw e;
  }
}

/** Maps a non-OK Beeper HTTP response to the same user-facing message as `beeperJson`. */
export function beeperUserErrorMessage(path: string, status: number, bodyText: string): string {
  const text = bodyText ?? "";
  return status === 401
    ? TOKEN.trim()
      ? "Zugriff verweigert (401). BEEPER_MCP_TOKEN prüfen oder in Beeper neu erzeugen (Einstellungen → Entwickler)."
      : "Zugriff verweigert (401). In .env.local BEEPER_MCP_TOKEN setzen — Token aus Beeper Desktop → Einstellungen → Entwickler."
    : status === 404
      ? "Anfrage nicht gefunden (404). Beeper-API-Version prüfen."
      : status >= 500
        ? "Beeper-Server-Fehler. Bitte später erneut versuchen."
        : `Beeper API Fehler (${status}): ${text?.slice(0, 100) || "request failed"}`;
}

export async function beeperJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await beeperFetch(path, options);
  if (!res.ok) {
    const text = await res.text();
    log.warn({ path, status: res.status, body: text?.slice(0, 200) }, "beeper error");
    throw new Error(beeperUserErrorMessage(path, res.status, text));
  }
  return res.json() as Promise<T>;
}
