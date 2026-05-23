"use client";

/**
 * Full-screen photo and video slideshow with auto-play, multiple transitions,
 * and fullscreen support.
 *
 * ## Features
 * - Six transition effects: Fade, Slide, Zoom, Flip, Ken Burns, Random.
 * - Three playback speeds: Slow (8 s), Normal (5 s), Fast (3 s).
 * - Keyboard shortcuts: ← / →  navigate, Space  play/pause,
 *   F  fullscreen, T  cycle transition, Escape  close.
 * - Pre-loads images within a ±2 radius of the current index.
 * - Auto-requests the next feed page when within 2 items of the end.
 * - Videos play natively with browser controls; transitions are skipped.
 *
 * ## Behaviour
 * The component is invisible (`index < 0`) until `openPhoto` is set by the
 * parent. Body scroll is locked while the slideshow is open.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Photo } from "../../types/photo";
import { downloadPhoto } from "@/lib/download";

// ── HLS video player ──────────────────────────────────────────────────────────

/**
 * Video player that prefers HLS for adaptive-bitrate streaming (instant start)
 * when `hlsUrl` is present, falling back to the presigned `src` URL.
 *
 * - On browsers that support HLS natively (Safari): use a plain `<video src>`
 *   with the HLS manifest URL — no JS library needed.
 * - On Chrome/Firefox: dynamically load `hls.js` and attach it to the element.
 * - Without `hlsUrl`: render a regular `<video src={src}>` (legacy MP4 path).
 *
 * `hls.js` is imported dynamically so it doesn't bloat the initial bundle.
 */
function VideoPlayer({ src, hlsUrl, photoKey }: { src: string; hlsUrl?: string; photoKey: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !hlsUrl) return;

    // Safari has native HLS support — just set the src directly.
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = hlsUrl;
      return;
    }

    // Chrome / Firefox: use hls.js
    let hlsInstance: any = null;
    import("hls.js").then(({ default: Hls }) => {
      if (!videoRef.current) return; // component unmounted
      if (Hls.isSupported()) {
        hlsInstance = new Hls({ startLevel: -1 }); // auto quality selection
        hlsInstance.loadSource(hlsUrl);
        hlsInstance.attachMedia(videoRef.current);
      } else {
        // hls.js not supported and no native HLS — fall back to MP4 src
        if (videoRef.current) videoRef.current.src = src;
      }
    });

    return () => {
      hlsInstance?.destroy();
    };
  // Re-run whenever the video URL changes (navigating between slides).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hlsUrl, src, photoKey]);

  return (
    <video
      ref={videoRef}
      // When hlsUrl is present, src is set imperatively via the effect above.
      // For legacy MP4 (no hlsUrl), set it declaratively so React manages it.
      src={hlsUrl ? undefined : src}
      controls
      autoPlay
      playsInline
      crossOrigin="anonymous"
      className="max-h-full max-w-full object-contain"
    />
  );
}

type Props = {
  photos: Photo[];
  openPhoto: Photo | null;
  onClose: () => void;
  loadMore?: () => void;
  hasMore?: boolean;
};

/** Returns `true` if the photo item should be rendered as a `<video>` element. */
function isVideo(photo: Photo) {
  if (photo.mediaType) return photo.mediaType === "video";
  return (photo.mimeType ?? "").startsWith("video/");
}

const PRELOAD_RADIUS = 2;

const SPEED_OPTIONS = [
  { label: "Slow",   ms: 8000 },
  { label: "Normal", ms: 5000 },
  { label: "Fast",   ms: 3000 },
] as const;
type Speed = (typeof SPEED_OPTIONS)[number]["label"];

// ── Transitions ──────────────────────────────────────────────────────────────
type Transition = "Fade" | "Slide" | "Zoom" | "Flip" | "Ken Burns" | "Random";
const TRANSITION_OPTIONS: Transition[] = ["Fade", "Slide", "Zoom", "Flip", "Ken Burns", "Random"];
const REAL_TRANSITIONS: Transition[]   = ["Fade", "Slide", "Zoom", "Flip", "Ken Burns"];

