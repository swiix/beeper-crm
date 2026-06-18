"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildAppUrl } from "@/lib/app-routes";
import { useSettings } from "./SettingsContext";
import { useTheme } from "./ThemeProvider";
import { SettingsLayout, type SettingsTabDef } from "./settings/SettingsLayout";
import {
  SettingsError,
  SettingsLoading,
  SettingsSaveButton,
  SettingsSection,
} from "./settings/SettingsSection";
import { ApiKeysSettingsTab } from "./settings/ApiKeysSettingsTab";
import { ApiKeysSetupBanner } from "./ApiKeysSetupBanner";
import type { ApiKeyRequirement } from "@/lib/api-keys-ui";

const SETTINGS_TABS: SettingsTabDef[] = [
  { id: "general", label: "Allgemein", hint: "Theme und grundlegendes Chat-Verhalten." },
  { id: "api", label: "API-Schlüssel", hint: "Beeper, OpenAI, Google Tasks und Reclaim." },
  { id: "tinder", label: "Tinder", hint: "TinderChat: Tastatur, Preload und Reminder-Vorlagen." },
  { id: "crm", label: "CRM", hint: "Automatische Follow-up- und Keyword-Regeln." },
  { id: "todo", label: "Todo", hint: "KI-Extraktion, Sync mit Google Tasks und Reclaim." },
  { id: "ai", label: "KI", hint: "System-Prompts für Chat-Analysen." },
  { id: "system", label: "System", hint: "Cache-Lebensdauer und Performance." },
];

const VALID_TAB_IDS = new Set(SETTINGS_TABS.map((t) => t.id));

/** JSON keys that must be mentioned in the analysis prompt so the AI output is valid. */
const REQUIRED_PROMPT_JSON_KEYS = [
  "summary",
  "branche",
  "wunsch",
  "pain",
  "kaufkraft",
  "stage",
  "nextMessageSuggestions",
] as const;

function getMissingPromptKeys(prompt: string): string[] {
  const lower = prompt.trim().toLowerCase();
  return REQUIRED_PROMPT_JSON_KEYS.filter((key) => !lower.includes(key.toLowerCase()));
}

