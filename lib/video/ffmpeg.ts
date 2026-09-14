import { spawn } from "node:child_process";
import { chmod, writeFile } from "node:fs/promises";

/**
 * ffmpeg plumbing for the per-exercise stitch. Kept free of `server-only`,
 * Supabase and env so it can be exercised directly by the tests.
 */

export async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string } | string;
  const p = typeof mod === "string" ? mod : (mod.default ?? "");
  if (!p) throw new Error("ffmpeg binary not found");
  try {
    await chmod(p, 0o755);
  } catch {}
  return p;
}

export function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += String(d).slice(-4000)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timed out"));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stderr });
    });
  });
}

export function extOf(p: string) {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? m[1].toLowerCase() : "mp4";
}

/**
 * Seconds shaved off the tail of every clip — the walk back to the phone after
 * the last rep. Done here, not in the browser: iOS Safari ignores the
 * MediaRecorder timeslice, so the old "drop N trailing chunks" trick removed
 * whatever a chunk happened to be worth (often 1 s, sometimes 3 s). ffmpeg
 * knows each clip's real duration, so the cut is exact.
 */
export const TRIM_TAIL_SEC = 3;
/** A clip is never trimmed below this — short sets keep at least a second. */
export const MIN_KEEP_SEC = 1;
/** Re-encode settings for the stitched file. */
export const OUT_FPS = 30;

export interface Probe {
  durationSec: number;
  hasAudio: boolean;
  width: number;
  height: number;
}

export function parseProbe(stderr: string, fallbackMs: number): Probe {
  const d = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(stderr);
  let durationSec = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) durationSec = Math.max(0, fallbackMs) / 1000;
  const v = /: Video:.*?, (\d{2,5})x(\d{2,5})/.exec(stderr);
  const even = (n: number) => (Number.isFinite(n) && n > 1 ? (n % 2 === 0 ? n : n - 1) : 0);
  return {
    durationSec,
    hasAudio: /: Audio:/.test(stderr),
    width: v ? even(Number(v[1])) : 0,
    height: v ? even(Number(v[2])) : 0,
  };
}

/** `ffmpeg -i` with no output: exits non-zero, prints the stream table we want. */
export async function probeClip(ff: string, file: string, fallbackMs: number): Promise<Probe> {
  try {
    const res = await run(ff, ["-hide_banner", "-i", file], 30_000);
    return parseProbe(res.stderr, fallbackMs);
  } catch {
    return { durationSec: Math.max(0, fallbackMs) / 1000, hasAudio: false, width: 0, height: 0 };
  }
}

/** How much of a clip survives the tail trim. */
export function keepSeconds(durationSec: number): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.max(Math.min(durationSec, MIN_KEEP_SEC), durationSec - TRIM_TAIL_SEC);
}

/**
 * Trim each clip's tail and concat into one H.264/MP4. Re-encodes, so clips
 * from different containers, sizes or frame rates still join cleanly.
 */
export async function trimConcat(ff: string, parts: { file: string; keepSec: number; probe: Probe }[], out: string): Promise<void> {
  const w = parts.find((p) => p.probe.width > 0)?.probe.width ?? 1280;
  const h = parts.find((p) => p.probe.height > 0)?.probe.height ?? 720;
  const withAudio = parts.every((p) => p.probe.hasAudio);
  const args = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const p of parts) args.push("-i", p.file);

  const chains: string[] = [];
  const maps: string[] = [];
  parts.forEach((p, i) => {
    const end = p.keepSec.toFixed(3);
    chains.push(
      `[${i}:v]trim=start=0:end=${end},setpts=PTS-STARTPTS,scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${OUT_FPS},format=yuv420p[v${i}]`,
    );
    maps.push(`[v${i}]`);
    if (withAudio) {
      chains.push(
        `[${i}:a]atrim=start=0:end=${end},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`,
      );
      maps.push(`[a${i}]`);
    }
  });
  chains.push(`${maps.join("")}concat=n=${parts.length}:v=1:a=${withAudio ? 1 : 0}[vout]${withAudio ? "[aout]" : ""}`);

  args.push("-filter_complex", chains.join(";"), "-map", "[vout]");
  if (withAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k");
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);

  const res = await run(ff, args, 240_000);
  if (res.code !== 0) throw new Error(`trim-concat exit ${res.code}: ${res.stderr.slice(-500)}`);
}

/** Last resort when the trim pass fails: join untouched clips by stream copy. */
export async function copyConcat(ff: string, files: string[], workDir: string, ext: string, out: string): Promise<void> {
  if (!files.every((f) => extOf(f) === ext)) throw new Error("mixed containers");
  const listFile = `${workDir}/list.txt`;
  await writeFile(listFile, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy"];
  if (ext === "mp4") args.push("-movflags", "+faststart");
  args.push(out);
  const res = await run(ff, args, 120_000);
  if (res.code !== 0) throw new Error(`copy-concat exit ${res.code}: ${res.stderr.slice(-500)}`);
}
