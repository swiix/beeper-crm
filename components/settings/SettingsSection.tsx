import type { ReactNode } from "react";

type SettingsSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

export function SettingsSection({ title, description, children, className = "" }: SettingsSectionProps) {
  return (
    <section
      className={`rounded-xl border border-wa-border bg-wa-panel p-5 shadow-sm ${className}`.trim()}
    >
      <div className="border-b border-wa-border/60 pb-3">
        <h2 className="text-sm font-semibold text-wa-text-primary">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-wa-text-secondary">{description}</p>
        ) : null}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

type SettingsSaveButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  saving?: boolean;
  label: string;
  savingLabel?: string;
};

export function SettingsSaveButton({
  onClick,
  disabled,
  saving,
  label,
  savingLabel = "Speichern…",
}: SettingsSaveButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      className="mt-4 rounded-lg bg-wa-green px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {saving ? savingLabel : label}
    </button>
  );
}

export function SettingsLoading({ label = "Lade…" }: { label?: string }) {
  return <p className="text-sm text-wa-text-secondary">{label}</p>;
}

export function SettingsError({ message }: { message: string }) {
  return <p className="mt-2 text-sm text-red-400">{message}</p>;
}
