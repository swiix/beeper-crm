/**
 * Resolve Beeper asset URLs for use in the browser.
 * mxc:// and file:// must be loaded via our API proxy (Beeper serve endpoint).
 */

export function getAssetUrl(rawUrl: string | null | undefined): string | undefined {
  if (!rawUrl || typeof rawUrl !== "string") return undefined;
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("mxc://") || trimmed.startsWith("file://") || trimmed.startsWith("localmxc://")) {
    return `/api/assets/serve?url=${encodeURIComponent(trimmed)}`;
  }
  return trimmed;
}
