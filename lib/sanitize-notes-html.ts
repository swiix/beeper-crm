const HTTP_URL_RE = /(https?:\/\/[^\s<>"']+)/gi;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function linkifyEscaped(text: string): string {
  return text.replace(HTTP_URL_RE, (url) => {
    const safeHref = escapeHtml(url);
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeHref}</a>`;
  });
}

function formatPlainSegment(text: string): string {
  const stripped = text.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  const escaped = escapeHtml(stripped);
  const withBreaks = escaped.replace(/\n/g, "<br />");
  return linkifyEscaped(withBreaks);
}

function formatAnchor(attrs: string, inner: string): string {
  const hrefMatch = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
  const href = hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "";
  if (!/^https?:\/\//i.test(href)) {
    return formatPlainSegment(inner);
  }
  const safeHref = escapeHtml(href);
  const label = inner.replace(/<[^>]+>/g, "").trim() || href;
  const safeLabel = escapeHtml(label);
  return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
}

function stripDangerousBlocks(text: string): string {
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
}

/** Sanitize todo/suggestion notes for safe HTML rendering (links + line breaks only). */
export function sanitizeNotesHtml(raw: string): string {
  const trimmed = stripDangerousBlocks(raw).trim();
  if (!trimmed) return "";

  const anchorRe = /<a\s+([^>]*?)>([\s\S]*?)<\/a>/gi;
  const parts: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = anchorRe.exec(trimmed)) !== null) {
    if (match.index > lastIndex) {
      parts.push(formatPlainSegment(trimmed.slice(lastIndex, match.index)));
    }
    parts.push(formatAnchor(match[1], match[2]));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < trimmed.length) {
    parts.push(formatPlainSegment(trimmed.slice(lastIndex)));
  }

  if (parts.length === 0) {
    return formatPlainSegment(trimmed);
  }

  return parts.join("");
}
