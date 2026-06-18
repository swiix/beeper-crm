/**
 * CRM contacts persisted in SQLite (beeper-crm.db).
 * Migrates legacy data/contacts.json on first read.
 */

import fs from "fs";
import path from "path";
import { getDb } from "@/lib/db";
import { ensureProjectDataDir } from "@/lib/project-data-dir";
import type { CrmContact } from "@/lib/contacts";

const STORE_ROW_ID = 1;
const LEGACY_FILE = "contacts.json";

function legacyFilePath(): string {
  return path.join(ensureProjectDataDir(), LEGACY_FILE);
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

function sanitizeContacts(contacts: unknown): CrmContact[] {
  if (!Array.isArray(contacts)) return [];
  return contacts.filter(isValidContact) as CrmContact[];
}

function readLegacyJsonContacts(): CrmContact[] {
  try {
    const filePath = legacyFilePath();
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    return sanitizeContacts(parsed);
  } catch {
    return [];
  }
}

function migrateLegacyContactsIfNeeded(): void {
  const db = getDb();
  const existing = db.prepare("SELECT 1 FROM crm_contacts_store WHERE id = ?").get(STORE_ROW_ID);
  if (existing) return;

  const legacy = readLegacyJsonContacts();
  const now = Date.now();
  db.prepare(
    `INSERT INTO crm_contacts_store (id, contacts_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET contacts_json = excluded.contacts_json, updated_at = excluded.updated_at`
  ).run(STORE_ROW_ID, JSON.stringify(legacy), now);
}

function persistContacts(contacts: CrmContact[]): void {
  const db = getDb();
  const safe = sanitizeContacts(contacts);
  db.prepare(
    `INSERT INTO crm_contacts_store (id, contacts_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET contacts_json = excluded.contacts_json, updated_at = excluded.updated_at`
  ).run(STORE_ROW_ID, JSON.stringify(safe), Date.now());
}

/** Read all CRM contacts from SQLite. */
export function readContactsFromDb(): CrmContact[] {
  migrateLegacyContactsIfNeeded();
  const db = getDb();
  const row = db
    .prepare("SELECT contacts_json FROM crm_contacts_store WHERE id = ?")
    .get(STORE_ROW_ID) as { contacts_json: string } | undefined;
  if (!row?.contacts_json) return [];
  try {
    return sanitizeContacts(JSON.parse(row.contacts_json));
  } catch {
    return [];
  }
}

/** Replace all CRM contacts in SQLite. */
export function writeContactsToDb(contacts: CrmContact[]): CrmContact[] {
  const safe = sanitizeContacts(contacts);
  persistContacts(safe);
  return safe;
}
