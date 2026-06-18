"use client";

import Link from "next/link";
import {
  type ApiKeyRequirement,
  API_KEYS_SETTINGS_HREF,
  formatMissingApiKeysMessage,
  getMissingApiKeyRequirements,
} from "@/lib/api-keys-ui";
import { useApiKeysStatus } from "@/hooks/useApiKeysStatus";

type ApiKeysSetupBannerProps = {
  requirements: ApiKeyRequirement[];
  className?: string;
};

/** Warns when required API keys are missing; links to Settings → API-Schlüssel. */
export function ApiKeysSetupBanner({ requirements, className = "" }: ApiKeysSetupBannerProps) {
  const { status, loading } = useApiKeysStatus();

  if (loading || !status || requirements.length === 0) return null;

  const missing = getMissingApiKeyRequirements(status, requirements);
  if (missing.length === 0) return null;

  return (
    <div
      role="alert"
      className={`shrink-0 border-b border-amber-500/35 bg-amber-500/10 px-4 py-2.5 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-amber-900 dark:text-amber-100">
          <span className="font-medium">Konfiguration unvollständig:</span>{" "}
          {formatMissingApiKeysMessage(missing)}
        </p>
        <Link
          href={API_KEYS_SETTINGS_HREF}
          className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          API-Schlüssel einrichten
        </Link>
      </div>
    </div>
  );
}
