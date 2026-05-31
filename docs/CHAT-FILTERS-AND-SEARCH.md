# Chat-Filter und Nachrichtensuche

## Chat-Liste (linke Sidebar)

### Filter: Alle / Warte auf Antwort / Nicht geantwortet

- **Alle** – Zeigt alle Chats des gewählten Accounts.
- **Warte auf Antwort** – Nur Chats, bei denen die **letzte Nachricht von dir** war (du wartest auf eine Antwort). Pro Chat wird ein **Badge** mit relativer Zeit angezeigt (z. B. „vor 2 Tagen“): wie lange es her ist, dass du geschrieben hast.
- **Nicht geantwortet** – Nur Chats, bei denen die **letzte Nachricht vom Kontakt** war (du hast noch nicht geantwortet). Badge zeigt die relative Zeit seit der letzten Nachricht des Kontakts (z. B. „vor 1 Tag“).

**Mindest-Dauer (bei „Warte auf Antwort“ / „Nicht geantwortet“):**  
Wenn einer der beiden Filter aktiv ist, erscheint ein zweites Dropdown **„Mind. keine Antwort seit:“** bzw. **„Mind. nicht geantwortet seit:“**. Damit kannst du auf **„älter als X“** einschränken:
- **Alle** – Keine zeitliche Einschränkung (alle Chats, die den Status erfüllen).
- **1 Tag / 3 Tage / 1 Woche / 2 Wochen / 1 Monat / 3 Monate / 6 Monate / 1 Jahr / 2–5 Jahre** – Es werden nur Chats angezeigt, bei denen die letzte Nachricht (von dir beim Warten, vom Kontakt beim Nicht geantwortet) **mindestens so lange zurückliegt**. Beispiel: „Warte auf Antwort“ + „1 Woche“ zeigt nur Chats, in denen du seit mindestens einer Woche auf eine Antwort wartest.

Die Badges nutzen relative Zeitformen: „gerade eben“, „vor X Min.“, „vor X Std.“, „vor X Tagen“, „vor 1 Woche“ / „vor X Wochen“, „vor X Monaten“. Tooltip am Badge: „Letzte Nachricht von dir …“ bzw. „Letzte Nachricht vom Kontakt …“.

Basis ist die **Vorschau (preview)** der Beeper-API pro Chat; das Feld `isSender` entscheidet, ob die letzte Nachricht von dir oder vom Gegenüber stammt.

---

## Nachrichtensuche im geöffneten Chat

Unter dem Chat-Header gibt es eine Filterzeile für die **Nachrichten** des aktuellen Chats.

### Textsuche

- **Eingabefeld „Text suchen…“** – Sucht im aktuellen Chat nach Nachrichten, die **exakte Wörter** enthalten (Beeper-API: literal word search).
- **Hinweis:** Einzelne, konkret geschriebene Wörter verwenden, keine langen Phrasen.
- **Beispiele für Suchwörter:** „Termin“, „Preis“, „Bestellung“, „Rückruf“, „Danke“ – jeweils ein Wort; die API findet Nachrichten, die dieses Wort in beliebiger Reihenfolge mit anderen enthalten.
- **Starten:** **Enter** drücken oder Button **„Suchen“** klicken.
- Ohne Text wird nur nach Absender/Medientyp gefiltert; mit Text wird die Suche mit diesen Filtern kombiniert.

### Weitere Filter (Absender, Medientyp)

- **Absender:** Alle / Nur ich / Nur Kontakt.
- **Medientyp:** Alle / Bild / Video / Datei / Link.

Bei aktivem Filter (inkl. Textsuche) werden die Treffer über die Beeper-**Search-API** (`GET /v1/messages/search`) geladen; ohne Filter der normale Verlauf (`GET /v1/chats/{chatID}/messages`). **„Zurücksetzen“** schaltet alle Filter aus und lädt den normalen Verlauf neu.

Siehe auch **BEEPER-API-OUTPUTS.md** (Abschnitt „GET /v1/messages/search“).
