"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BeeperMessage, BeeperMessageAttachment } from "@/lib/types";
import { getAssetUrl } from "@/lib/asset-url";

/** Matches http(s) URLs; trailing punctuation (.,;:!?) ) is not included in the match. */
const URL_REGEX = /https?:\/\/[^\s<>"']+(?=[\s.,;:!?)]|$)/g;

/** Split text into segments and return React nodes: plain text and clickable links. */
function linkifyText(text: string): React.ReactNode[] {
  if (!text) return [];
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((m = URL_REGEX.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(text.slice(lastIndex, m.index));
    }
    const url = m[0];
    parts.push(
      <a
        key={m.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-wa-green underline hover:opacity-90"
      >
        {url}
      </a>
    );
    lastIndex = m.index + url.length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : [text];
}

interface MessageListProps {
  messages: BeeperMessage[];
  loading: boolean;
  onLoadMore: () => void;
  hasMore: boolean;
}

function formatMessageTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function isImageAttachment(a: BeeperMessageAttachment): boolean {
  const t = (a.type ?? "").toLowerCase();
  return t === "img" || t === "image" || !!a.isSticker || !!a.isGif;
}

function isVideoAttachment(a: BeeperMessageAttachment): boolean {
  return (a.type ?? "").toLowerCase() === "video";
}

function isAudioAttachment(a: BeeperMessageAttachment): boolean {
  return (a.type ?? "").toLowerCase() === "audio";
}

function attachmentMediaUrl(a: BeeperMessageAttachment): string | undefined {
  return getAssetUrl(a.srcURL ?? a.id);
}

/** Raw Beeper URL for API calls (e.g. transcribe); not the proxy play URL. */
function attachmentRawUrl(a: BeeperMessageAttachment): string | undefined {
  const raw = a.srcURL ?? a.id;
  return raw && typeof raw === "string" ? raw : undefined;
}

function AudioWithTranscript({ att, fallbackKey }: { att: BeeperMessageAttachment; fallbackKey: string }) {
  const playSrc = attachmentMediaUrl(att);
  const rawUrl = attachmentRawUrl(att);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!rawUrl);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!rawUrl) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/transcribe?url=${encodeURIComponent(rawUrl)}`);
        if (cancelled) return;
        if (!res.ok) {
          setError(true);
          setLoading(false);
          return;
        }
        const data = await res.json();
        setTranscript(typeof data?.text === "string" ? data.text : "");
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawUrl]);

  if (!playSrc) {
    return (
      <p className="text-sm text-wa-text-secondary">
        [Audio: {att.fileName ?? "—"}]
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <audio controls preload="metadata" className="max-w-full min-w-[200px] h-9">
          <source src={playSrc} type={att.mimeType ?? "audio/mpeg"} />
        </audio>
        {(att.isVoiceNote || att.duration != null) && (
          <span className="text-[10px] text-wa-text-secondary shrink-0">
            {att.isVoiceNote ? "Sprachnachricht" : null}
            {att.isVoiceNote && att.duration != null ? " · " : null}
            {att.duration != null
              ? `${Math.floor(att.duration / 60)}:${(att.duration % 60).toString().padStart(2, "0")}`
              : null}
          </span>
        )}
      </div>
      {rawUrl && (
        <div className="text-xs text-wa-text-secondary/90 border-l-2 border-wa-green/30 pl-2">
          {loading && "Wird transkribiert…"}
          {error && !loading && "Transkript nicht verfügbar"}
          {!loading && !error && transcript !== null && transcript !== "" && transcript}
        </div>
      )}
    </div>
  );
}

function MessageBubbleContent({
  msg,
  isOut,
}: {
  msg: BeeperMessage;
  isOut: boolean;
}) {
  const text = msg.text ?? "";
  const type = (msg.type ?? "TEXT").toUpperCase();
  const attachments = msg.attachments ?? [];

  const imageAttachments = attachments.filter(isImageAttachment);
  const videoAttachments = attachments.filter(isVideoAttachment);
  const audioAttachments = attachments.filter(isAudioAttachment);
  const fileAttachments = attachments.filter((a) => {
    const t = (a.type ?? "").toLowerCase();
    return t !== "img" && t !== "image" && t !== "video" && t !== "audio";
  });

  const hasImages = imageAttachments.length > 0 || (type === "IMAGE" && attachments.length > 0);
  const imagesToShow = hasImages
    ? imageAttachments.length > 0
      ? imageAttachments
      : type === "IMAGE"
        ? attachments.slice(0, 1)
        : []
    : [];

  const isNotice = type === "NOTICE";
  const isLocation = type === "LOCATION";

  return (
    <>
      {!isOut && (
        <p className="mb-0.5 text-xs font-medium text-wa-green">
          {msg.senderName ?? "Unbekannt"}
        </p>
      )}

      {/* Text (TEXT or caption) */}
      {(text || (type === "TEXT" && !imagesToShow.length && !videoAttachments.length && !audioAttachments.length && !fileAttachments.length)) && !isNotice && (
        <p className="whitespace-pre-wrap break-words text-sm">
          {linkifyText(text || "—")}
        </p>
      )}

      {/* Images / stickers */}
      {imagesToShow.map((att) => {
        const src = attachmentMediaUrl(att);
        if (!src) {
          return (
            <p key={att.id ?? att.fileName ?? "img"} className="text-sm text-wa-text-secondary">
              [Bild: {att.fileName ?? "—"}]
            </p>
          );
        }
        const isSticker = att.isSticker ?? type === "STICKER";
        return (
          <a
            key={att.id ?? att.fileName ?? "img"}
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-md"
          >
            <img
              src={src}
              alt={att.fileName ?? "Image"}
              className={
                isSticker
                  ? "max-h-32 max-w-full object-contain"
                  : "max-h-64 max-w-full object-contain"
              }
            />
          </a>
        );
      })}

      {/* Video (incl. Reels) */}
      {videoAttachments.length > 0 &&
        videoAttachments.map((att) => {
          const src = attachmentMediaUrl(att);
          const posterSrc = att.posterImg ? getAssetUrl(att.posterImg) : undefined;
          if (!src) {
            return (
              <p key={att.id ?? att.fileName ?? "vid"} className="text-sm text-wa-text-secondary">
                [Video: {att.fileName ?? "—"}]
              </p>
            );
          }
          return (
            <div key={att.id ?? att.fileName ?? "vid"} className="overflow-hidden rounded-md">
              <video
                controls
                preload="metadata"
                poster={posterSrc}
                className="max-h-64 max-w-full"
                title={att.fileName ?? "Video"}
              >
                <source src={src} type={att.mimeType ?? "video/mp4"} />
                <a href={src} target="_blank" rel="noopener noreferrer" className="text-wa-green underline">
                  Video abspielen
                </a>
              </video>
              {att.duration != null && (
                <span className="text-[10px] text-wa-text-secondary">
                  {Math.floor(att.duration / 60)}:{(att.duration % 60).toString().padStart(2, "0")}
                </span>
              )}
            </div>
          );
        })}

      {/* Audio / voice notes (playable) + transcript */}
      {audioAttachments.length > 0 &&
        audioAttachments.map((att) => (
          <AudioWithTranscript
            key={att.id ?? att.fileName ?? "aud"}
            att={att}
            fallbackKey={att.id ?? att.fileName ?? "aud"}
          />
        ))}

      {/* Message type VIDEO but attachment not classified as video (fallback: first attachment as video) */}
      {type === "VIDEO" && videoAttachments.length === 0 && attachments.length > 0 &&
        (() => {
          const att = attachments[0];
          const src = attachmentMediaUrl(att);
          if (!src) return null;
          const posterSrc = att.posterImg ? getAssetUrl(att.posterImg) : undefined;
          return (
            <div key={att.id ?? att.fileName ?? "vid"} className="overflow-hidden rounded-md">
              <video
                controls
                preload="metadata"
                poster={posterSrc}
                className="max-h-64 max-w-full"
                title={att.fileName ?? "Video"}
              >
                <source src={src} type={att.mimeType ?? "video/mp4"} />
                <a href={src} target="_blank" rel="noopener noreferrer" className="text-wa-green underline">
                  Video abspielen
                </a>
              </video>
            </div>
          );
        })()}

      {/* Message type VOICE/AUDIO but attachment not classified (fallback) */}
      {(type === "VOICE" || type === "AUDIO") && audioAttachments.length === 0 && attachments.length > 0 && (
        <AudioWithTranscript
          key={(attachments[0].id ?? attachments[0].fileName ?? "aud") + "-fallback"}
          att={attachments[0]}
          fallbackKey={attachments[0].id ?? attachments[0].fileName ?? "aud"}
        />
      )}

      {/* File / other attachments */}
      {fileAttachments.map((att) => {
        const src = attachmentMediaUrl(att);
        const label = att.fileName ?? att.type ?? "Anhang";
        if (!src) {
          return (
            <p key={att.id ?? att.fileName ?? "file"} className="text-sm text-wa-text-secondary">
              [Datei: {label}]
            </p>
          );
        }
        return (
          <a
            key={att.id ?? att.fileName ?? "file"}
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            download={att.fileName}
            className="text-sm text-wa-green underline break-all"
          >
            📎 {label}
          </a>
        );
      })}

      {/* Location */}
      {isLocation && (
        <p className="text-sm text-wa-text-secondary">
          {linkifyText(text || "[Standort]")}
        </p>
      )}

      {/* Fallback: has attachments but none matched above */}
      {attachments.length > 0 &&
        imagesToShow.length === 0 &&
        videoAttachments.length === 0 &&
        audioAttachments.length === 0 &&
        fileAttachments.length === 0 &&
        type !== "VIDEO" &&
        type !== "VOICE" &&
        type !== "AUDIO" && (
          <p className="text-sm text-wa-text-secondary">
            [Anhang: {attachments.map((a) => a.fileName || a.type || "?").join(", ")}]
          </p>
        )}

      <p className="mt-0.5 text-right text-[10px] opacity-70">
        {formatMessageTime(msg.timestamp)}
      </p>
    </>
  );
}

const SCROLL_LOAD_THRESHOLD = 120;

export function MessageList({
  messages,
  loading,
  onLoadMore,
  hasMore,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  /** Prevents duplicate onLoadMore before parent sets loading (IntersectionObserver can fire twice). */
  const loadMoreLockRef = useRef(false);
  const prevLoadingRef = useRef(loading);
  const prevFirstIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (prevLoadingRef.current && !loading) {
      loadMoreLockRef.current = false;
    }
    prevLoadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    if (!hasMore) loadMoreLockRef.current = false;
  }, [hasMore]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loading || loadMoreLockRef.current) return;
        loadMoreLockRef.current = true;
        onLoadMore();
      },
      { root, rootMargin: "100px 0px 0px 0px", threshold: 0 }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, loading, onLoadMore, messages.length]);

  useEffect(() => {
    if (messages.length === 0) return;
    const firstId = messages[0]?.id ?? null;
    const shouldScrollToBottom =
      prevFirstIdRef.current === null || prevFirstIdRef.current === firstId;
    prevFirstIdRef.current = firstId;
    if (!scrollRef.current || !shouldScrollToBottom) return;
    const scrollToBottom = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };
    const raf = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(raf);
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMore || loading) return;
    if (el.scrollTop <= SCROLL_LOAD_THRESHOLD) {
      onLoadMore();
    }
  }, [hasMore, loading, onLoadMore]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-thin px-4 py-2 pb-6"
    >
      <div className="flex flex-col gap-0.5 pb-8">
        {hasMore && (
          <div
            ref={loadMoreSentinelRef}
            className="flex flex-col items-center gap-2 py-3"
            aria-hidden
          >
            {loading && (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-wa-green border-t-transparent" />
            )}
            <button
              type="button"
              onClick={onLoadMore}
              disabled={loading}
              title="Ältere Nachrichten in diesem Chat laden"
              className="rounded bg-wa-input-bg px-4 py-2 text-sm font-medium text-wa-text-secondary hover:bg-wa-border disabled:opacity-50"
            >
              {loading ? "Laden…" : "Ältere Nachrichten laden"}
            </button>
          </div>
        )}
        {messages.map((msg) => {
          const type = (msg.type ?? "TEXT").toUpperCase();
          const isNotice = type === "NOTICE";
          const isOut = msg.isSender;

          if (isNotice) {
            return (
              <div key={msg.id} className="flex justify-center py-1">
                <p className="text-center text-xs text-wa-text-secondary">
                  {linkifyText(msg.text ?? "—")}
                  <span className="ml-1.5 text-[10px] opacity-70">
                    {formatMessageTime(msg.timestamp)}
                  </span>
                </p>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex justify-end ${!isOut ? "flex-row-reverse" : ""}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-1.5 shadow ${
                  isOut
                    ? "bg-wa-bubble-out text-wa-text-primary"
                    : "bg-wa-bubble-in text-wa-text-primary"
                }`}
              >
                <MessageBubbleContent msg={msg} isOut={isOut === true} />
              </div>
            </div>
          );
        })}
        {loading && messages.length === 0 && (
          <div className="flex justify-center py-8">
            <span className="h-8 w-8 animate-spin rounded-full border-2 border-wa-green border-t-transparent" />
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="py-8 text-center text-sm text-wa-text-secondary">
            Noch keine Nachrichten in diesem Chat.
          </div>
        )}
      </div>
    </div>
  );
}
