# Umsetzungsplan: Todo-Liste (TODO.md)

Nach jeder fertiggestellten Funktion den zugehörigen Eintrag in [TODO.md](../TODO.md) von `- [ ]` auf `- [x]` ändern.

---

## 1. Chats für Analyse ignorieren

**Ziel:** Bestimmte Chats per Rechtsklick ignorieren; Kontextmenü zum Toggeln; Symbol bei ignorierten Chats.

### Speicher

- **localStorage** (Key z. B. `beeper-crm:todo-ignored-chats`, Wert: JSON-Array von Chat-IDs). Kein Backend nötig.

### Schritte

1. **State + Persistenz** in `TodoListView.tsx`:
   - State `ignoredChatIds` aus localStorage initialisieren (z. B. `useState(() => getIgnoredFromStorage())`).
   - Bei Änderung in localStorage schreiben (`useEffect` auf `ignoredChatIds`).

2. **Kontextmenü:**
   - Auf jedem Chat-Button in Spalte 1: `onContextMenu={(e) => { e.preventDefault(); openContextMenu(e, chatId); }}`.
   - Menü mit einem Eintrag: „Für Analyse ignorieren“ / „Von Ignorieren entfernen“ (Toggle). Klick toggelt die Chat-ID in `ignoredChatIds` und speichert.

3. **Symbol:**
   - Wenn `ignoredChatIds.includes(chat.id)`: neben dem Chat-Namen ein Symbol (z. B. 🚫) mit `title="Für Todo-Analyse ignoriert"` anzeigen.

4. **Filter bei Analysen:**
   - Überall, wo Chats für „Vorschläge für alle sichtbaren“ oder „Auswahl analysieren“ verwendet werden: ignorierten Chats herausfiltern, z. B. `filteredChatsForList.filter(c => !ignoredChatIds.includes(c.id))` für die tatsächlich genutzte Chat-Liste.

5. **TODO.md abhaken:** Erste Zeile von `- [ ]` auf `- [x]` ändern.

---

## 2. Alle Vorschläge anzeigen

**Ziel:** Button „ALLE“ oben; bei Klick alle Vorschläge aus allen Chats in einer Ansicht anzeigen.

### Konzept

- Virtueller Eintrag mit fester ID, z. B. `selectedChatId === "__all__"`.
- In der Vorschläge-Spalte dann eine flache Liste aus `suggestionsByChat` (wie Batch-Ansicht, aber aus aktuellem Cache).

### Schritte

1. **Button „ALLE“** in Spalte 1 (oberhalb der Chat-Liste):
   - Klick setzt `setSelectedChatId("__all__")` (oder eigener State `viewAllSuggestions`). Auswahl in der Liste entsprechend hervorheben.

2. **Vorschläge anzeigen:**
   - Wenn `selectedChatId === "__all__"`: `useMemo` baut aus `suggestionsByChat` eine flache Liste `allSuggestionsFlat` (Format wie `batchSuggestionsFlat`: `{ chatId, chatName, suggestion, indexInChat }`). Reihenfolge z. B. nach `filteredChatsForList` oder Chat-Name.
   - Dieselbe Listen-UI wie bei Batch/Einzelchat (Karten mit Titel, Frist, Notizen, „Chat: Name“, Bearbeiten, Ablehnen, Akzeptieren). Bestehende Callbacks (z. B. `rejectSuggestion(chatId, indexInChat)`, `acceptSuggestion(...)`) weiterverwenden.

3. **Chat-Liste:**
   - „ALLE“ als fester Eintrag oben; Klick auf echten Chat setzt `selectedChatId` wieder auf diese ID.

4. **TODO.md abhaken:** Zweite Zeile von `- [ ]` auf `- [x]` ändern.

---

## Reihenfolge

1. Zuerst **Punkt 1** (Ignorieren) umsetzen → dann in TODO.md abhaken.
2. Danach **Punkt 2** (ALLE) umsetzen → dann in TODO.md abhaken.
