/**
 * CRM Contact: one lead can have multiple chats (e.g. Instagram + WhatsApp).
 * Persisted in localStorage (per browser) and synced to server (SQLite via API).
 */

export interface ContactChat {
  chatId: string;
  accountId: string;
  /** Network label for display, e.g. "instagram", "whatsapp" */
  network?: string;
}

export interface CrmContact {
  id: string;
  displayName?: string;
  chats: ContactChat[];
  stage?: string;
  /** Optional: first chat id used for sorting by last activity (set by UI) */
  lastActivityAt?: string;
  /** Last time the user (me) sent a message to this contact (any of their chats). ISO string. */
  lastContactedByMeAt?: string;
  /** Last time the contact sent a message (any of their chats). ISO string. */
  lastContactedByThemAt?: string;
}

const STORAGE_KEY = "beeper-crm-contacts";

function loadFromStorage(): CrmContact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CrmContact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(contacts: CrmContact[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
    persistContactsToServer(contacts);
  } catch {
    // ignore
  }
}

/** Persist current contacts to server (SQLite). Fire-and-forget. */
function persistContactsToServer(contacts: CrmContact[]) {
  if (typeof window === "undefined") return;
  fetch("/api/crm/contacts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(contacts),
  }).catch(() => {
    // ignore network errors; next save will retry
  });
}

/**
 * Load contacts from server into localStorage. Call once on app init so the client
 * uses the same data as the server (SQLite beeper-crm.db).
 */
/**
 * Load contacts from server (SQLite) into localStorage.
 * Call once on app init. If server has data, use it; if server is empty but we have local data, push to server first.
 */
export function loadContactsFromServer(): void {
  if (typeof window === "undefined") return;
  fetch("/api/crm/contacts")
    .then((res) => (res.ok ? res.json() : null))
    .then((data: CrmContact[] | null) => {
      if (!Array.isArray(data)) return;
      try {
        if (data.length > 0) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
          window.dispatchEvent(new CustomEvent("contacts-synced"));
        } else {
          const local = loadFromStorage();
          if (local.length > 0) {
            fetch("/api/crm/contacts", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(local),
            }).catch(() => {});
          }
        }
      } catch {
        // ignore
      }
    })
    .catch(() => {
      // keep using existing localStorage on network error
    });
}

export function getContacts(): CrmContact[] {
  return loadFromStorage();
}

export function getContactByChatId(chatId: string): CrmContact | null {
  return loadFromStorage().find((c) => c.chats.some((ch) => ch.chatId === chatId)) ?? null;
}

export function getContactById(id: string): CrmContact | null {
  return loadFromStorage().find((c) => c.id === id) ?? null;
}

function nextId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createContact(displayName: string, chatId: string, accountId: string, network?: string): CrmContact {
  const contacts = loadFromStorage();
  const contact: CrmContact = {
    id: nextId(),
    displayName: displayName || "Neuer Kontakt",
    chats: [{ chatId, accountId, network }],
    stage: "Unzugeordnet",
  };
  contacts.push(contact);
  saveToStorage(contacts);
  return contact;
}

export function addChatToContact(contactId: string, chatId: string, accountId: string, network?: string): CrmContact | null {
  const contacts = loadFromStorage();
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return null;
  if (contact.chats.some((ch) => ch.chatId === chatId)) return contact;
  contact.chats.push({ chatId, accountId, network });
  saveToStorage(contacts);
  return contact;
}

export function removeChatFromContact(contactId: string, chatId: string): CrmContact | null {
  const contacts = loadFromStorage();
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return null;
  contact.chats = contact.chats.filter((ch) => ch.chatId !== chatId);
  if (contact.chats.length === 0) {
    const next = contacts.filter((c) => c.id !== contactId);
    saveToStorage(next);
    return null;
  }
  saveToStorage(contacts);
  return contact;
}

export function updateContact(
  contactId: string,
  updates: Partial<Pick<CrmContact, "displayName" | "stage" | "lastContactedByMeAt" | "lastContactedByThemAt">>
): CrmContact | null {
  const contacts = loadFromStorage();
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return null;
  if (updates.displayName !== undefined) contact.displayName = updates.displayName;
  if (updates.stage !== undefined) contact.stage = updates.stage;
  if (updates.lastContactedByMeAt !== undefined) contact.lastContactedByMeAt = updates.lastContactedByMeAt;
  if (updates.lastContactedByThemAt !== undefined) contact.lastContactedByThemAt = updates.lastContactedByThemAt;
  saveToStorage(contacts);
  return contact;
}

export function setContactLastActivity(contactId: string, iso: string): void {
  const contacts = loadFromStorage();
  const contact = contacts.find((c) => c.id === contactId);
  if (!contact) return;
  contact.lastActivityAt = iso;
  saveToStorage(contacts);
}

/** All chatIds that are assigned to any contact */
export function getAssignedChatIds(): Set<string> {
  const set = new Set<string>();
  loadFromStorage().forEach((c) => c.chats.forEach((ch) => set.add(ch.chatId)));
  return set;
}
