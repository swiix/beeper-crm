#!/usr/bin/env node
/**
 * Probes Beeper Desktop API (localhost) and saves raw JSON responses
 * for reverse-engineering response shapes. Run: node scripts/probe-beeper-api.mjs
 * Requires: Beeper Desktop running with API enabled, .env.local with BEEPER_MCP_TOKEN.
 */

import { readFileSync, mkdirSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "docs", "beeper-api-samples");

function loadEnv() {
  try {
    const raw = readFileSync(join(root, ".env.local"), "utf8");
    const env = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return env;
  } catch {
    return {};
  }
}

const env = loadEnv();
const BASE = env.BEEPER_API_URL || "http://localhost:23373";
const TOKEN = env.BEEPER_MCP_TOKEN || "";

async function fetchApi(path) {
  const url = `${BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(TOKEN && { Authorization: `Bearer ${TOKEN}` }),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { _raw: text, _status: res.status };
  }
  return { status: res.status, data };
}

function save(name, content) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(content, null, 2), "utf8");
  console.log("Saved", name);
}

async function main() {
  console.log("Beeper API base:", BASE);
  if (!TOKEN) console.warn("No BEEPER_MCP_TOKEN in .env.local");

  const results = {};

  const accountsRes = await fetchApi("/v1/accounts");
  results.accounts = accountsRes;
  save("01-accounts", accountsRes);

  const accountsList = Array.isArray(accountsRes.data) ? accountsRes.data : accountsRes.data?.items ?? [];
  const firstAccountId = accountsList[0]?.accountID ?? accountsList[0]?.id ?? null;

  if (firstAccountId) {
    const chatsRes = await fetchApi(`/v1/chats?accountIDs=${encodeURIComponent(firstAccountId)}`);
    results.chats = chatsRes;
    save("02-chats", chatsRes);

    const chatsList = chatsRes.data?.items ?? [];
    const firstChatId = chatsList[0]?.id ?? null;
    if (firstChatId) {
      const chatDetailRes = await fetchApi(`/v1/chats/${encodeURIComponent(firstChatId)}`);
      results.chatDetail = chatDetailRes;
      save("03-chat-detail", chatDetailRes);

      const messagesRes = await fetchApi(`/v1/chats/${encodeURIComponent(firstChatId)}/messages`);
      results.messages = messagesRes;
      save("04-messages", messagesRes);
    }
  }

  save("00-index", {
    note: "Beeper Desktop API response samples. Keys: status, data.",
    endpoints: Object.keys(results),
  });
  console.log("Done. Output in docs/beeper-api-samples/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
