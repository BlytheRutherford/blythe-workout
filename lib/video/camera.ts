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

let streamHasAudio = false;

/**
 * Must be called from a user gesture on iOS. Front camera, no flip control.
 *
 * Video-only by default: capturing the microphone switches iOS into a
 * play-and-record audio session, which pauses whatever music is playing in
 * another app. With `withAudio` false nothing touches the audio session.
 */
export async function getCamera(withAudio = false): Promise<MediaStream> {
  if (stream && stream.active && streamHasAudio === withAudio && stream.getVideoTracks().some((t) => t.readyState === "live")) return stream;
  releaseCamera();
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera not available.");
  }
  const audio: MediaStreamConstraints["audio"] = withAudio ? { echoCancellation: false, noiseSuppression: false } : false;
  const constraints: MediaStreamConstraints = {
    video: {
      facingMode: { ideal: "user" },
      width: { ideal: VIDEO_WIDTH },
      height: { ideal: VIDEO_HEIGHT },
      frameRate: { ideal: 30, max: 30 },
    },
    audio,
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch {
    // Relax constraints (some devices reject width/height + facingMode combos).
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "user" } }, audio });
  }
  streamHasAudio = withAudio;
  return stream;
}

/** True when the live stream comes from the front (selfie) camera — the preview is mirrored then. */
export function isFrontCamera(): boolean {
  const t = stream?.getVideoTracks()[0];
  const fm = t?.getSettings().facingMode;
  return fm ? fm === "user" : true;
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
export function pickMimeType(withAudio = false): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = withAudio
    ? [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4;codecs=avc1,mp4a.40.2",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ]
    : [
        "video/mp4;codecs=avc1.42E01E",
        "video/mp4;codecs=avc1",
        "video/mp4",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
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
