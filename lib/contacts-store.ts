/**
 * Server-side CRM contacts persistence (SQLite beeper-crm.db).
 * Client uses localStorage and syncs via API.
 */

import { readContactsFromDb, writeContactsToDb } from "@/lib/crm-contacts-db";
import type { CrmContact } from "@/lib/contacts";

/** Read all CRM contacts from SQLite. */
export function readContacts(): CrmContact[] {
  return readContactsFromDb();
}

/** Write CRM contacts to SQLite. */
export function writeContacts(contacts: CrmContact[]): void {
  writeContactsToDb(contacts);
}
