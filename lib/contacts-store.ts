/**
 * Server-side CRM contacts persistence (data/contacts.json).
 * Used by API routes; client uses localStorage and syncs via API.
 */

import fs from "fs";
import path from "path";
import { ensureProjectDataDir } from "@/lib/project-data-dir";
import type { CrmContact } from "@/lib/contacts";

const FILE_NAME = "contacts.json";

function getFilePath(): string {
  return path.join(ensureProjectDataDir(), FILE_NAME);
}

function isValidContact(c: unknown): c is CrmContact {
  if (!c || typeof c !== "object") return false;
  const o = c as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    Array.isArray(o.chats) &&
    o.chats.every(
      (ch: unknown) =>
        ch &&
        typeof ch === "object" &&
        typeof (ch as Record<string, unknown>).chatId === "string" &&
        typeof (ch as Record<string, unknown>).accountId === "string"
    )
  );
}

/**
 * Read all CRM contacts from data/contacts.json. Returns [] if file missing or invalid.
 */
export function readContacts(): CrmContact[] {
  try {
    const filePath = getFilePath();
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidContact) as CrmContact[];
  } catch {
    return [];
  }
}

/**
 * Write CRM contacts to data/contacts.json. Overwrites existing file.
 */
export function writeContacts(contacts: CrmContact[]): void {
  const filePath = getFilePath();
  const safe = Array.isArray(contacts) ? contacts.filter(isValidContact) : [];
  fs.writeFileSync(filePath, JSON.stringify(safe, null, 2), "utf-8");
}
