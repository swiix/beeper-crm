import { NextRequest, NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";
import { readContacts, writeContacts } from "@/lib/contacts-store";
import type { CrmContact } from "@/lib/contacts";

const log = createLogger("api:crm:contacts");

/**
 * GET: return all CRM contacts from SQLite (beeper-crm.db).
 */
export async function GET() {
  try {
    const contacts = readContacts();
    return NextResponse.json(contacts);
  } catch (e) {
    log.error({ err: e }, "GET contacts failed");
    return NextResponse.json({ error: "Failed to read contacts" }, { status: 500 });
  }
}

/**
 * PUT: replace all CRM contacts in SQLite. Body must be a JSON array of CrmContact.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (!Array.isArray(body)) {
      return NextResponse.json({ error: "Body must be an array of contacts" }, { status: 400 });
    }
    writeContacts(body as CrmContact[]);
    log.info({ count: body.length }, "contacts saved");
    return NextResponse.json(readContacts());
  } catch (e) {
    log.error({ err: e }, "PUT contacts failed");
    return NextResponse.json({ error: "Failed to save contacts" }, { status: 500 });
  }
}
