#!/usr/bin/env node
/**
 * Tests image analysis (Vision API) via local API.
 * Run with dev server: npm run dev
 * Then: node scripts/test-vision.mjs [imageUrl]
 * Default image: small public PNG (Wikipedia logo). Exit 0 = success, 1 = failure.
 */

const BASE = process.env.TEST_VISION_BASE || "http://localhost:3001";
const DEFAULT_IMAGE = "https://picsum.photos/200/200";

async function main() {
  const imageUrl = process.argv[2]?.trim() || DEFAULT_IMAGE;
  console.log("Testing vision with image:", imageUrl.slice(0, 60) + "...");
  let res;
  try {
    res = await fetch(`${BASE}/api/test-vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    });
  } catch (e) {
    console.error("Request failed (is the dev server running on", BASE, "?):", e.message);
    process.exit(1);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error("API error:", res.status, data?.error ?? res.statusText);
    process.exit(1);
  }

  if (data.ok !== true) {
    console.error("Vision failed:", data?.error ?? "No description returned");
    process.exit(1);
  }

  const desc = (data.description ?? "").trim();
  if (!desc) {
    console.error("Empty description");
    process.exit(1);
  }

  console.log("OK – description length:", desc.length);
  console.log("Preview:", desc.slice(0, 200) + (desc.length > 200 ? "…" : ""));
  process.exit(0);
}

main();