/**
 * Picks a random concrete transition, optionally excluding the last-used one
 * to avoid repeating the same effect back-to-back.
 */
function pickRandom(exclude?: Transition): Transition {
  const pool = REAL_TRANSITIONS.filter((t) => t !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

const KEYFRAMES = `
@keyframes sb-fade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes sb-slide-r {
  from { opacity: 0; transform: translateX(7%); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes sb-slide-l {
  from { opacity: 0; transform: translateX(-7%); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes sb-zoom {
  from { opacity: 0; transform: scale(1.1); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes sb-flip-r {
  from { opacity: 0; transform: perspective(900px) rotateY(-18deg) scale(0.96); }
  to   { opacity: 1; transform: perspective(900px) rotateY(0deg)  scale(1); }
}
@keyframes sb-flip-l {
  from { opacity: 0; transform: perspective(900px) rotateY(18deg)  scale(0.96); }
  to   { opacity: 1; transform: perspective(900px) rotateY(0deg)   scale(1); }
}
@keyframes sb-kenburns-a {
  from { transform: scale(1.13) translate(-1.5%,  1%); }
  to   { transform: scale(1)    translate( 0%,    0%); }
}
@keyframes sb-kenburns-b {
  from { transform: scale(1.13) translate( 1.5%, -1%); }
  to   { transform: scale(1)    translate( 0%,    0%); }
}
`;

/**
 * Returns the inline `style` object (animation CSS) for the current media
 * element based on the active transition, navigation direction, and slide index.
 * The `idx` parity is used to alternate Ken Burns pan directions.
 */
function mediaStyle(t: Transition, dir: 1 | -1, idx: number): React.CSSProperties {
  const fast = "0.45s ease-out forwards";
  switch (t) {
    case "Fade":      return { animation: `sb-fade ${fast}` };
    case "Slide":     return { animation: `${dir === 1 ? "sb-slide-r" : "sb-slide-l"} ${fast}` };
    case "Zoom":      return { animation: `sb-zoom ${fast}` };
    case "Flip":      return { animation: `${dir === 1 ? "sb-flip-r" : "sb-flip-l"} 0.5s ease-out forwards` };
    case "Ken Burns": return {
      animation: `${idx % 2 === 0 ? "sb-kenburns-a" : "sb-kenburns-b"} 10s ease-out forwards, sb-fade 0.6s ease-out forwards`,
      transformOrigin: "center center",
    };
    default: return { animation: `sb-fade 0.45s ease-out forwards` };
  }
}

// Transition icon (two overlapping rectangles with an arrow)
function TransitionIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <rect x="2"  y="5"  width="10" height="14" rx="1.5" strokeOpacity="0.5" />
      <rect x="12" y="5"  width="10" height="14" rx="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 12h10m-3-3 3 3-3 3" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Renders the full-screen slideshow overlay. Hidden (returns `null`) when
 * `openPhoto` is `null` or no matching index can be found in `photos`.
 */
export default function PhotoSlideshow({ photos, openPhoto, onClose, loadMore, hasMore }: Props) {
  const [index, setIndex]         = useState(-1);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [playing, setPlaying]     = useState(false);
  const [speed, setSpeed]         = useState<Speed>("Normal");
  const [transition, setTransition]       = useState<Transition>("Fade");
  const [activeTransition, setActiveTransition] = useState<Transition>("Fade");
  const [isFullscreen, setIsFullscreen]   = useState(false);
  const lastRandomRef = useRef<Transition | undefined>(undefined);

  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalMs   = SPEED_OPTIONS.find((s) => s.label === speed)!.ms;

  // Inject keyframes once
  useEffect(() => {
    const id = "sb-keyframes";
    if (!document.getElementById(id)) {
      const el = document.createElement("style");
      el.id = id;
      el.textContent = KEYFRAMES;
      document.head.appendChild(el);
    }
  }, []);

  // Derive initial index from openPhoto only when openPhoto changes —
  // not when new pages are appended (which would reset current position).
  const prevOpenPhotoRef = useRef<Photo | null>(null);
  useEffect(() => {
    if (openPhoto === prevOpenPhotoRef.current) return;
    prevOpenPhotoRef.current = openPhoto;
    if (!openPhoto) {
      setIndex(-1);
      setPlaying(false);
      return;
    }
    const i = photos.findIndex((p) => p.key === openPhoto.key);
    setIndex(i >= 0 ? i : 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPhoto]);

  // Resolve which transition to actually play — randomise on each photo change
  useEffect(() => {
    if (transition === "Random") {
      const pick = pickRandom(lastRandomRef.current);
      lastRandomRef.current = pick;
      setActiveTransition(pick);
    } else {
      setActiveTransition(transition);
    }
  }, [index, transition]);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(
    () => setIndex((i) => (i < photos.length - 1 ? i + 1 : i)),
    [photos.length]
  );

  // Auto-advance
  useEffect(() => {
    if (!playing || index < 0) return;
    timerRef.current = setTimeout(() => {
      if (index < photos.length - 1) {
        setDirection(1);
        setIndex((i) => i + 1);
      } else if (!hasMore) {
        setPlaying(false);
      }
      // else: next page loading — wait; re-runs when photos.length grows
    }, intervalMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, index, photos.length, intervalMs, hasMore]);

  // Keyboard nav
  useEffect(() => {
    if (index < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft")       { setPlaying(false); setDirection(-1); prev(); }
      else if (e.key === "ArrowRight") { setPlaying(false); setDirection(1);  next(); }
      else if (e.key === "Escape") {
        if (document.fullscreenElement) document.exitFullscreen();
        else onClose();
      }
      else if (e.key === " ") { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === "f") { toggleFullscreen(); }
      else if (e.key === "t") {
        setTransition((cur) => {
          const i = TRANSITION_OPTIONS.indexOf(cur);
          return TRANSITION_OPTIONS[(i + 1) % TRANSITION_OPTIONS.length];
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, prev, next, onClose]);

  // Load next page when approaching the end
  useEffect(() => {
    if (!hasMore || !loadMore) return;
    if (index >= photos.length - PRELOAD_RADIUS - 1) loadMore();
  }, [index, photos.length, hasMore, loadMore]);

  // Lock body scroll
  useEffect(() => {
    if (index < 0) return;
    const saved = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = saved; };
  }, [index]);

  // Sync fullscreen state
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Exit fullscreen when slideshow closes
  useEffect(() => {
    if (index < 0 && document.fullscreenElement) document.exitFullscreen();
  }, [index]);

  /** Toggles the browser's native fullscreen mode on the slideshow container. */
  function toggleFullscreen() {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  }

  /** Advances the selected transition to the next option in `TRANSITION_OPTIONS`. */
  function cycleTransition() {
    setTransition((cur) => {
      const i = TRANSITION_OPTIONS.indexOf(cur);
      return TRANSITION_OPTIONS[(i + 1) % TRANSITION_OPTIONS.length];
    });
  }

  if (index < 0 || !openPhoto) return null;

  const photo   = photos[index] ?? openPhoto;
  const video   = isVideo(photo);
  const total   = photos.length;
  const hasPrev = index > 0;
  const hasNext = index < total - 1;

  const dateLabel = photo.takenAt
    ? new Date(photo.takenAt).toLocaleDateString(undefined, {
        year: "numeric", month: "long", day: "numeric",
      })
    : null;

  const preloadUrls: string[] = [];
  for (let offset = -PRELOAD_RADIUS; offset <= PRELOAD_RADIUS; offset++) {
    if (offset === 0) continue;
    const n = photos[index + offset];
    if (n && !isVideo(n) && n.url) preloadUrls.push(n.url);
  }

  function handlePrev() { setPlaying(false); setDirection(-1); prev(); }
  function handleNext() { setPlaying(false); setDirection(1);  next(); }

  const animStyle = video ? {} : mediaStyle(activeTransition, direction, index);

  return (
    <div ref={containerRef} className="fixed inset-0 z-50 flex flex-col bg-black">

      {/* Hidden preloads */}
      <div className="hidden" aria-hidden="true">
        {preloadUrls.map((url) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={url} src={url} alt="" />
        ))}
      </div>

      {/* ── Top bar ── */}
      <div className="absolute top-0 inset-x-0 z-10 pointer-events-none flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/70 to-transparent">

        {/* Left: counter + transition picker */}
        <div className="flex items-center gap-3 pointer-events-auto">
          <span className="text-sm text-white/60 tabular-nums">
            {index + 1} / {total}
          </span>

          {/* Transition cycling button */}
          <button
            onClick={cycleTransition}
            title="Change transition (T)"
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-white/60 hover:text-white bg-white/10 hover:bg-white/20 transition"
          >
            <TransitionIcon />
            {transition === "Random"
              ? <><span className="text-white/40">Random</span> · {activeTransition}</>
              : transition}
          </button>
        </div>

        {/* Right: speed, play, fullscreen, close */}
        <div className="flex items-center gap-2 pointer-events-auto">

          {/* Speed picker — only when playing */}
          {playing && (
            <div className="flex items-center gap-1 rounded-full bg-white/10 px-1 py-1">
              {SPEED_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => setSpeed(opt.label)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition ${
                    speed === opt.label
                      ? "bg-white text-black"
                      : "text-white/60 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {/* Play / Pause */}
          <button
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause slideshow" : "Play slideshow"}
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/20 transition"
          >
            {playing ? (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Play
              </>
            )}
          </button>

          {/* Download original */}
          <button
            onClick={() => downloadPhoto(photo).catch(console.error)}
            aria-label={photo.archiveKey ? "Download original (HEIC)" : "Download"}
            title={photo.archiveKey ? "Download original (HEIC)" : "Download"}
            className="rounded-full p-2 text-white/70 hover:text-white hover:bg-white/10 transition"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v13m0 0-4-4m4 4 4-4M3 20h18" />
            </svg>
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className="rounded-full p-2 text-white/70 hover:text-white hover:bg-white/10 transition"
          >
            {isFullscreen ? (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0v4m0-4h4M15 9l5-5m0 0v4m0-4h-4M9 15l-5 5m0 0v-4m0 4h4M15 15l5 5m0 0v-4m0 4h-4" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5M20 8V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5M20 16v4m0 0h-4m4 0l-5-5" />
              </svg>
            )}
          </button>

          {/* Close */}
          <button
            onClick={onClose}
            aria-label="Close slideshow"
            className="rounded-full p-2 text-white/70 hover:text-white hover:bg-white/10 transition"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Media area ── */}
      <div className="relative flex-1 flex items-center justify-center min-h-0 overflow-hidden">
        {video ? (
          <VideoPlayer
            key={photo.key}
            photoKey={photo.key}
            src={photo.url}
            hlsUrl={photo.hlsUrl}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={photo.key}
            src={photo.url}
            alt={dateLabel ?? "Photo"}
            className="max-h-full max-w-full object-contain select-none"
            style={animStyle}
            draggable={false}
          />
        )}

        {/* Prev arrow */}
        {hasPrev && (
          <button
            onClick={handlePrev}
            aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full p-3 bg-black/50 text-white hover:bg-black/80 transition"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        {/* Next arrow */}
        {hasNext && (
          <button
            onClick={handleNext}
            aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-3 bg-black/50 text-white hover:bg-black/80 transition"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Bottom metadata ── */}
      {(dateLabel || photo.ownerNickname || photo.eventId) && (
        <div className="absolute bottom-0 inset-x-0 px-4 py-3 flex items-center gap-2 text-sm text-white/50 bg-gradient-to-t from-black/70 to-transparent">
          {photo.eventId && (
            <span className="font-medium text-white/70 truncate max-w-[180px]">
              {photo.eventId}
            </span>
          )}
          {photo.eventId && (dateLabel || photo.ownerNickname) && (
            <span className="text-white/30">·</span>
          )}
          {dateLabel && <span>{dateLabel}</span>}
          {photo.ownerNickname && (
            <>
              <span className="text-white/30">·</span>
              <span>{photo.ownerNickname}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
