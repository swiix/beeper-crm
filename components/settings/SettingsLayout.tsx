"use client";

import type { ReactNode } from "react";

export type SettingsTabDef = {
  id: string;
  label: string;
  hint: string;
};

type SettingsLayoutProps = {
  tabs: SettingsTabDef[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  children: ReactNode;
};

export function SettingsLayout({ tabs, activeTab, onTabChange, children }: SettingsLayoutProps) {
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-wa-chat-bg">
      <header className="shrink-0 border-b border-wa-border bg-wa-panel px-4 py-4 md:px-6">
        <h1 className="text-lg font-semibold text-wa-text-primary">Einstellungen</h1>
        <p className="mt-0.5 text-sm text-wa-text-secondary">
          {active?.hint ?? "Verhalten der App anpassen."}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          className="shrink-0 border-b border-wa-border bg-wa-panel/80 md:w-56 md:border-b-0 md:border-r"
          aria-label="Einstellungsbereiche"
        >
          <div className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-3">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onTabChange(tab.id)}
                  className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm transition-colors md:w-full ${
                    isActive
                      ? "bg-wa-green/15 font-medium text-wa-green ring-1 ring-wa-green/30"
                      : "text-wa-text-secondary hover:bg-wa-panel-secondary hover:text-wa-text-primary"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div
          role="tabpanel"
          className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6"
        >
          <div className="mx-auto max-w-3xl space-y-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
