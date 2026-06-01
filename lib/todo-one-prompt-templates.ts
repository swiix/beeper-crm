export type OnePromptTemplate = {
  id: string;
  label: string;
  prompt: string;
};

export const ONE_PROMPT_TEMPLATES: OnePromptTemplate[] = [
  {
    id: "deadlines",
    label: "Termine & Fristen",
    prompt:
      "Finde alle Termine, Fristen und zeitkritischen Zusagen im Chat. Gib nur konkrete Aufgaben mit Datum zurück.",
  },
  {
    id: "open_questions",
    label: "Offene Fragen an mich",
    prompt:
      "Welche Fragen oder Anfragen im Chat warten noch auf meine Antwort oder Aktion? Nur echte offene Punkte.",
  },
  {
    id: "purchase_intent",
    label: "Kaufinteresse",
    prompt:
      "Erkenne Kaufsignale, Angebotsinteresse oder Budget-Hinweise. Gib nur relevante Follow-up-Todos zurück.",
  },
  {
    id: "callbacks",
    label: "Rückruf / Kontakt",
    prompt:
      "Finde Chats, in denen ein Rückruf, Meeting oder erneuter Kontakt vereinbart oder impliziert wurde.",
  },
  {
    id: "documents",
    label: "Unterlagen & Rechnungen",
    prompt:
      "Finde fehlende Unterlagen, Rechnungen, Verträge oder ausstehende Dokumente, die ich liefern oder prüfen soll.",
  },
];
