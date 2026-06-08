"use client";

export type TodoAnalyzeCacheMode = "use" | "ignore";

const CACHE_MODE_LABELS: Record<TodoAnalyzeCacheMode, string> = {
  use: "Cache nutzen",
  ignore: "Cache ignorieren",
};

type TodoAnalyzeCacheControlProps = {
  analyzeForce: boolean;
  onChange: (analyzeForce: boolean) => void;
  className?: string;
  id?: string;
};

/** Inline control for todo analysis cache (maps to analyzeForce in API). */
export function TodoAnalyzeCacheControl({
  analyzeForce,
  onChange,
  className = "",
  id = "todo-analyze-cache",
}: TodoAnalyzeCacheControlProps) {
  const mode: TodoAnalyzeCacheMode = analyzeForce ? "ignore" : "use";

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs text-wa-text-secondary">
        Analyse-Cache
        <select
          id={id}
          value={mode}
          onChange={(e) => onChange(e.target.value === "ignore")}
          title={
            mode === "use"
              ? "Bereits analysierte Chats mit gleichem Nachrichten-Stand werden übersprungen (schneller, weniger API-Kosten)."
              : "Jeder Chat wird neu analysiert, auch wenn ein frischer Cache existiert."
          }
          className="tg-input mt-1 w-full py-1.5 text-sm"
        >
          {(Object.keys(CACHE_MODE_LABELS) as TodoAnalyzeCacheMode[]).map((key) => (
            <option key={key} value={key}>
              {CACHE_MODE_LABELS[key]}
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-[10px] leading-snug text-wa-text-secondary">
        {mode === "use" ? (
          <>
            Überspringt Chats mit aktuellem Cache-Marker. Für nur noch nicht gecachte Chats: Batch-Scope „Nur ohne
            Cache“.
          </>
        ) : (
          <>Erzwingt eine neue Analyse für alle gewählten Chats (entspricht Preset „Alles neu“).</>
        )}
      </p>
    </div>
  );
}
