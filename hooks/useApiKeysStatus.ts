"use client";

import useSWR from "swr";
import type { ApiKeysStatusResponse } from "@/lib/api-keys-ui";

async function fetchApiKeysStatus(): Promise<ApiKeysStatusResponse> {
  const res = await fetch("/api/settings/api-keys");
  const data = (await res.json()) as ApiKeysStatusResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "API-Schlüssel-Status konnte nicht geladen werden");
  return data;
}

export function useApiKeysStatus() {
  const { data, error, isLoading, mutate } = useSWR<ApiKeysStatusResponse>(
    "api-keys-status",
    fetchApiKeysStatus,
    { revalidateOnFocus: true, dedupingInterval: 30_000 }
  );

  return {
    status: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : error ? String(error) : null,
    refresh: mutate,
  };
}
