import { randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import {
  getGoogleClientId,
  getGoogleClientSecret,
  resolveApiKey,
} from "@/lib/api-keys-settings";

const GOOGLE_OAUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TASKS_API_BASE = "https://tasks.googleapis.com/tasks/v1";
const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const AUTH_RECORD_ID = "default";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type GoogleAuthRecord = {
  access_token: string | null;
  refresh_token: string | null;
  scope: string | null;
  token_type: string | null;
  expiry_date: number | null;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function requireGoogleClientId(): string {
  const value = getGoogleClientId();
  if (!value) {
    throw new Error("Google Client ID is missing. Configure it in Settings → API-Schlüssel or GOOGLE_CLIENT_ID.");
  }
  return value;
}

function requireGoogleClientSecret(): string {
  const value = getGoogleClientSecret();
  if (!value) {
    throw new Error(
      "Google Client Secret is missing. Configure it in Settings → API-Schlüssel or GOOGLE_CLIENT_SECRET."
    );
  }
  return value;
}

export function getGoogleTasksRedirectUri(origin: string): string {
  return resolveApiKey("googleTasksRedirectUri") ?? `${origin}/api/google-tasks/callback`;
}

export function createAndStoreOauthState(): string {
  const db = getDb();
  const state = randomBytes(24).toString("hex");
  db.prepare("INSERT INTO google_oauth_state (state, created_at) VALUES (?, ?)").run(state, Date.now());
  db.prepare("DELETE FROM google_oauth_state WHERE created_at < ?").run(Date.now() - OAUTH_STATE_TTL_MS);
  return state;
}

export function consumeOauthState(state: string): boolean {
  const db = getDb();
  const now = Date.now();
  const row = db
    .prepare("SELECT state, created_at FROM google_oauth_state WHERE state = ?")
    .get(state) as { state: string; created_at: number } | undefined;
  if (!row) return false;
  db.prepare("DELETE FROM google_oauth_state WHERE state = ?").run(state);
  return now - row.created_at <= OAUTH_STATE_TTL_MS;
}

export function buildGoogleOauthUrl(origin: string): string {
  const clientId = requireGoogleClientId();
  const redirectUri = getGoogleTasksRedirectUri(origin);
  const state = createAndStoreOauthState();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_TASKS_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_OAUTH_BASE}?${params.toString()}`;
}

async function requestToken(body: URLSearchParams): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Failed to request OAuth token.");
  }
  return json;
}

function upsertAuth(token: TokenResponse): void {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare("SELECT refresh_token FROM google_tasks_auth WHERE id = ?")
    .get(AUTH_RECORD_ID) as { refresh_token: string | null } | undefined;
  const refreshToken = token.refresh_token ?? existing?.refresh_token ?? null;
  const expiresInSec = typeof token.expires_in === "number" ? token.expires_in : 3600;
  const expiryDate = now + Math.max(60, expiresInSec - 30) * 1000;
  db.prepare(
    `INSERT INTO google_tasks_auth (id, access_token, refresh_token, scope, token_type, expiry_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token, scope = excluded.scope, token_type = excluded.token_type, expiry_date = excluded.expiry_date, updated_at = excluded.updated_at`
  ).run(AUTH_RECORD_ID, token.access_token ?? null, refreshToken, token.scope ?? null, token.token_type ?? "Bearer", expiryDate, now, now);
}

export async function exchangeCodeForTokens(code: string, origin: string): Promise<void> {
  const clientId = requireGoogleClientId();
  const clientSecret = requireGoogleClientSecret();
  const redirectUri = getGoogleTasksRedirectUri(origin);
  const token = await requestToken(
    new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    })
  );
  upsertAuth(token);
}

function getAuthRecord(): GoogleAuthRecord | null {
  const db = getDb();
  const row = db
    .prepare("SELECT access_token, refresh_token, scope, token_type, expiry_date FROM google_tasks_auth WHERE id = ?")
    .get(AUTH_RECORD_ID) as GoogleAuthRecord | undefined;
  return row ?? null;
}

export function getGoogleTasksConnectionStatus(): { connected: boolean; needsReconnect: boolean; expiry_date: number | null } {
  const auth = getAuthRecord();
  if (!auth?.refresh_token) return { connected: false, needsReconnect: false, expiry_date: null };
  const now = Date.now();
  const expiry = auth.expiry_date ?? null;
  const needsReconnect = !!expiry && expiry < now && !auth.refresh_token;
  return { connected: true, needsReconnect, expiry_date: expiry };
}

async function refreshAccessToken(refreshToken: string): Promise<void> {
  const clientId = requireGoogleClientId();
  const clientSecret = requireGoogleClientSecret();
  const token = await requestToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    })
  );
  upsertAuth(token);
}

export async function getValidAccessToken(): Promise<string> {
  const auth = getAuthRecord();
  if (!auth?.refresh_token) {
    throw new Error("Google Tasks is not connected. Please connect first.");
  }
  const now = Date.now();
  const expiry = auth.expiry_date ?? 0;
  if (!auth.access_token || now >= expiry) {
    await refreshAccessToken(auth.refresh_token);
    const refreshed = getAuthRecord();
    if (!refreshed?.access_token) throw new Error("Failed to refresh Google access token.");
    return refreshed.access_token;
  }
  return auth.access_token;
}

async function ensureDefaultTaskList(accessToken: string): Promise<string> {
  const response = await fetch(`${GOOGLE_TASKS_API_BASE}/users/@me/lists`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as { items?: Array<{ id?: string }>; error?: { message?: string } };
  if (!response.ok) throw new Error(json.error?.message ?? "Failed to load Google Task lists.");
  const first = json.items?.find((x) => typeof x.id === "string" && x.id.trim());
  if (!first?.id) throw new Error("No Google Task list found for account.");
  return first.id;
}

export async function insertGoogleTask(task: {
  title: string;
  notes?: string | null;
  due_date?: string | null;
  due_at?: number | null;
}): Promise<{ id: string; webViewLink: string | null }> {
  const accessToken = await getValidAccessToken();
  const taskListId = await ensureDefaultTaskList(accessToken);
  let dueIso: string | undefined;
  if (typeof task.due_at === "number" && Number.isFinite(task.due_at)) {
    dueIso = new Date(task.due_at).toISOString();
  } else if (task.due_date) {
    dueIso = `${task.due_date}T20:00:00.000Z`;
  }
  const response = await fetch(`${GOOGLE_TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: task.title,
      notes: task.notes ?? undefined,
      due: dueIso,
    }),
    cache: "no-store",
  });
  const json = (await response.json().catch(() => ({}))) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!response.ok || !json.id) throw new Error(json.error?.message ?? "Failed to create Google Task.");
  return { id: json.id, webViewLink: json.webViewLink ?? null };
}

export async function patchGoogleTask(
  googleTaskId: string,
  task: {
    title: string;
    notes?: string | null;
    due_date?: string | null;
    due_at?: number | null;
  }
): Promise<void> {
  const accessToken = await getValidAccessToken();
  const taskListId = await ensureDefaultTaskList(accessToken);
  let dueIso: string | undefined;
  if (typeof task.due_at === "number" && Number.isFinite(task.due_at)) {
    dueIso = new Date(task.due_at).toISOString();
  } else if (task.due_date) {
    dueIso = `${task.due_date}T20:00:00.000Z`;
  }
  const response = await fetch(
    `${GOOGLE_TASKS_API_BASE}/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(googleTaskId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: task.title,
        notes: task.notes ?? undefined,
        due: dueIso,
      }),
      cache: "no-store",
    }
  );
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) throw new Error(json.error?.message ?? "Failed to update Google Task.");
}
