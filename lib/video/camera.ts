"use client";

/** Camera + mic stream management for the live screens. iPhone Safari friendly. */

export const VIDEO_WIDTH = 1280;
export const VIDEO_HEIGHT = 720;
export const VIDEO_BITRATE = 1_500_000; // ~11 MB/min; a full day stays under ~120 MB
export const AUDIO_BITRATE = 64_000;

let stream: MediaStream | null = null;

export function currentStream(): MediaStream | null {
  return stream && stream.active ? stream : null;
}

/** Must be called from a user gesture on iOS. Rear camera preferred, no flip control. */
export async function getCamera(): Promise<MediaStream> {
  if (stream && stream.active && stream.getVideoTracks().some((t) => t.readyState === "live")) return stream;
  releaseCamera();
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera not available.");
  }
  const constraints: MediaStreamConstraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: VIDEO_WIDTH },
      height: { ideal: VIDEO_HEIGHT },
      frameRate: { ideal: 30, max: 30 },
    },
    audio: { echoCancellation: false, noiseSuppression: false },
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    // Relax constraints (some devices reject width/height + facingMode combos).
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: true });
  }
  return stream;
}

export function releaseCamera() {
  if (stream) {
    for (const t of stream.getTracks()) {
      try {
        t.stop();
      } catch {}
    }
  }
  stream = null;
}

/** Pick the best container/codec the browser will actually write. */
export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {}
  }
  return undefined;
}

export function extensionFor(mime: string): string {
  return mime.includes("mp4") ? "mp4" : mime.includes("webm") ? "webm" : "bin";
}
