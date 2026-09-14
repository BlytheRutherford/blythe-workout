"use client";

import { AUDIO_BITRATE, pickMimeType, VIDEO_BITRATE } from "./camera";

/**
 * Wraps MediaRecorder with 1 s timeslices so the tail can be dropped without
 * re-encoding. Safari writes fragmented MP4 (init segment first, then
 * independent moof/mdat fragments per timeslice) and Chrome writes WebM
 * clusters; in both cases dropping trailing chunks leaves a playable file.
 *
 * Optional canvas compositing burns the overlay (weight × reps) into the file.
 * If the composite path fails for any reason we fall back to the raw stream
 * and never break RECORD.
 */

export interface RecordingResult {
  blob: Blob;
  mime: string;
  /** Length of the returned file, ms (after trimming). */
  durationMs: number;
  /** How much was dropped from the tail, ms. */
  trimmedMs: number;
  /** Raw length before trimming, ms. */
  rawDurationMs: number;
}

export interface OverlayText {
  line1: string; // MON · DAY 1 · INCLINE PRESS
  line2: string; // 40 × 9
}

export const TRIM_TAIL_MS = 3000;
const TIMESLICE_MS = 1000;

interface Chunk {
  blob: Blob;
  /** ms since recording start when this chunk arrived */
  at: number;
}

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Chunk[] = [];
  private startedAt = 0;
  private mime = "";
  private raf = 0;
  private canvas: HTMLCanvasElement | null = null;
  private compositeStream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private overlay: OverlayText | null = null;

  get mimeType() {
    return this.mime;
  }

  /** Elapsed ms since start (0 when idle). */
  elapsed(): number {
    return this.startedAt ? performance.now() - this.startedAt : 0;
  }

  /**
   * Start recording. `preview` is the <video> element already playing `stream`;
   * when `overlay` is provided we try to composite through a canvas.
   */
  start(stream: MediaStream, preview: HTMLVideoElement | null, overlay: OverlayText | null): void {
    this.chunks = [];
    this.overlay = overlay;
    const hasAudio = stream.getAudioTracks().length > 0;
    const mime = pickMimeType(hasAudio);
    let source = stream;

    if (overlay && preview && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype) {
      try {
        source = this.makeComposite(stream, preview);
      } catch {
        source = stream;
        this.teardownComposite();
      }
    }

    const opts: MediaRecorderOptions = { videoBitsPerSecond: VIDEO_BITRATE };
    if (hasAudio) opts.audioBitsPerSecond = AUDIO_BITRATE;
    if (mime) opts.mimeType = mime;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(source, opts);
    } catch {
      // Composite stream rejected → raw stream, default options.
      this.teardownComposite();
      source = stream;
      rec = mime ? new MediaRecorder(source, { mimeType: mime }) : new MediaRecorder(source);
    }
    this.recorder = rec;
    this.mime = rec.mimeType || mime || "video/mp4";
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push({ blob: e.data, at: performance.now() - this.startedAt });
    };
    this.startedAt = performance.now();
    rec.start(TIMESLICE_MS);
  }

  /** Stop and return the file with the last `trimMs` dropped (never to empty). */
  stop(trimMs = TRIM_TAIL_MS): Promise<RecordingResult> {
    const rec = this.recorder;
    if (!rec) return Promise.reject(new Error("Not recording."));
    return new Promise((resolve, reject) => {
      const finish = () => {
        const rawDuration = performance.now() - this.startedAt;
        this.startedAt = 0;
        this.teardownComposite();
        const mime = this.mime;
        const chunks = this.chunks;
        this.chunks = [];
        this.recorder = null;
        if (chunks.length === 0) return reject(new Error("No video data."));

        // Drop whole trailing timeslices (≈1 s each) instead of trusting wall-clock
        // timestamps, which iOS pauses when the page is backgrounded.
        let kept = chunks;
        let trimmed = 0;
        // The first chunk can be a media-less init segment (ftyp+moov), so always
        // keep at least two chunks; a clip ≤ 3 s is never trimmed to nothing.
        if (rawDuration > trimMs + 1000 && chunks.length > 2) {
          const drop = Math.min(chunks.length - 2, Math.round(trimMs / TIMESLICE_MS));
          kept = chunks.slice(0, chunks.length - drop);
          trimmed = Math.min(rawDuration - 1000, drop * TIMESLICE_MS);
        }
        const blob = new Blob(
          kept.map((c) => c.blob),
          { type: mime.split(";")[0] },
        );
        resolve({ blob, mime, durationMs: Math.max(0, Math.round(rawDuration - trimmed)), trimmedMs: Math.round(trimmed), rawDurationMs: Math.round(rawDuration) });
      };
      rec.onstop = finish;
      rec.onerror = () => finish();
      try {
        if (rec.state !== "inactive") rec.stop();
        else finish();
      } catch (e) {
        reject(e as Error);
      }
    });
  }

  /** Abort without producing a file. */
  cancel() {
    try {
      this.recorder?.stop();
    } catch {}
    this.recorder = null;
    this.chunks = [];
    this.startedAt = 0;
    this.teardownComposite();
  }

  updateOverlay(o: OverlayText) {
    this.overlay = o;
  }

  private makeComposite(stream: MediaStream, video: HTMLVideoElement): MediaStream {
    const track = stream.getVideoTracks()[0];
    const s = track.getSettings();
    const w = s.width || video.videoWidth || 1280;
    const h = s.height || video.videoHeight || 720;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.canvas = canvas;
    this.video = video;

    const draw = () => {
      if (!this.canvas) return;
      try {
        ctx.drawImage(video, 0, 0, w, h);
        if (this.overlay) {
          const pad = Math.round(h * 0.04);
          const f1 = Math.round(h * 0.035);
          const f2 = Math.round(h * 0.06);
          ctx.fillStyle = "rgba(10,10,10,0.55)";
          ctx.fillRect(0, 0, w, pad * 2 + f1 + f2 + Math.round(h * 0.02));
          ctx.fillStyle = "#F3E5AB";
          ctx.textBaseline = "top";
          ctx.font = `600 ${f1}px "IBM Plex Sans", system-ui, sans-serif`;
          ctx.fillText(this.overlay.line1, pad, pad);
          ctx.font = `400 ${f2}px Fraunces, Georgia, serif`;
          ctx.fillText(this.overlay.line2, pad, pad + f1 + Math.round(h * 0.015));
        }
      } catch {
        /* frame not ready */
      }
      this.raf = requestAnimationFrame(draw);
    };
    draw();

    const canvasStream = canvas.captureStream(30);
    const out = new MediaStream();
    for (const t of canvasStream.getVideoTracks()) out.addTrack(t);
    for (const t of stream.getAudioTracks()) out.addTrack(t);
    this.compositeStream = out;
    return out;
  }

  private teardownComposite() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.compositeStream) {
      for (const t of this.compositeStream.getVideoTracks()) {
        try {
          t.stop();
        } catch {}
      }
    }
    this.compositeStream = null;
    this.canvas = null;
    this.video = null;
  }
}
