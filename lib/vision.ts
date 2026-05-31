/**
 * Server-side image analysis via OpenAI Vision API (GPT-4o / gpt-4o-mini).
 * Fetches images from Beeper assets, sends to Vision API, caches text description.
 */

import { beeperFetch } from "@/lib/beeper";
import { cacheGet, cacheSet, cacheDelete, CACHE_TTL } from "@/lib/cache";
import { createLogger } from "@/lib/logger";
import { trackOpenAiUsageEvent } from "@/lib/openai-usage";

const log = createLogger("vision");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
/** Vision model: gpt-4o is more reliable and refuses less often; set OPENAI_VISION_MODEL=gpt-4o-mini for lower cost. */
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4o";

const VISION_CACHE_TTL_MS = CACHE_TTL.TRANSCRIPT;

function visionCacheKey(imageUrl: string): string {
  return `vision:${imageUrl}`;
}

/** Supported image MIME types for Vision API (PNG, JPEG, WEBP, GIF non-animated). */
function getMimeType(contentType: string | null, url: string): string {
  if (contentType) {
    const lower = contentType.toLowerCase().split(";")[0].trim();
    if (lower === "image/png" || lower === "image/jpeg" || lower === "image/jpg" || lower === "image/webp" || lower === "image/gif")
      return lower;
  }
  const u = url.toLowerCase();
  if (u.includes(".png")) return "image/png";
  if (u.includes(".webp")) return "image/webp";
  if (u.includes(".gif")) return "image/gif";
  return "image/jpeg";
}

/** Check if buffer looks like image data (magic bytes). Rejects HTML/error pages. */
function isLikelyImageBuffer(buffer: ArrayBuffer, mimeType: string): boolean {
  if (buffer.byteLength < 12) return false;
  const arr = new Uint8Array(buffer);
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const jpeg = [0xff, 0xd8, 0xff];
  const gif = [0x47, 0x49, 0x46, 0x38]; // GIF8
  const webp = [0x52, 0x49, 0x46, 0x46]; // RIFF
  const webp2 = [0x57, 0x45, 0x42, 0x50]; // WEBP at offset 8
  if (mimeType === "image/png" && png.every((b, i) => arr[i] === b)) return true;
  if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && jpeg.every((b, i) => arr[i] === b)) return true;
  if (mimeType === "image/gif" && gif.every((b, i) => arr[i] === b)) return true;
  if (mimeType === "image/webp" && webp.every((b, i) => arr[i] === b) && arr.length >= 12 && webp2.every((b, i) => arr[8 + i] === b)) return true;
  if (png.every((b, i) => arr[i] === b)) return true;
  if (jpeg.every((b, i) => arr[i] === b)) return true;
  if (gif.every((b, i) => arr[i] === b)) return true;
  if (webp.every((b, i) => arr[i] === b) && arr.length >= 12 && webp2.every((b, i) => arr[8 + i] === b)) return true;
  return false;
}

/**
 * Fetch image bytes from Beeper assets serve (mxc://, file://, etc.).
 */
