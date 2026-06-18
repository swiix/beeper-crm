import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import {
  type ApiKeyField,
  getApiKeysStatus,
  getReclaimApiTokenFromSettings,
  readApiKeysStored,
  resolveApiKey,
  writeApiKeysStored,
} from "@/lib/api-keys-settings";
import { verifyBeeperConnection, verifyOpenAiApiKey } from "@/lib/api-keys-verify";
import { verifyReclaimConnection } from "@/lib/reclaim";

const log = createLogger("api:settings:api-keys");

const CLEAR_FLAGS = {
  clearOpenaiApiKey: "openaiApiKey",
  clearBeeperApiUrl: "beeperApiUrl",
  clearBeeperMcpToken: "beeperMcpToken",
  clearGoogleClientId: "googleClientId",
  clearGoogleClientSecret: "googleClientSecret",
  clearGoogleTasksRedirectUri: "googleTasksRedirectUri",
  clearReclaimApiToken: "reclaimApiToken",
} as const satisfies Record<string, ApiKeyField>;

const VALUE_FIELDS = {
  openaiApiKey: "openaiApiKey",
  beeperApiUrl: "beeperApiUrl",
  beeperMcpToken: "beeperMcpToken",
  googleClientId: "googleClientId",
  googleClientSecret: "googleClientSecret",
  googleTasksRedirectUri: "googleTasksRedirectUri",
  reclaimApiToken: "reclaimApiToken",
} as const satisfies Record<string, ApiKeyField>;

function resolveAfterPatch(
  field: ApiKeyField,
  patch: Partial<Record<ApiKeyField, string | null>>
): string | null {
  if (field in patch) return patch[field] ?? null;
  return resolveApiKey(field);
}

export async function GET() {
  try {
    const status = getApiKeysStatus();
    let reclaimConnected = false;
    let reclaimEmail: string | null = null;
    if (status.reclaim.tokenConfigured) {
      const verified = await verifyReclaimConnection();
      reclaimConnected = verified.connected;
      reclaimEmail = verified.email ?? null;
    }
    return NextResponse.json({
      ...status,
      reclaim: { ...status.reclaim, connected: reclaimConnected, email: reclaimEmail },
    });
  } catch (e) {
    log.error({ err: e }, "GET api-keys failed");
    return NextResponse.json({ error: "Failed to read API key settings" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<Record<ApiKeyField, string | null>> = {};

    for (const [flag, field] of Object.entries(CLEAR_FLAGS)) {
      if (body[flag] === true) patch[field] = null;
    }

    for (const [inputKey, field] of Object.entries(VALUE_FIELDS)) {
      const raw = body[inputKey];
      if (typeof raw !== "string" || !raw.trim()) continue;
      patch[field] = raw.trim();
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No API key fields to update" }, { status: 400 });
    }

    const verifyOpenAi = body.verifyOpenai !== false;
    const verifyBeeper = body.verifyBeeper !== false;
    const verifyReclaim = body.verifyReclaim !== false;

    if (patch.openaiApiKey && verifyOpenAi) {
      const check = await verifyOpenAiApiKey(patch.openaiApiKey);
      if (!check.ok) {
        return NextResponse.json({ error: check.error ?? "OpenAI verification failed" }, { status: 400 });
      }
    }

    if ((patch.beeperApiUrl !== undefined || patch.beeperMcpToken !== undefined) && verifyBeeper) {
      const check = await verifyBeeperConnection(
        resolveAfterPatch("beeperApiUrl", patch),
        resolveAfterPatch("beeperMcpToken", patch)
      );
      if (!check.ok) {
        return NextResponse.json({ error: check.error ?? "Beeper verification failed" }, { status: 400 });
      }
    }

    if (patch.reclaimApiToken && verifyReclaim) {
      const check = await verifyReclaimConnection(patch.reclaimApiToken);
      if (!check.connected) {
        return NextResponse.json(
          { error: "Reclaim authentication failed. Check your API token." },
          { status: 400 }
        );
      }
    }

    writeApiKeysStored(patch);

    const status = getApiKeysStatus();
    let reclaimConnected = false;
    let reclaimEmail: string | null = null;
    if (getReclaimApiTokenFromSettings()) {
      const verified = await verifyReclaimConnection();
      reclaimConnected = verified.connected;
      reclaimEmail = verified.email ?? null;
    }

    log.info("API keys updated");
    return NextResponse.json({
      ...status,
      reclaim: { ...status.reclaim, connected: reclaimConnected, email: reclaimEmail },
    });
  } catch (e) {
    log.error({ err: e }, "PUT api-keys failed");
    return NextResponse.json({ error: "Failed to save API key settings" }, { status: 500 });
  }
}
