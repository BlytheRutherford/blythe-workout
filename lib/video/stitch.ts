import "server-only";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ZipArchive } from "archiver";
import { formatLoad } from "@/lib/engine";
import type { ClipRow, LiftRow } from "@/lib/session/types";
import { createAdminClient } from "@/lib/supabase/server";
import { adminEmail, siteUrl } from "@/lib/supabase/env";

/**
 * Day pipeline (runs after the session is complete, inside the Vercel function
 * via `after()`):
 *   1. download every set clip
 *   2. concat with ffmpeg (stream copy — same device, same codec) into ONE file
 *   3. upload sessions/{user}/{date}/day.{ext}, 7-day signed link
 *   4. Edge Function → Resend: "Day N of Blythe Workouts"
 * Fallbacks: concat fails → zip clips + youtube-description.txt; zip too big /
 * fails → per-clip signed links. Email failure never fails the workout.
 */

const SIGNED_URL_SECONDS = 7 * 24 * 3600;
const ATTACH_LIMIT_BYTES = 20 * 1024 * 1024;

interface StitchOutcome {
  kind: "day" | "zip" | "clips";
  path: string | null;
  bytes: number | null;
  links: { label: string; url: string }[];
}

async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string } | string;
  const p = typeof mod === "string" ? mod : (mod.default ?? "");
  if (!p) throw new Error("ffmpeg binary not found");
  try {
    await chmod(p, 0o755);
  } catch {}
  return p;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number; stderr: string }> {
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

function extOf(p: string) {
  const m = /\.([a-z0-9]+)$/i.exec(p);
  return m ? m[1].toLowerCase() : "mp4";
}

export async function stitchAndEmail(sessionId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: session } = await admin.from("sessions").select("*").eq("id", sessionId).single();
  if (!session || session.status !== "complete") return;
  await admin.from("sessions").update({ email_status: "stitching", email_error: null }).eq("id", sessionId);

  const [{ data: lifts }, { data: clips }, { data: user }] = await Promise.all([
    admin.from("session_lifts").select("*").eq("session_id", sessionId).order("order_index"),
    admin.from("clips").select("*").eq("session_id", sessionId),
    admin.from("users").select("email, delivery_email").eq("id", session.user_id).single(),
  ]);
  const liftRows = (lifts ?? []) as (LiftRow & { exercise: never })[];
  const clipRows = ((clips ?? []) as ClipRow[]).sort((a, b) => {
    const la = liftRows.find((l) => l.id === a.lift_id)?.order_index ?? 0;
    const lb = liftRows.find((l) => l.id === b.lift_id)?.order_index ?? 0;
    return la - lb || a.set_number - b.set_number;
  });
  const to = (user?.delivery_email || user?.email || "").trim();
  const dayNumber = session.day_number as number;
  const liftList = liftRows.map((l) => ({
    name: l.display_name,
    load: `${formatLoad(Number(l.prescribed_weight))} × ${l.prescribed_reps}`,
    status: l.status,
  }));
  const description = youtubeDescription(dayNumber, session.session_date, liftList);

  let outcome: StitchOutcome = { kind: "clips", path: null, bytes: null, links: [] };
  let workDir: string | null = null;
  try {
    if (clipRows.length > 0) {
      workDir = await mkdtemp(`${tmpdir()}/bw-`);
      const local: { file: string; clip: ClipRow }[] = [];
      for (const c of clipRows) {
        const { data, error } = await admin.storage.from("sessions").download(c.storage_path);
        if (error || !data) throw new Error(`download ${c.storage_path}: ${error?.message}`);
        const file = `${workDir}/${String(local.length).padStart(2, "0")}.${extOf(c.storage_path)}`;
        await writeFile(file, Buffer.from(await data.arrayBuffer()));
        local.push({ file, clip: c });
      }
      const prefix = `${session.user_id}/${session.session_date}`;

      // --- 1. one video for the day
      try {
        const ext = extOf(local[0].file);
        const sameExt = local.every((l) => extOf(l.file) === ext);
        if (!sameExt) throw new Error("mixed containers");
        const listFile = `${workDir}/list.txt`;
        await writeFile(listFile, local.map((l) => `file '${l.file.replace(/'/g, "'\\''")}'`).join("\n"));
        const out = `${workDir}/day.${ext}`;
        const args = ["-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy"];
        if (ext === "mp4") args.push("-movflags", "+faststart");
        args.push(out);
        const ff = await ffmpegPath();
        const res = await run(ff, args, 150_000);
        if (res.code !== 0) throw new Error(`ffmpeg exit ${res.code}: ${res.stderr.slice(-500)}`);
        const size = (await stat(out)).size;
        if (size < 1024) throw new Error("empty output");
        const storagePath = `${prefix}/day-${dayNumber}.${ext}`;
        const body = await readFile(out);
        const { error: upErr } = await admin.storage.from("sessions").upload(storagePath, body, {
          contentType: ext === "mp4" ? "video/mp4" : "video/webm",
          upsert: true,
        });
        if (upErr) throw new Error(`upload day video: ${upErr.message}`);
        const { data: signed } = await admin.storage.from("sessions").createSignedUrl(storagePath, SIGNED_URL_SECONDS, { download: `Day ${dayNumber} of Blythe Workouts.${ext}` });
        outcome = { kind: "day", path: storagePath, bytes: size, links: signed?.signedUrl ? [{ label: `Day ${dayNumber} video`, url: signed.signedUrl }] : [] };
        // Set clips are no longer needed once the day video exists.
        await admin.storage.from("sessions").remove(clipRows.map((c) => c.storage_path));
      } catch (e) {
        console.warn("concat failed, falling back to zip:", (e as Error).message);
        // --- 2. zip of clips + youtube-description.txt
        try {
          const zipPath = `${workDir}/day-${dayNumber}.zip`;
          await new Promise<void>((resolve, reject) => {
            const outStream = createWriteStream(zipPath);
            const archive = new ZipArchive({ zlib: { level: 0 } });
            outStream.on("close", () => resolve());
            archive.on("error", reject);
            archive.pipe(outStream);
            local.forEach((l, i) => {
              const lift = liftRows.find((x) => x.id === l.clip.lift_id);
              archive.file(l.file, { name: `${String(i + 1).padStart(2, "0")}-${lift?.exercise_key ?? "lift"}-set${l.clip.set_number}.${extOf(l.file)}` });
            });
            archive.append(description, { name: "youtube-description.txt" });
            archive.finalize();
          });
          const size = (await stat(zipPath)).size;
          const storagePath = `${prefix}/day-${dayNumber}.zip`;
          const { error: upErr } = await admin.storage.from("sessions").upload(storagePath, await readFile(zipPath), { contentType: "application/zip", upsert: true });
          if (upErr) throw new Error(`upload zip: ${upErr.message}`);
          const { data: signed } = await admin.storage.from("sessions").createSignedUrl(storagePath, SIGNED_URL_SECONDS);
          outcome = { kind: "zip", path: storagePath, bytes: size, links: signed?.signedUrl ? [{ label: `Day ${dayNumber} clips (zip)`, url: signed.signedUrl }] : [] };
        } catch (e2) {
          console.warn("zip failed, falling back to per-clip links:", (e2 as Error).message);
          // --- 3. individual links
          const links: { label: string; url: string }[] = [];
          for (const c of clipRows) {
            const lift = liftRows.find((x) => x.id === c.lift_id);
            const { data: signed } = await admin.storage.from("sessions").createSignedUrl(c.storage_path, SIGNED_URL_SECONDS);
            if (signed?.signedUrl) links.push({ label: `${lift?.display_name ?? c.exercise_key} · set ${c.set_number}`, url: signed.signedUrl });
          }
          outcome = { kind: "clips", path: null, bytes: null, links };
        }
      }
    }
  } catch (e) {
    console.error("stitch pipeline error:", e);
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  await admin
    .from("sessions")
    .update({ video_path: outcome.path, video_bytes: outcome.bytes, video_kind: outcome.kind, email_to: to })
    .eq("id", sessionId);

  // --- email (never fails the workout)
  try {
    if (!to) throw new Error("no delivery address");
    let attachment: { filename: string; content: string } | null = null;
    if (outcome.kind === "day" && outcome.path && outcome.bytes && outcome.bytes < ATTACH_LIMIT_BYTES) {
      const { data } = await admin.storage.from("sessions").download(outcome.path);
      if (data) attachment = { filename: `Day ${dayNumber} of Blythe Workouts.${extOf(outcome.path)}`, content: Buffer.from(await data.arrayBuffer()).toString("base64") };
    }
    await sendDayEmail({ to, dayNumber, date: session.session_date, lifts: liftList, links: outcome.links, description, attachment });
    await admin.from("sessions").update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null }).eq("id", sessionId);
  } catch (e) {
    console.error("day email failed:", e);
    await admin.from("sessions").update({ email_status: "failed", email_error: String((e as Error).message ?? e).slice(0, 500) }).eq("id", sessionId);
  }
}

