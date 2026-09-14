"use client";

import { AUDIO_BITRATE, pickMimeType, VIDEO_BITRATE } from "./camera";

/**
 * Wraps MediaRecorder and returns the WHOLE recording.
 *
 * Trimming the walk-back off the tail happens on the server, where ffmpeg
 * knows each clip's exact duration. It used to be done here by dropping
 * trailing timeslice chunks, which quietly under-trimmed: iOS Safari does not
 * honour the 1 s timeslice (a 9.6 s recording arrived as 3 chunks, so
 * "drop 3 chunks" clamped to dropping one ≈ 1 s).
 *
 * Optional canvas compositing burns the overlay (weight × reps) into the file.
 * If the composite path fails for any reason we fall back to the raw stream
 * and never break RECORD.
 */

export interface RecordingResult {
  blob: Blob;
  mime: string;
  /** Length of the returned file, ms. */
  durationMs: number;
  /** Always 0 — the server trims the tail. */
  trimmedMs: number;
  /** Wall-clock length of the recording, ms. */
  rawDurationMs: number;
}

export interface OverlayText {
  line1: string; // MON · DAY 1 · INCLINE PRESS
  line2: string; // 40 × 9
}

/** Chunked delivery keeps a long recording out of one giant buffer. */
const TIMESLICE_MS = 1000;

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
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
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.startedAt = performance.now();
    rec.start(TIMESLICE_MS);
  }

  /** Stop and return the whole recording. The tail trim happens server-side. */
  stop(): Promise<RecordingResult> {
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
        const blob = new Blob(chunks, { type: mime.split(";")[0] });
        resolve({
          blob,
          mime,
          durationMs: Math.round(rawDuration),
          trimmedMs: 0,
          rawDurationMs: Math.round(rawDuration),
        });
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
