import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ffmpegPath, keepSeconds, parseProbe, probeClip, run, trimConcat } from "../lib/video/ffmpeg";

/** Builds a clip of `seconds` at `size` so we can measure the real trim. */
async function makeClip(ff: string, out: string, seconds: number, size: string, fps: number) {
  const res = await run(
    ff,
    ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=${fps}:duration=${seconds}`,
     "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out],
    60_000,
  );
  expect(res.code).toBe(0);
}

describe("keepSeconds", () => {
  it("removes exactly 3 s from a normal set", () => expect(keepSeconds(9.626)).toBeCloseTo(6.626, 3));
  it("never trims a short clip to nothing", () => expect(keepSeconds(2)).toBe(1));
  it("leaves a sub-second clip alone", () => expect(keepSeconds(0.6)).toBeCloseTo(0.6, 3));
  it("returns 0 for an unknown duration", () => expect(keepSeconds(0)).toBe(0));
});

describe("parseProbe", () => {
  const stderr = `  Duration: 00:00:09.63, start: 0.000000, bitrate: 2431 kb/s
  Stream #0:0[0x1](und): Video: h264 (avc1 / 0x31637661), yuv420p(tv, bt709), 1280x720 [SAR 1:1 DAR 16:9], 30 fps`;
  it("reads duration and dimensions", () => {
    const p = parseProbe(stderr, 0);
    expect(p.durationSec).toBeCloseTo(9.63, 2);
    expect(p.width).toBe(1280);
    expect(p.height).toBe(720);
    expect(p.hasAudio).toBe(false);
  });
  it("falls back to the client-reported duration", () => expect(parseProbe("garbage", 8500).durationSec).toBe(8.5));
});

describe("trimConcat", () => {
  let dir = "";
  let ff = "";
  beforeAll(async () => {
    ff = await ffmpegPath();
    dir = await mkdtemp(`${tmpdir()}/bw-test-`);
  }, 120_000);
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("cuts 3 s off every set and joins them, even across sizes", async () => {
    const specs = [
      { s: 9.6, size: "640x360", fps: 30 },
      { s: 6.9, size: "480x360", fps: 24 },
      { s: 7.0, size: "640x360", fps: 30 },
    ];
    const parts = [];
    for (const [i, spec] of specs.entries()) {
      const file = `${dir}/${i}.mp4`;
      await makeClip(ff, file, spec.s, spec.size, spec.fps);
      const probe = await probeClip(ff, file, 0);
      expect(probe.durationSec).toBeGreaterThan(spec.s - 0.2);
      parts.push({ file, keepSec: keepSeconds(probe.durationSec), probe });
    }
    const out = `${dir}/lift.mp4`;
    await trimConcat(ff, parts, out);
    const stitched = await probeClip(ff, out, 0);
    const expected = parts.reduce((t, p) => t + p.keepSec, 0);
    expect(stitched.durationSec).toBeGreaterThan(expected - 0.25);
    expect(stitched.durationSec).toBeLessThan(expected + 0.25);
    // 23.5 s of source, 9 s of walk-back removed.
    expect(stitched.durationSec).toBeLessThan(15.2);
  }, 240_000);
});
