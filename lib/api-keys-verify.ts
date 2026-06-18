/**
 * Lightweight verification for API keys saved in settings.
 */

import { getBeeperApiUrl, getBeeperMcpToken, getOpenAiApiKey } from "@/lib/api-keys-settings";

export async function verifyOpenAiApiKey(apiKey?: string | null): Promise<{ ok: boolean; error?: string }> {
  const key = apiKey?.trim() || getOpenAiApiKey();
  if (!key) return { ok: false, error: "OpenAI API key is missing." };
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (res.status === 401) return { ok: false, error: "OpenAI authentication failed (401)." };
    if (!res.ok) return { ok: false, error: `OpenAI API error (${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: "OpenAI API is unreachable." };
  }
}

export async function verifyBeeperConnection(
  apiUrl?: string | null,
  mcpToken?: string | null
): Promise<{ ok: boolean; error?: string }> {
  const base = (apiUrl?.trim() || getBeeperApiUrl()).replace(/\/$/, "");
  const token = mcpToken?.trim() ?? getBeeperMcpToken();
  try {
    const headers: HeadersInit = { "Content-Type": "application/json" };
    if (token) {
      (headers as Record<string, string>).Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${base}/v1/accounts`, { headers, cache: "no-store" });
    if (res.status === 401) {
      return { ok: false, error: "Beeper authentication failed (401). Check MCP token." };
    }
    if (!res.ok) {
      return { ok: false, error: `Beeper API error (${res.status}).` };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: "Beeper Desktop is not reachable. Start Beeper and check the API URL.",
    };
  }
}