export function SettingsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab = tabParam && VALID_TAB_IDS.has(tabParam) ? tabParam : "general";

  const setActiveTab = useCallback(
    (tabId: string) => {
      router.replace(
        buildAppUrl({
          view: "settings",
          tab: tabId === "general" ? null : tabId,
        }),
        { scroll: false }
      );
    },
    [router]
  );

  const {
    settings,
    setAutoInsertFirstSuggestion,
    setShiftEnterJumpsToNextChat,
    setOpenChatWith,
    setTinderKeyboardLayout,
    setTinderMessagePreloadCount,
  } = useSettings();
  const { theme, setTheme } = useTheme();
  const [analysisSystemPrompt, setAnalysisSystemPrompt] = useState("");
  const [quickReplyPromptSuffix, setQuickReplyPromptSuffix] = useState("");
  const [tinderSuggestionsCount, setTinderSuggestionsCount] = useState(5);
  const [tinderPromptSuffix, setTinderPromptSuffix] = useState("");
  const [tinderSummaryPromptSuffix, setTinderSummaryPromptSuffix] = useState("");
  const [promptsLoading, setPromptsLoading] = useState(true);
  const [promptsSaving, setPromptsSaving] = useState(false);
  const [promptsError, setPromptsError] = useState<string | null>(null);
  const [maxFollowUpsBeforeLost, setMaxFollowUpsBeforeLost] = useState(5);
  const [autoLeadKeywords, setAutoLeadKeywords] = useState("");
  const [autoQualifiedKeywords, setAutoQualifiedKeywords] = useState("");
  const [autoLeadMessageKeywords, setAutoLeadMessageKeywords] = useState("");
  const [analysisConcurrency, setAnalysisConcurrency] = useState(5);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);
  type CacheTTLKey = "accounts" | "chats" | "chatDetail" | "analysis" | "transcript";
  type CacheTTLUnit = "s" | "m" | "h" | "d";

  const [cacheTTL, setCacheTTL] = useState({
    accounts: 1,
    chats: 5,
    chatDetail: 5,
    analysis: 10080,
    transcript: 1440,
  });
  const [cacheTTLUnit, setCacheTTLUnit] = useState<Record<CacheTTLKey, CacheTTLUnit>>({
    accounts: "m",
    chats: "m",
    chatDetail: "m",
    analysis: "d",
    transcript: "h",
  });
  const [cacheLoading, setCacheLoading] = useState(true);
  const [cacheSaving, setCacheSaving] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [cacheClearingType, setCacheClearingType] = useState<string | null>(null);

  type ReminderPresetItem = { id: string; label: string; type: "hours" | "days"; value: number; time?: string };
  const [reminderPresets, setReminderPresets] = useState<ReminderPresetItem[]>([]);
  const [reminderPresetsLoading, setReminderPresetsLoading] = useState(true);
  const [reminderPresetsSaving, setReminderPresetsSaving] = useState(false);
  const [reminderPresetsError, setReminderPresetsError] = useState<string | null>(null);
  const [newReminderLabel, setNewReminderLabel] = useState("");
  const [newReminderType, setNewReminderType] = useState<"hours" | "days">("hours");
  const [newReminderValue, setNewReminderValue] = useState(1);
  const [newReminderTime, setNewReminderTime] = useState("06:00");

  const [todoListPrompt, setTodoListPrompt] = useState("");
  const [todoListMessageLimit, setTodoListMessageLimit] = useState(20);
  const [todoListDefaultDeadlineDays, setTodoListDefaultDeadlineDays] = useState(3);
  const [todoListDefaultDurationHours, setTodoListDefaultDurationHours] = useState(0.25);
  const [todoSyncTarget, setTodoSyncTarget] = useState<"google" | "reclaim">("google");
  const [autoSyncOnAccept, setAutoSyncOnAccept] = useState(true);
  const [googleTasksConnected, setGoogleTasksConnected] = useState<boolean | null>(null);
  const [reclaimConnected, setReclaimConnected] = useState<boolean | null>(null);
  const [reclaimTokenHint, setReclaimTokenHint] = useState<string | null>(null);
  const [reclaimEmail, setReclaimEmail] = useState<string | null>(null);
  const [todoSettingsLoading, setTodoSettingsLoading] = useState(true);
  const [todoSettingsSaving, setTodoSettingsSaving] = useState(false);
  const [todoSettingsError, setTodoSettingsError] = useState<string | null>(null);
  const [suggestionsCacheClearing, setSuggestionsCacheClearing] = useState(false);
  const [suggestionsCacheMessage, setSuggestionsCacheMessage] = useState<string | null>(null);

  const minutesToDisplay = (minutes: number, unit: CacheTTLUnit): number => {
    switch (unit) {
      case "s":
        return minutes * 60;
      case "m":
        return minutes;
      case "h":
        return minutes / 60;
      case "d":
        return minutes / 1440;
      default:
        return minutes;
    }
  };

  const displayToMinutes = (value: number, unit: CacheTTLUnit): number => {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) return 0;
    let minutes: number;
    switch (unit) {
      case "s":
        minutes = n / 60;
        break;
      case "m":
        minutes = n;
        break;
      case "h":
        minutes = n * 60;
        break;
      case "d":
        minutes = n * 1440;
        break;
      default:
        minutes = n;
    }
    return Math.max(0, Math.min(MAX_MINUTES, Math.round(minutes)));
  };

  const MAX_MINUTES = 525600;
  const displayMax = (unit: CacheTTLUnit): number => {
    switch (unit) {
      case "s":
        return MAX_MINUTES * 60;
      case "m":
        return MAX_MINUTES;
      case "h":
        return MAX_MINUTES / 60;
      case "d":
        return MAX_MINUTES / 1440;
      default:
        return MAX_MINUTES;
    }
  };

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const res = await fetch("/api/settings/rules");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden fehlgeschlagen");
      setMaxFollowUpsBeforeLost(data.maxFollowUpsBeforeLost ?? 5);
      setAutoLeadKeywords(data.autoLeadKeywords ?? "");
      setAutoQualifiedKeywords(data.autoQualifiedKeywords ?? "");
      setAutoLeadMessageKeywords(data.autoLeadMessageKeywords ?? "");
      setAnalysisConcurrency(
        typeof data.analysisConcurrency === "number" && data.analysisConcurrency >= 1
          ? Math.min(50, Math.round(data.analysisConcurrency))
          : 5
      );
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Regeln konnten nicht geladen werden");
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const saveRules = async () => {
    setRulesSaving(true);
    setRulesError(null);
    try {
      const res = await fetch("/api/settings/rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maxFollowUpsBeforeLost: maxFollowUpsBeforeLost,
          autoLeadKeywords: autoLeadKeywords.trim(),
          autoQualifiedKeywords: autoQualifiedKeywords.trim(),
          autoLeadMessageKeywords: autoLeadMessageKeywords.trim(),
          analysisConcurrency: Math.max(1, Math.min(50, Math.round(analysisConcurrency))),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Speichern fehlgeschlagen");
      setMaxFollowUpsBeforeLost(data.maxFollowUpsBeforeLost ?? 5);
      setAutoLeadKeywords(data.autoLeadKeywords ?? "");
      setAutoQualifiedKeywords(data.autoQualifiedKeywords ?? "");
      setAutoLeadMessageKeywords(data.autoLeadMessageKeywords ?? "");
      setAnalysisConcurrency(
        typeof data.analysisConcurrency === "number" && data.analysisConcurrency >= 1
          ? Math.min(50, Math.round(data.analysisConcurrency))
          : 5
      );
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : "Regeln konnten nicht gespeichert werden");
    } finally {
      setRulesSaving(false);
    }
  };

  const loadCacheSettings = useCallback(async () => {
    setCacheLoading(true);
    setCacheError(null);
    try {
      const res = await fetch("/api/settings/cache");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden fehlgeschlagen");
      setCacheTTL({
        accounts: data.accounts ?? 1,
        chats: data.chats ?? 5,
        chatDetail: data.chatDetail ?? 5,
        analysis: data.analysis ?? 10080,
        transcript: data.transcript ?? 1440,
      });
    } catch (e) {
      setCacheError(e instanceof Error ? e.message : "Cache-Einstellungen konnten nicht geladen werden");
    } finally {
      setCacheLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCacheSettings();
  }, [loadCacheSettings]);

  const loadReminderPresets = useCallback(async () => {
    setReminderPresetsLoading(true);
    setReminderPresetsError(null);
    try {
      const res = await fetch("/api/settings/reminder-presets");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden fehlgeschlagen");
      setReminderPresets(Array.isArray(data.presets) ? data.presets : []);
    } catch (e) {
      setReminderPresetsError(e instanceof Error ? e.message : "Reminder-Vorlagen konnten nicht geladen werden");
    } finally {
      setReminderPresetsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReminderPresets();
  }, [loadReminderPresets]);

  const saveReminderPresets = async () => {
    setReminderPresetsSaving(true);
    setReminderPresetsError(null);
    try {
      const res = await fetch("/api/settings/reminder-presets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presets: reminderPresets }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Speichern fehlgeschlagen");
      setReminderPresets(Array.isArray(data.presets) ? data.presets : []);
    } catch (e) {
      setReminderPresetsError(e instanceof Error ? e.message : "Reminder-Vorlagen konnten nicht gespeichert werden");
    } finally {
      setReminderPresetsSaving(false);
    }
  };

  const addReminderPreset = () => {
    const label = newReminderLabel.trim() || (newReminderType === "hours" ? `In ${newReminderValue} h` : `In ${newReminderValue} Tagen`);
    const id = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setReminderPresets((prev) => [
      ...prev,
      {
        id,
        label,
        type: newReminderType,
        value: newReminderType === "hours" ? Math.max(0, Math.min(720, newReminderValue)) : Math.max(0, Math.min(365, newReminderValue)),
        time: newReminderType === "days" && /^[0-9]{1,2}:[0-9]{2}$/.test(newReminderTime.trim()) ? newReminderTime.trim() : undefined,
      },
    ]);
    setNewReminderLabel("");
    setNewReminderValue(1);
    setNewReminderTime("06:00");
  };

  const removeReminderPreset = (id: string) => {
    setReminderPresets((prev) => prev.filter((p) => p.id !== id));
  };

  const clearCacheByType = async (type: string) => {
    setCacheClearingType(type);
    setCacheError(null);
    try {
      const res = await fetch("/api/settings/cache/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Cache leeren fehlgeschlagen");
    } catch (e) {
      setCacheError(e instanceof Error ? e.message : "Cache konnte nicht geleert werden");
    } finally {
      setCacheClearingType(null);
    }
  };

  const saveCacheSettings = async () => {
    setCacheSaving(true);
    setCacheError(null);
    try {
      const res = await fetch("/api/settings/cache", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cacheTTL),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Speichern fehlgeschlagen");
      setCacheTTL({
        accounts: data.accounts ?? 1,
        chats: data.chats ?? 5,
        chatDetail: data.chatDetail ?? 5,
        analysis: data.analysis ?? 10080,
        transcript: data.transcript ?? 1440,
      });
    } catch (e) {
      setCacheError(e instanceof Error ? e.message : "Cache-Einstellungen konnten nicht gespeichert werden");
    } finally {
      setCacheSaving(false);
    }
  };

  const loadPrompts = useCallback(async () => {
    setPromptsLoading(true);
    setPromptsError(null);
    try {
      const res = await fetch("/api/settings/prompts");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden fehlgeschlagen");
      setAnalysisSystemPrompt(data.analysisSystemPrompt ?? "");
      setQuickReplyPromptSuffix(data.quickReplyPromptSuffix ?? "");
      const n = data.tinderSuggestionsCount;
      setTinderSuggestionsCount(
        typeof n === "number" && n >= 1 && n <= 10 ? n : 5
      );
      setTinderPromptSuffix(data.tinderPromptSuffix ?? "");
      setTinderSummaryPromptSuffix(data.tinderSummaryPromptSuffix ?? "");
    } catch (e) {
      setPromptsError(e instanceof Error ? e.message : "Prompts konnten nicht geladen werden");
    } finally {
      setPromptsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const loadTodoSettings = useCallback(async () => {
    setTodoSettingsLoading(true);
    setTodoSettingsError(null);
    try {
      const res = await fetch("/api/settings/todo-list");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Laden fehlgeschlagen");
      setTodoListPrompt(data.todoListPrompt ?? "");
      const limit = data.todoListMessageLimit;
      setTodoListMessageLimit(
        typeof limit === "number" && limit >= 0 && limit <= 50 ? limit : 20
      );
      const days = data.todoListDefaultDeadlineDays;
      setTodoListDefaultDeadlineDays(
        typeof days === "number" && days >= 1 && days <= 30 ? days : 3
      );
      const durationHours = data.todoListDefaultDurationHours;
      setTodoListDefaultDurationHours(
        typeof durationHours === "number" && durationHours > 0 && durationHours <= 24 ? durationHours : 0.25
      );
      setTodoSyncTarget(data.todoSyncTarget === "reclaim" ? "reclaim" : "google");
      setAutoSyncOnAccept(typeof data.autoSyncOnAccept === "boolean" ? data.autoSyncOnAccept : true);
      try {
        const statusRes = await fetch("/api/google-tasks/status");
        const statusData = (await statusRes.json().catch(() => ({}))) as { connected?: boolean };
        setGoogleTasksConnected(statusRes.ok && statusData.connected === true);
      } catch {
        setGoogleTasksConnected(null);
      }
      try {
        const reclaimRes = await fetch("/api/reclaim/status");
        const reclaimData = (await reclaimRes.json().catch(() => ({}))) as {
          connected?: boolean;
          tokenHint?: string | null;
          email?: string | null;
        };
        setReclaimConnected(reclaimRes.ok && reclaimData.connected === true);
        setReclaimTokenHint(typeof reclaimData.tokenHint === "string" ? reclaimData.tokenHint : null);
        setReclaimEmail(typeof reclaimData.email === "string" ? reclaimData.email : null);
      } catch {
        setReclaimConnected(null);
      }
    } catch (e) {
      setTodoSettingsError(e instanceof Error ? e.message : "Todo-Einstellungen konnten nicht geladen werden");
    } finally {
      setTodoSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTodoSettings();
  }, [loadTodoSettings]);

  const saveTodoSettings = async () => {
    setTodoSettingsSaving(true);
    setTodoSettingsError(null);
    try {
      const res = await fetch("/api/settings/todo-list", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          todoListPrompt: todoListPrompt.trim() || undefined,
          todoListMessageLimit: Math.min(50, Math.max(0, todoListMessageLimit)),
          todoListDefaultDeadlineDays: Math.min(30, Math.max(1, todoListDefaultDeadlineDays)),
          todoListDefaultDurationHours: Math.min(24, Math.max(0.05, Number(todoListDefaultDurationHours.toFixed(2)))),
          todoSyncTarget,
          autoSyncOnAccept,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Speichern fehlgeschlagen");
      setTodoListPrompt(data.todoListPrompt ?? todoListPrompt);
      setTodoListMessageLimit(data.todoListMessageLimit ?? todoListMessageLimit);
      setTodoListDefaultDeadlineDays(data.todoListDefaultDeadlineDays ?? todoListDefaultDeadlineDays);
      if (typeof data.todoListDefaultDurationHours === "number") {
        setTodoListDefaultDurationHours(data.todoListDefaultDurationHours);
      }
      if (data.todoSyncTarget === "google" || data.todoSyncTarget === "reclaim") {
        setTodoSyncTarget(data.todoSyncTarget);
      }
      if (typeof data.autoSyncOnAccept === "boolean") {
        setAutoSyncOnAccept(data.autoSyncOnAccept);
      }
      if (typeof window !== "undefined" && data.promptChanged === true) {
        sessionStorage.setItem("todoPromptChanged", "1");
      }
    } catch (e) {
      setTodoSettingsError(e instanceof Error ? e.message : "Todo-Einstellungen konnten nicht gespeichert werden");
    } finally {
      setTodoSettingsSaving(false);
    }
  };

  const clearTodoSuggestionsCache = async () => {
    setSuggestionsCacheClearing(true);
    setSuggestionsCacheMessage(null);
    try {
      const res = await fetch("/api/todo-list/suggestions/clear", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Cache konnte nicht geleert werden");
      setSuggestionsCacheMessage("Vorschläge-Cache geleert.");
    } catch (e) {
      setSuggestionsCacheMessage(e instanceof Error ? e.message : "Cache konnte nicht geleert werden");
    } finally {
      setSuggestionsCacheClearing(false);
    }
  };

  const missingPromptKeys = useMemo(
    () => getMissingPromptKeys(analysisSystemPrompt),
    [analysisSystemPrompt]
  );
  const promptValidationOk = missingPromptKeys.length === 0;

  const settingsApiKeyRequirements = useMemo((): ApiKeyRequirement[] => {
    if (activeTab === "ai") return ["openai"];
    if (activeTab === "todo") {
      const reqs: ApiKeyRequirement[] = ["openai"];
      if (todoSyncTarget === "google") reqs.push("google");
      if (todoSyncTarget === "reclaim") reqs.push("reclaim");
      return reqs;
    }
    return [];
  }, [activeTab, todoSyncTarget]);

  const savePrompts = async () => {
    if (!promptValidationOk) {
      setPromptsError(
        `Diese Keys müssen im Prompt vorkommen: ${missingPromptKeys.join(", ")}. Bitte ergänzen, dann kann gespeichert werden.`
      );
      return;
    }
    setPromptsSaving(true);
    setPromptsError(null);
    try {
      const res = await fetch("/api/settings/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysisSystemPrompt: analysisSystemPrompt.trim() || undefined,
          quickReplyPromptSuffix: quickReplyPromptSuffix.trim() || undefined,
          tinderSuggestionsCount:
            tinderSuggestionsCount >= 1 && tinderSuggestionsCount <= 10
              ? tinderSuggestionsCount
              : 5,
          tinderPromptSuffix: tinderPromptSuffix.trim() || undefined,
          tinderSummaryPromptSuffix: tinderSummaryPromptSuffix.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Speichern fehlgeschlagen");
      setAnalysisSystemPrompt(data.analysisSystemPrompt ?? "");
      setQuickReplyPromptSuffix(data.quickReplyPromptSuffix ?? "");
      if (typeof data.tinderSuggestionsCount === "number")
        setTinderSuggestionsCount(data.tinderSuggestionsCount);
      setTinderPromptSuffix(data.tinderPromptSuffix ?? "");
      setTinderSummaryPromptSuffix(data.tinderSummaryPromptSuffix ?? "");
    } catch (e) {
      setPromptsError(e instanceof Error ? e.message : "Prompts konnten nicht gespeichert werden");
    } finally {
      setPromptsSaving(false);
    }
  };

  return (
    <SettingsLayout tabs={SETTINGS_TABS} activeTab={activeTab} onTabChange={setActiveTab}>
      {settingsApiKeyRequirements.length > 0 && (
        <ApiKeysSetupBanner requirements={settingsApiKeyRequirements} className="-mx-4 -mt-4 mb-2 md:-mx-6 md:-mt-6 md:mb-4" />
      )}
      {activeTab === "general" && (
        <>
          <SettingsSection title="Erscheinungsbild" description="Standard ist ein helles Theme; der bisherige dunkle Chat-Stil ist weiterhin wählbar.">
            <label htmlFor="color-theme" className="block text-sm font-medium text-wa-text-primary">
              Farbschema
            </label>
            <select
              id="color-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as "light" | "dark")}
              className="mt-2 rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
            >
              <option value="light">Hell</option>
              <option value="dark">Dunkel</option>
            </select>
          </SettingsSection>

          <SettingsSection
            title="Chat-Verhalten"
            description="Einstellungen für die normale Chat-Ansicht (nicht Tinder)."
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={settings.autoInsertFirstSuggestion}
                onChange={(e) => setAutoInsertFirstSuggestion(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-wa-border text-wa-green focus:ring-wa-green"
              />
              <span className="text-sm text-wa-text-primary">
                Automatisch ersten Chat-Vorschlag in die Nachrichteneingabe einfügen
              </span>
            </label>
            <p className="mt-1.5 text-xs text-wa-text-secondary">
              Wenn aktiviert, wird der erste Antwort- oder Follow-up-Vorschlag beim Öffnen eines Chats direkt in das Eingabefeld übernommen (Standard: aus).
            </p>
            <label className="mt-4 flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={settings.shiftEnterJumpsToNextChat}
                onChange={(e) => setShiftEnterJumpsToNextChat(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-wa-border text-wa-green focus:ring-wa-green"
              />
              <span className="text-sm text-wa-text-primary">
                Bei Shift+Enter direkt zum nächsten Chat springen
              </span>
            </label>
            <p className="mt-1.5 text-xs text-wa-text-secondary">
              Wenn aktiviert, springt Shift+Enter in der Nachrichteneingabe zum nächsten Chat (statt eine neue Zeile einzufügen). Enter sendet weiterhin die Nachricht.
            </p>
            <div className="mt-4">
              <label htmlFor="open-chat-with" className="block text-sm font-medium text-wa-text-primary">
                Beim Klick auf Chat-Namen öffnen
              </label>
              <select
                id="open-chat-with"
                value={settings.openChatWith}
                onChange={(e) => setOpenChatWith(e.target.value as "browser" | "client")}
                className="mt-2 rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
              >
                <option value="client">In Beeper Desktop (Focus-API)</option>
                <option value="browser">Im Browser (neuer Tab)</option>
              </select>
              <p className="mt-1.5 text-xs text-wa-text-secondary">
                &quot;Beeper Desktop&quot;: Fokussiert die Beeper-App und springt zum Chat (POST /v1/focus). &quot;Browser&quot;: Öffnet den Chat in einem neuen Tab. Bei Fehler (z. B. Beeper nicht erreichbar) wird bei Beeper Desktop auf Browser ausgewichen.
              </p>
            </div>
          </SettingsSection>
        </>
      )}

      {activeTab === "api" && <ApiKeysSettingsTab />}

      {activeTab === "tinder" && (
        <>
          <SettingsSection title="TinderChat" description="Tastatur-Layout und Nachrichten-Preload für die Tinder-Ansicht.">
            <div>
              <label htmlFor="tinder-keyboard-layout" className="block text-sm font-medium text-wa-text-primary">
                Tastenkürzel-Layout
              </label>
              <select
                id="tinder-keyboard-layout"
                value={settings.tinderKeyboardLayout}
                onChange={(e) => setTinderKeyboardLayout(e.target.value as "classic" | "touch")}
                className="mt-2 rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
              >
                <option value="classic">Classic (1–5, A, O, S/D/F/…)</option>
                <option value="touch">Touch (Q/W/E/R/T, A, O, J/K/L/Ö …)</option>
              </select>
              <p className="mt-1.5 text-xs text-wa-text-secondary">
                Beide Layouts sind für die deutsche Tastatur (QWERTZ) optimiert. Classic: Zahlentasten 1–5 für Vorschläge. Touch: 10‑Finger ohne Zahlen – Vorschläge Q/W/E/R/T, Reminder J/K/L/Ö + U/I/P/N (Ö-Taste = 4. Reminder).
              </p>
            </div>
            <div className="mt-4">
              <label htmlFor="tinder-preload-count" className="block text-sm font-medium text-wa-text-primary">
                Nachrichten-Preload
              </label>
              <input
                id="tinder-preload-count"
                type="number"
                min={10}
                max={50}
                step={5}
                value={settings.tinderMessagePreloadCount}
                onChange={(e) => setTinderMessagePreloadCount(parseInt(e.target.value, 10) || 50)}
                className="mt-2 w-28 rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-wa-text-secondary">
                Wie viele letzte Nachrichten beim Öffnen eines Chats vorgeladen werden (max. 50). Standard: 50. Ältere Nachrichten können im Chatverlauf per Paging nachgeladen werden.
              </p>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Reminder-Vorlagen"
            description="Voreinstellungen für „Reminder setzen“ in TinderChat und CRM. Stunden = ab jetzt in X Stunden. Tage = in X Tagen, optional mit fester Uhrzeit (HH:mm, 24h)."
          >
            {reminderPresetsLoading ? (
              <SettingsLoading label="Lade Vorlagen…" />
            ) : (
              <>
                <ul className="space-y-2">
                  {reminderPresets.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-wa-border bg-wa-panel-secondary/50 px-3 py-2 text-sm"
                    >
                      <span className="font-medium text-wa-text-primary">{p.label}</span>
                      <span className="text-wa-text-secondary">
                        {p.type === "hours" ? `${p.value} h` : `${p.value} Tage${p.time ? `, ${p.time}` : ""}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeReminderPreset(p.id)}
                        title="Vorlage entfernen"
                        className="ml-auto rounded px-2 py-0.5 text-xs text-wa-text-secondary hover:bg-wa-panel hover:text-red-400"
                      >
                        Entfernen
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-wa-border bg-wa-panel-secondary/30 p-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-wa-text-secondary">Bezeichnung</span>
                    <input
                      type="text"
                      value={newReminderLabel}
                      onChange={(e) => setNewReminderLabel(e.target.value)}
                      placeholder="z. B. In 1 h"
                      className="w-40 rounded border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-wa-text-secondary">Typ</span>
                    <select
                      value={newReminderType}
                      onChange={(e) => setNewReminderType(e.target.value as "hours" | "days")}
                      className="rounded border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                    >
                      <option value="hours">Stunden</option>
                      <option value="days">Tage</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-wa-text-secondary">{newReminderType === "hours" ? "Stunden" : "Tage"}</span>
                    <input
                      type="number"
                      min={0}
                      max={newReminderType === "hours" ? 720 : 365}
                      value={newReminderValue}
                      onChange={(e) => setNewReminderValue(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="w-20 rounded border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                    />
                  </label>
                  {newReminderType === "days" && (
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-wa-text-secondary">Uhrzeit (HH:mm)</span>
                      <input
                        type="text"
                        value={newReminderTime}
                        onChange={(e) => setNewReminderTime(e.target.value)}
                        placeholder="06:00"
                        className="w-20 rounded border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                      />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={addReminderPreset}
                    className="rounded-lg border border-wa-green bg-wa-green/10 px-3 py-1.5 text-sm font-medium text-wa-green hover:bg-wa-green/20"
                  >
                    Hinzufügen
                  </button>
                </div>
                {reminderPresetsError && <SettingsError message={reminderPresetsError} />}
                <SettingsSaveButton
                  onClick={saveReminderPresets}
                  disabled={reminderPresetsSaving}
                  saving={reminderPresetsSaving}
                  label="Reminder-Vorlagen speichern"
                />
              </>
            )}
          </SettingsSection>
        </>
      )}

      {activeTab === "crm" && (
        <SettingsSection
          title="CRM-Regeln"
          description="Automatische Aktionen im CRM: Follow-ups (Nachrichten von dir ohne Antwort) und Keyword-Stages aus der Analyse."
        >
          <div className="mb-4 rounded-lg border border-wa-border bg-wa-panel-secondary/60 px-3 py-2.5 text-xs text-wa-text-secondary">
            <p className="font-medium text-wa-text-primary">Lokale CRM-Datenbank</p>
            <p className="mt-1">
              Kontakte, KI-Analysen und Last-Activity werden in{" "}
              <code className="rounded bg-wa-input-bg px-1">data/beeper-crm.db</code> (SQLite) auf deinem System
              gespeichert und überleben Server-Neustarts. Im Browser bleibt zusätzlich eine Kopie der Kontakte in{" "}
              <code className="rounded bg-wa-input-bg px-1">localStorage</code>.
            </p>
          </div>
          {rulesLoading ? (
            <SettingsLoading label="Lade Regeln…" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor="max-fups-lost" className="text-sm text-wa-text-primary">
                  Ab
                </label>
                <input
                  id="max-fups-lost"
                  type="number"
                  min={0}
                  max={99}
                  value={maxFollowUpsBeforeLost}
                  onChange={(e) => setMaxFollowUpsBeforeLost(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  className="w-16 rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                />
                <span className="text-sm text-wa-text-primary">
                  Follow-ups ohne Antwort: Kontakt im CRM auf <strong>Lost</strong> setzen (z. B. 5 = ab dem 5. Follow-up)
                </span>
              </div>
              <p className="mt-1 text-[10px] text-wa-text-secondary">
                Wird ausgewertet, sobald die Chat-Liste geladen ist (erste 100 Chats). Nur Chats mit zugewiesenem CRM-Kontakt.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label htmlFor="analysis-concurrency" className="text-sm font-medium text-wa-text-primary">
                  Analyse parallel
                </label>
                <input
                  id="analysis-concurrency"
                  type="number"
                  min={1}
                  max={50}
                  value={analysisConcurrency}
                  onChange={(e) =>
                    setAnalysisConcurrency(
                      Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1))
                    )
                  }
                  className="w-16 rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                />
                <span className="text-sm text-wa-text-primary">
                  Gleichzeitig laufende Chat-Analysen (z. B. "Alle Chats analysieren", "Analyse für alle Kontakte"). 1-50, Standard 5.
                </span>
              </div>
              <div className="mt-4">
                <label htmlFor="auto-lead-keywords" className="text-sm font-medium text-wa-text-primary">
                  Auto Lead
                </label>
                <p className="mt-0.5 text-xs text-wa-text-secondary">
                  Enthält die Analyse eines dieser Keywords (kommagetrennt), wird der Kontakt auf <strong>Lead</strong> gesetzt – nur wenn er noch <strong>Unzugeordnet</strong> ist. Groß-/Kleinschreibung wird ignoriert.
                </p>
                <input
                  id="auto-lead-keywords"
                  type="text"
                  value={autoLeadKeywords}
                  onChange={(e) => setAutoLeadKeywords(e.target.value)}
                  placeholder="z. B. Interesse, Anfrage, Demo"
                  className="mt-1.5 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none"
                />
              </div>
              <div className="mt-4">
                <label htmlFor="auto-qualified-keywords" className="text-sm font-medium text-wa-text-primary">
                  Auto Qualified
                </label>
                <p className="mt-0.5 text-xs text-wa-text-secondary">
                  Enthält die Analyse eines dieser Keywords (kommagetrennt), wird der Kontakt auf <strong>Qualified</strong> gesetzt – nur wenn er noch <strong>Unzugeordnet</strong> ist. Hat Vorrang vor Auto Lead. Groß-/Kleinschreibung wird ignoriert.
                </p>
                <input
                  id="auto-qualified-keywords"
                  type="text"
                  value={autoQualifiedKeywords}
                  onChange={(e) => setAutoQualifiedKeywords(e.target.value)}
                  placeholder="z. B. Budget, Termin, Entscheider"
                  className="mt-1.5 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none"
                />
              </div>
              <div className="mt-4">
                <label htmlFor="auto-lead-message-keywords" className="text-sm font-medium text-wa-text-primary">
                  Auto Lead (Nachricht)
                </label>
                <p className="mt-0.5 text-xs text-wa-text-secondary">
                  Enthält eine <strong>deine gesendete Nachricht</strong> im Chat eines dieser Keywords (kommagetrennt), wird der Kontakt auf <strong>Lead</strong> gesetzt – nur wenn er noch <strong>Unzugeordnet</strong> ist. Z. B. für Cold DMs mit bestimmten Formulierungen. Groß-/Kleinschreibung wird ignoriert.
                </p>
                <input
                  id="auto-lead-message-keywords"
                  type="text"
                  value={autoLeadMessageKeywords}
                  onChange={(e) => setAutoLeadMessageKeywords(e.target.value)}
                  placeholder="z. B. Kooperation, Zusammenarbeit, Angebot"
                  className="mt-1.5 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none"
                />
              </div>
              {rulesError && <SettingsError message={rulesError} />}
              <SettingsSaveButton
                onClick={saveRules}
                disabled={rulesSaving}
                saving={rulesSaving}
                label="Regeln speichern"
              />
            </>
          )}
        </SettingsSection>
      )}

      {activeTab === "system" && (
        <SettingsSection
          title="Cache (TTL)"
          description="Gültigkeitsdauer der gecachten Daten. Einheit pro Zeile wählbar (Sekunden, Minuten, Stunden, Tage). Nach Ablauf wird beim nächsten Abruf neu geladen."
        >
          {cacheLoading ? (
            <SettingsLoading label="Lade Cache-Einstellungen…" />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["accounts", "chats", "chatDetail", "analysis", "transcript"] as const).map((key) => {
                  const label =
                    key === "chatDetail"
                      ? "Chat-Detail"
                      : key === "transcript"
                        ? "Transkript (Audio)"
                        : key === "accounts"
                          ? "Accounts"
                          : key === "chats"
                            ? "Chats"
                          : key === "analysis"
                            ? "Analyse (SQLite)"
                            : key;
                  const unit = cacheTTLUnit[key];
                  const displayVal = minutesToDisplay(cacheTTL[key], unit);
                  const displayRounded =
                    unit === "h" || unit === "d" ? Math.round(displayVal * 100) / 100 : displayVal;
                  const step = unit === "d" || unit === "h" ? 0.5 : 1;
                  return (
                    <div key={key} className="flex flex-wrap items-center gap-2">
                      <span className="w-28 shrink-0 text-sm text-wa-text-primary">{label}</span>
                      <input
                        type="number"
                        min={0}
                        max={displayMax(unit)}
                        step={step}
                        value={displayRounded}
                        onChange={(e) =>
                          setCacheTTL((prev) => ({
                            ...prev,
                            [key]: displayToMinutes(parseFloat(e.target.value) || 0, unit),
                          }))
                        }
                        className="w-20 rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-right text-sm focus:border-wa-green focus:outline-none"
                      />
                      <select
                        value={unit}
                        onChange={(e) =>
                          setCacheTTLUnit((prev) => ({
                            ...prev,
                            [key]: e.target.value as CacheTTLUnit,
                          }))
                        }
                        title="Einheit"
                        className="rounded border border-wa-border bg-wa-input-bg px-2 py-1 text-sm text-wa-text-primary focus:border-wa-green focus:outline-none"
                      >
                        <option value="s">Sek.</option>
                        <option value="m">Min.</option>
                        <option value="h">Std.</option>
                        <option value="d">Tage</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => clearCacheByType(key)}
                        disabled={cacheClearingType !== null}
                        title={`Cache „${label}“ leeren`}
                        className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-secondary hover:bg-wa-panel-secondary disabled:opacity-50"
                      >
                        {cacheClearingType === key ? "Leeren…" : "Leeren"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-wa-text-primary">CRM Last-Activity (SQLite)</span>
                <button
                  type="button"
                  onClick={() => clearCacheByType("crmLastActivity")}
                  disabled={cacheClearingType !== null}
                  title="Gecachte Follow-up-Zeiten im CRM leeren"
                  className="rounded border border-wa-border px-2 py-1 text-xs text-wa-text-secondary hover:bg-wa-panel-secondary disabled:opacity-50"
                >
                  {cacheClearingType === "crmLastActivity" ? "Leeren…" : "Leeren"}
                </button>
              </div>
              <p className="mt-2 text-xs text-wa-text-secondary">
                „Analyse (SQLite)“ leert RAM-Cache und alle gespeicherten Chat-Analysen in{" "}
                <code className="rounded bg-wa-input-bg px-1">beeper-crm.db</code>. Nachrichten werden absichtlich nicht
                gecacht (immer <code className="rounded bg-wa-input-bg px-1">no-store</code>), damit stets der aktuelle
                Stand geladen wird.
              </p>
              <p className="mt-1 text-xs text-wa-text-secondary">
                CRM-Kontakte liegen ebenfalls in derselben SQLite-Datei (nicht über diese Buttons löschbar).
              </p>
              {cacheError && <SettingsError message={cacheError} />}
              <SettingsSaveButton
                onClick={saveCacheSettings}
                disabled={cacheSaving}
                saving={cacheSaving}
                label="Cache-TTL speichern"
              />
            </>
          )}
        </SettingsSection>
      )}

      {activeTab === "todo" && (
        <>
          <SettingsSection
            title="KI-Extraktion"
            description="Prompt und Limits für die KI-Extraktion aus Chats. Vorschläge werden in SQLite (beeper-crm.db) gecacht und überleben Server-Neustarts. Bei Prompt-Änderung wird der Cache geleert."
          >
            {todoSettingsLoading ? (
              <SettingsLoading label="Lade Todo-Einstellungen…" />
            ) : (
              <>
                <label htmlFor="todo-prompt" className="block text-xs font-medium text-wa-text-primary">
                  Todo-Extraktions-Prompt (KI)
                </label>
                <textarea
                  id="todo-prompt"
                  value={todoListPrompt}
                  onChange={(e) => setTodoListPrompt(e.target.value)}
                  rows={8}
                  className="mt-2 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none font-mono"
                  spellCheck={false}
                />
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-wa-text-secondary">Max. Nachrichten (0–50)</span>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={todoListMessageLimit}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) setTodoListMessageLimit(Math.min(50, Math.max(0, v)));
                      }}
                      className="rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-wa-text-secondary">Standard-Frist (Tage)</span>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      value={todoListDefaultDeadlineDays}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) setTodoListDefaultDeadlineDays(Math.min(30, Math.max(1, v)));
                      }}
                      className="rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-wa-text-secondary">Standard-Dauer (Std.)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(todoListDefaultDurationHours).replace(".", ",")}
                      onChange={(e) => {
                        const raw = e.target.value.trim().replace(",", ".");
                        if (raw === "") return;
                        const v = Number(raw);
                        if (!Number.isNaN(v) && v > 0) {
                          setTodoListDefaultDurationHours(Math.min(24, Math.max(0.05, Number(v.toFixed(2)))));
                        }
                      }}
                      className="rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary"
                    />
                  </label>
                </div>
                {todoSettingsError && <SettingsError message={todoSettingsError} />}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={clearTodoSuggestionsCache}
                    disabled={suggestionsCacheClearing}
                    className="rounded-lg border border-wa-border bg-wa-panel-secondary px-3 py-1.5 text-xs font-medium text-wa-text-primary transition-colors hover:bg-wa-panel disabled:opacity-50"
                  >
                    {suggestionsCacheClearing ? "Leere Cache…" : "Vorschläge-Cache leeren"}
                  </button>
                  {suggestionsCacheMessage && (
                    <span className="text-xs text-wa-text-secondary">{suggestionsCacheMessage}</span>
                  )}
                </div>
                <SettingsSaveButton
                  onClick={saveTodoSettings}
                  disabled={todoSettingsSaving}
                  saving={todoSettingsSaving}
                  label="Todo-Einstellungen speichern"
                />
              </>
            )}
          </SettingsSection>

          <SettingsSection
            title="Synchronisation"
            description="Es kann genau ein Sync-Ziel aktiv sein – Google Tasks oder Reclaim, nicht beides."
          >
            {todoSettingsLoading ? (
              <SettingsLoading />
            ) : (
              <>
                <fieldset>
                  <legend className="text-sm font-medium text-wa-text-primary">Sync-Ziel</legend>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                        todoSyncTarget === "google"
                          ? "border-wa-green/50 bg-wa-green/10 ring-1 ring-wa-green/30"
                          : "border-wa-border bg-wa-panel-secondary/30 hover:bg-wa-panel-secondary/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="todo-sync-target"
                        value="google"
                        checked={todoSyncTarget === "google"}
                        onChange={() => setTodoSyncTarget("google")}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium text-wa-text-primary">Google Tasks</span>
                        <span className="mt-0.5 block text-xs text-wa-text-secondary">
                          OAuth in der Todo-Liste (G+), manuell ⬆︎G
                        </span>
                      </span>
                    </label>
                    <label
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                        todoSyncTarget === "reclaim"
                          ? "border-wa-green/50 bg-wa-green/10 ring-1 ring-wa-green/30"
                          : "border-wa-border bg-wa-panel-secondary/30 hover:bg-wa-panel-secondary/50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="todo-sync-target"
                        value="reclaim"
                        checked={todoSyncTarget === "reclaim"}
                        onChange={() => setTodoSyncTarget("reclaim")}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="block text-sm font-medium text-wa-text-primary">Reclaim</span>
                        <span className="mt-0.5 block text-xs text-wa-text-secondary">
                          API-Token hier, manuell ⬆︎R in der Todo-Liste
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>

                <label className="mt-4 flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    checked={autoSyncOnAccept}
                    onChange={(e) => setAutoSyncOnAccept(e.target.checked)}
                    className="mt-0.5 rounded border-wa-border"
                  />
                  <span className="text-sm text-wa-text-primary">
                    Nach Übernehmen eines Vorschlags automatisch synchronisieren
                  </span>
                </label>

                {todoSyncTarget === "google" ? (
                  <div className="mt-4 rounded-lg border border-wa-border bg-wa-panel-secondary/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-wa-text-primary">Google Tasks Verbindung</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          googleTasksConnected
                            ? "bg-green-500/15 text-green-600 dark:text-green-400"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {googleTasksConnected ? "Verbunden" : "Nicht verbunden"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-wa-text-secondary">
                      OAuth-Verbindung für Google Tasks. Client-ID und Secret unter Einstellungen → API-Schlüssel.
                    </p>
                    {!googleTasksConnected && (
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = "/api/google-tasks/connect";
                        }}
                        className="mt-3 rounded-lg bg-wa-green px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
                      >
                        Mit Google verbinden
                      </button>
                    )}
                    {autoSyncOnAccept && googleTasksConnected === false && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        Auto-Sync greift erst nach Verbindung in der Todo-Liste.
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-wa-border bg-wa-panel-secondary/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium text-wa-text-primary">Reclaim Verbindung</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          reclaimConnected
                            ? "bg-green-500/15 text-green-600 dark:text-green-400"
                            : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {reclaimConnected ? "Verbunden" : "Nicht verbunden"}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-wa-text-secondary">
                      API-Token unter Einstellungen → API-Schlüssel. Google-Tasks-Sync ist deaktiviert, solange Reclaim gewählt ist.
                    </p>
                    {reclaimConnected && (
                      <p className="mt-2 text-xs text-green-600 dark:text-green-400">
                        {reclaimEmail ? `Angemeldet als ${reclaimEmail}` : "Token gültig"}
                        {reclaimTokenHint ? ` · ${reclaimTokenHint}` : ""}
                      </p>
                    )}
                    {!reclaimConnected && (
                      <p className="mt-2 text-xs text-wa-text-secondary">
                        Noch kein gültiger Token — bitte unter API-Schlüssel hinterlegen.
                      </p>
                    )}
                    {autoSyncOnAccept && reclaimConnected === false && (
                      <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                        Auto-Sync greift erst nach gültigem API-Token.
                      </p>
                    )}
                  </div>
                )}

                <SettingsSaveButton
                  onClick={saveTodoSettings}
                  disabled={todoSettingsSaving}
                  saving={todoSettingsSaving}
                  label="Sync-Einstellungen speichern"
                />
              </>
            )}
          </SettingsSection>
        </>
      )}

      {activeTab === "ai" && (
        <SettingsSection
          title="Analyse-Prompt (KI)"
          description="System-Prompt für die Chat-Analyse. Gespeichert in data/prompts.json. Der Kontaktname wird bei der Analyse automatisch ergänzt."
        >
          {promptsLoading ? (
            <SettingsLoading label="Lade Prompt…" />
          ) : (
            <>
              <h3 className="mt-4 text-xs font-semibold text-wa-text-primary">Tinder-Ansicht</h3>
              <p className="mt-0.5 text-xs text-wa-text-secondary">
                Anzahl Antwortvorschläge und optionaler Zusatz-Prompt nur für die Tinder-Chat-Ansicht.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <label htmlFor="tinder-count" className="text-xs text-wa-text-secondary whitespace-nowrap">
                  Anzahl Antwortvorschläge (1–10)
                </label>
                <input
                  id="tinder-count"
                  type="number"
                  min={1}
                  max={10}
                  value={tinderSuggestionsCount}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v)) setTinderSuggestionsCount(Math.min(10, Math.max(1, v)));
                  }}
                  className="w-16 rounded-lg border border-wa-border bg-wa-input-bg px-2 py-1.5 text-sm text-wa-text-primary"
                />
              </div>
              <label htmlFor="tinder-prompt" className="mt-2 block text-xs text-wa-text-secondary">
                Tinder-Prompt (Zusatz)
              </label>
              <textarea
                id="tinder-prompt"
                value={tinderPromptSuffix}
                onChange={(e) => setTinderPromptSuffix(e.target.value)}
                placeholder="Optional: Zusätzliche Anweisungen nur für die Tinder-Analyse (wird an den System-Prompt angehängt). Leer = Standard (Schreibstil übernehmen, keine Namensansprache)."
                rows={3}
                className="mt-1 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none font-mono"
                spellCheck={false}
              />
              <label htmlFor="tinder-summary-prompt" className="mt-2 block text-xs text-wa-text-secondary">
                Chat-Zusammenfassung (KI) Prompt (nur Feld summary)
              </label>
              <textarea
                id="tinder-summary-prompt"
                value={tinderSummaryPromptSuffix}
                onChange={(e) => setTinderSummaryPromptSuffix(e.target.value)}
                placeholder="Optional: Zusätzliche Regeln nur für die Zusammenfassung (summary), z. B. Tonalität, Länge, Fokus."
                rows={3}
                className="mt-1 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none font-mono"
                spellCheck={false}
              />
              <h3 className="mt-4 text-xs font-semibold text-wa-text-primary">System-Prompt (alle Analysen)</h3>
              <label htmlFor="quick-reply-prompt" className="mt-2 block text-xs text-wa-text-secondary">
                Quick-Reply Prompt (nur nextMessageSuggestions)
              </label>
              <textarea
                id="quick-reply-prompt"
                value={quickReplyPromptSuffix}
                onChange={(e) => setQuickReplyPromptSuffix(e.target.value)}
                placeholder="Optional: Zusätzliche Regeln nur für nextMessageSuggestions (wird als Suffix ergänzt)."
                rows={3}
                className="mt-1 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none font-mono"
                spellCheck={false}
              />
              <textarea
                value={analysisSystemPrompt}
                onChange={(e) => setAnalysisSystemPrompt(e.target.value)}
                placeholder="System-Prompt für die Analyse…"
                rows={14}
                className="mt-3 w-full rounded-lg border border-wa-border bg-wa-input-bg px-3 py-2 text-sm text-wa-text-primary placeholder:text-wa-text-secondary focus:border-wa-green focus:outline-none font-mono"
                spellCheck={false}
              />
              <div className="mt-3 rounded-lg border border-wa-border bg-wa-panel-secondary/60 px-3 py-2.5 text-xs text-wa-text-secondary">
                <p className="font-medium text-wa-text-primary">Erforderliche JSON-Keys im Prompt</p>
                <p className="mt-1">
                  Die KI-Antwort muss ein JSON-Objekt mit genau diesen Keys liefern:{" "}
                  <code className="rounded bg-wa-input-bg px-1 font-mono">summary</code>,{" "}
                  <code className="rounded bg-wa-input-bg px-1 font-mono">branche</code>,{" "}
                  <code className="rounded bg-wa-input-bg px-1 font-mono">wunsch</code>,{" "}
                  <code className="rounded bg-wa-input-bg px-1 font-mono">pain</code>,{" "}
                  <code className="rounded bg-wa-input-bg px-1 font-mono">kaufkraft</code>,{" "}
                  <code className="rounded bg-wa-input-bg px-1 font-mono">stage</code>,{" "}
                  <code className="rounded bg-wa-input-bg px-1 font-mono">nextMessageSuggestions</code>.
                  Diese Begriffe müssen im Prompt oben vorkommen (z. B. in der Key-Liste), sonst ist die Ausgabe ungültig.
                </p>
                <p className="mt-2 font-medium text-wa-text-primary">Validierung</p>
                <p className="mt-0.5">
                  Speichern ist nur möglich, wenn der Prompt alle genannten Keys enthält. Fehlt mindestens einer, erscheint eine Fehlermeldung und der Prompt kann nicht gespeichert werden.
                </p>
              </div>
              {promptsError && <SettingsError message={promptsError} />}
              <SettingsSaveButton
                onClick={savePrompts}
                disabled={promptsSaving || !promptValidationOk}
                saving={promptsSaving}
                label="Prompt speichern"
              />
            </>
          )}
        </SettingsSection>
      )}
    </SettingsLayout>
  );
}
