/**
 * Server-side audio transcription via OpenAI Whisper.
 * Fetches audio from Beeper assets, sends to Whisper, caches result.
 */

import { beeperFetch } from "@/lib/beeper";
import { cacheGet, cacheSet } from "@/lib/cache";
import { getCacheTTLMs } from "@/lib/cache-settings";
import { createLogger } from "@/lib/logger";
import { getOpenAiApiKey } from "@/lib/api-keys-settings";
import { trackOpenAiUsageEvent } from "@/lib/openai-usage";

const log = createLogger("transcribe");
const WHISPER_API = "https://api.openai.com/v1/audio/transcriptions";

function transcriptCacheKey(audioUrl: string): string {
  return `transcript:${audioUrl}`;
}

/**
 * Fetch audio bytes from Beeper assets serve (mxc://, file://, etc.).
 */
async function fetchAudioBuffer(audioUrl: string): Promise<ArrayBuffer> {
  const path = `/v1/assets/serve?${new URLSearchParams({ url: audioUrl }).toString()}`;
  const res = await beeperFetch(path, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asset fetch failed: ${res.status} ${text?.slice(0, 100)}`);
  }
  return res.arrayBuffer();
}

/**
 * Transcribe audio via OpenAI Whisper. Uses cache (24h). Returns plain text or empty string on error.
 */
export async function getTranscript(audioUrl: string): Promise<string> {
  if (!audioUrl?.trim()) return "";
  const key = transcriptCacheKey(audioUrl);
  const cached = cacheGet<string>(key);
  if (cached !== undefined) return cached;

  const OPENAI_API_KEY = getOpenAiApiKey();
  if (!OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set, skipping transcription");
    return "";
  }

  try {
    const buffer = await fetchAudioBuffer(audioUrl);
    if (buffer.byteLength === 0) return "";

    const formData = new FormData();
    const blob = new Blob([buffer], { type: "audio/mpeg" });
    formData.append("file", blob, "audio.mp3");
    formData.append("model", "whisper-1");
    formData.append("language", "de");
    formData.append("response_format", "json");

    const res = await fetch(WHISPER_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      log.warn({ status: res.status, err: err?.slice(0, 200) }, "Whisper API error");
      return "";
    }

    trackOpenAiUsageEvent({
      category: "whisper_transcribe",
      model: "whisper-1",
      usage: null,
    });
    const data = (await res.json()) as { text?: string };
    const text = (data?.text ?? "").trim();
    if (text) cacheSet(key, text, getCacheTTLMs("transcript"));
    return text;
  } catch (e) {
    log.error({ err: e, audioUrl: audioUrl.slice(0, 80) }, "transcribe failed");
    return "";
  }
}