async function fetchImageBuffer(imageUrl: string): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const path = `/v1/assets/serve?${new URLSearchParams({ url: imageUrl }).toString()}`;
  const res = await beeperFetch(path, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asset fetch failed: ${res.status} ${text?.slice(0, 100)}`);
  }
  const contentType = res.headers.get("content-type");
  const mimeType = getMimeType(contentType, imageUrl);
  const buffer = await res.arrayBuffer();
  return { buffer, mimeType };
}

const VISION_SYSTEM_PROMPT = `You are an image description assistant. Your task is to describe the image content in detail. You MUST always describe exactly what you see in the image. Never refuse, never say you cannot analyze or see the image, never give only generic or hypothetical descriptions. Output only the concrete description of this image in German. No disclaimers, no "I can only say generally...". Refusing or saying you cannot help is not allowed.`;

/** Stronger prompt used on retry when the model refused on first attempt. */
const VISION_SYSTEM_PROMPT_STRICT = `You are an image description assistant. You MUST describe the image. Refusal is not allowed. If the image is blurry or unclear, describe what you can see. Output only the concrete description in German, no apologies or "I cannot".`;

/** Phrases that indicate the model refused or gave a generic non-description. Cached values matching these are treated as invalid. */
const REFUSAL_PHRASES: string[] = [
  "kann das Bild nicht analysieren",
  "kann dieses Bild nicht analysieren",
  "kann das Bild nicht direkt analysieren",
  "diese Bildanalyse nicht durchführen",
  "kann keine detaillierte Analyse",
  "keine detaillierte Analyse des Bildes durchführen",
  "keine visuellen Inhalte",
  "nicht analysieren oder beschreiben",
  "ich kann bei dieser Anfrage nicht helfen",
  "kann bei dieser Anfrage nicht helfen",
  "diese Anfrage nicht bearbeiten",
  "kann darauf nicht eingehen",
  "kann dir nicht bei der Analyse",
  "kann dir nicht bei der Analyse des Bildes helfen",
  "ich kann Ihnen eine allgemeine Beschreibung",
  "typischerweise in solchen",
  "cannot analyze",
  "cannot view",
  "cannot see",
  "cannot help",
  "can't help",
  "no visual",
  "not able to see",
  "not able to help",
  "general description",
  "typically in such",
  "cannot directly analyze",
  "entschuldigung, ich kann",
  "es tut mir leid, ich kann",
  "es tut mir leid, aber ich kann",
];

function isRefusalOrGeneric(text: string): boolean {
  if (!text || typeof text !== "string") return true;
  const lower = text.toLowerCase().trim();
  if (lower.length < 20) return true;
  return REFUSAL_PHRASES.some((p) => lower.includes(p.toLowerCase()));
}

async function callVisionApi(
  dataUrl: string,
  _mimeType: string,
  prompt: string,
  systemPrompt: string
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      max_tokens: 1024,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl, detail: "high" as const } },
          ],
        },
      ],
    }),
  });

  const data = (await res.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  if (!res.ok) {
    log.warn({ status: res.status, err: data?.error?.message }, "Vision API error");
    return "";
  }
  trackOpenAiUsageEvent({
    category: "vision",
    model: VISION_MODEL,
    usage: data.usage ?? null,
  });

  const text = data?.choices?.[0]?.message?.content?.trim();
  return typeof text === "string" ? text : "";
}

const DEFAULT_IMAGE_PROMPT = `Beschreibe dieses Bild vollständig auf Deutsch.

1. Alle sichtbaren Texte wörtlich (Überschriften, Buttons, Chat-Nachrichten, Zahlen, Namen, Adressen, Datumsangaben, Preise, Links, E-Mails, Produktnamen).
2. Was zeigt das Bild (Screenshot, Foto, Rechnung, Karte, Formular, Tabelle, Grafik, UI, etc.)?
3. Layout: Anordnung, Abschnitte, Tabellen, Listen.
4. Wichtige Details: Zahlen, Beträge, Fristen, Orte, Marken – alles für spätere Aufgaben relevant.

Beschreibe nur den konkreten Inhalt dieses Bildes. So vollständig wie möglich.`;

/**
 * Analyze an image with OpenAI Vision API and return a detailed text description.
 * Uses cache (24h) keyed by image URL. Returns empty string on error or if API key is missing.
 */
export async function getImageDescription(
  imageUrl: string,
  prompt: string = DEFAULT_IMAGE_PROMPT
): Promise<string> {
  if (!imageUrl?.trim()) return "";
  const key = visionCacheKey(imageUrl);
  const cached = cacheGet<string>(key);
  if (cached !== undefined) {
    if (isRefusalOrGeneric(cached)) {
      cacheDelete(key);
      return "";
    }
    return cached;
  }

  if (!OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set, skipping image analysis");
    return "";
  }

  try {
    const { buffer, mimeType } = await fetchImageBuffer(imageUrl);
    if (buffer.byteLength === 0) return "";
    if (!isLikelyImageBuffer(buffer, mimeType)) {
      log.warn({ imageUrl: imageUrl.slice(0, 80), mimeType, size: buffer.byteLength }, "Asset is not a valid image (e.g. HTML/error page), skipping");
      return "";
    }
    const base64 = Buffer.from(buffer).toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    let text = await callVisionApi(dataUrl, mimeType, prompt, VISION_SYSTEM_PROMPT);
    if (typeof text !== "string" || text.length === 0) return "";

    if (isRefusalOrGeneric(text)) {
      log.warn({ imageUrl: imageUrl.slice(0, 60), snippet: text.slice(0, 120) }, "Vision API refused, retrying with strict prompt");
      text = await callVisionApi(dataUrl, mimeType, prompt, VISION_SYSTEM_PROMPT_STRICT);
      if (typeof text !== "string" || text.length === 0) return "";
      if (isRefusalOrGeneric(text)) {
        log.warn({ imageUrl: imageUrl.slice(0, 60), snippet: text.slice(0, 120) }, "Vision API still refused after retry, treating as failure");
        return "";
      }
    }

    cacheSet(key, text, VISION_CACHE_TTL_MS);
    return text;
  } catch (e) {
    log.warn({ err: e, imageUrl: imageUrl.slice(0, 60) }, "Image analysis failed");
    return "";
  }
}

/**
 * Analyze an image from a data URL (data:image/...;base64,...). Used by tests and callers who already have image bytes.
 * Does not use cache. Returns empty string on error or if response is refusal/generic.
 */
export async function analyzeImageDataUrl(
  dataUrl: string,
  prompt: string = DEFAULT_IMAGE_PROMPT
): Promise<string> {
  if (!OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set, skipping image analysis");
    return "";
  }
  if (!dataUrl?.startsWith("data:image/")) return "";

  const text = await callVisionApi(dataUrl, "image/jpeg", prompt, VISION_SYSTEM_PROMPT);
  if (typeof text !== "string" || text.length === 0) return "";
  if (isRefusalOrGeneric(text)) {
    const retry = await callVisionApi(dataUrl, "image/jpeg", prompt, VISION_SYSTEM_PROMPT_STRICT);
    if (typeof retry === "string" && retry.length > 0 && !isRefusalOrGeneric(retry)) return retry;
    return "";
  }
  return text;
}