export function youtubeDescription(dayNumber: number, date: string, lifts: { name: string; load: string; status: string }[]): string {
  const lines = [
    `Day ${dayNumber} of Blythe Workouts — ${date}`,
    "",
    ...lifts.map((l) => `${l.name} — ${l.load} × 3${l.status === "missed" ? " (missed)" : ""}`),
    "",
    "Two Bowflex SelectTech 552s, a bench, wall pull-up handles, a mat.",
    siteUrl(),
  ];
  return lines.join("\n");
}

interface DayEmail {
  to: string;
  dayNumber: number;
  date: string;
  lifts: { name: string; load: string; status: string }[];
  links: { label: string; url: string }[];
  description: string;
  attachment: { filename: string; content: string } | null;
}

/** Sends through the Supabase Edge Function (Resend). Falls back to Resend directly if the function is unreachable. */
async function sendDayEmail(mail: DayEmail): Promise<void> {
  const subject = `Day ${mail.dayNumber} of Blythe Workouts`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const liftHtml = mail.lifts
    .map((l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #2A2A28;color:${l.status === "missed" ? "#5E5B55" : "#F3E5AB"}">${esc(l.name)}</td><td style="padding:6px 0;border-bottom:1px solid #2A2A28;color:#9A958A;text-align:right;white-space:nowrap">${esc(l.load)}${l.status === "missed" ? " · missed" : ""}</td></tr>`)
    .join("");
  const linkHtml =
    mail.links.length > 0
      ? mail.links.map((l) => `<p style="margin:8px 0"><a href="${l.url}" style="color:#F3E5AB">${esc(l.label)}</a> <span style="color:#5E5B55">· link works for 7 days</span></p>`).join("")
      : `<p style="color:#9A958A">No video was recorded today.</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#0A0A0A;color:#F3E5AB;font-family:'IBM Plex Sans',system-ui,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#F3E5AB">Blythe Workout</div>
    <h1 style="font-weight:600;font-size:22px;margin:24px 0 4px;color:#F3E5AB">${esc(subject)}</h1>
    <div style="color:#9A958A;font-size:14px;margin-bottom:24px">${esc(mail.date)}</div>
    ${linkHtml}
    <table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:15px">${liftHtml}</table>
    <pre style="white-space:pre-wrap;color:#5E5B55;font-size:12px;margin-top:28px;font-family:inherit">${esc(mail.description)}</pre>
  </div></body></html>`;
  const text = `${subject}\n${mail.date}\n\n${mail.links.map((l) => `${l.label}: ${l.url}`).join("\n")}\n\n${mail.description}`;

  const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-day-email`;
  const secret = process.env.EDGE_FUNCTION_SECRET ?? "";
  const payload = { to: mail.to, subject, html, text, attachment: mail.attachment };
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bw-secret": secret },
    body: JSON.stringify(payload),
  });
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  if (res.status === 404 || res.status >= 500 || res.status === 401) {
    // Edge Function missing/unhealthy → send directly (same Resend account).
    await sendViaResend(payload);
    return;
  }
  throw new Error(`edge function ${res.status}: ${body.slice(0, 300)}`);
}

async function sendViaResend(p: { to: string; subject: string; html: string; text: string; attachment: { filename: string; content: string } | null }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY missing");
  const from = process.env.EMAIL_FROM || "Blythe Workout <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [p.to],
      reply_to: adminEmail() || undefined,
      subject: p.subject,
      html: p.html,
      text: p.text,
      attachments: p.attachment ? [p.attachment] : undefined,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
