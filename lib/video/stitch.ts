import "server-only";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ZipArchive } from "archiver";
import { emailName, EXERCISES, formatPrescription, variantFor } from "@/lib/engine";
import { ymdToDate } from "@/lib/session/dates";
import type { ClipRow, LiftRow, SetRow } from "@/lib/session/types";
import { createAdminClient } from "@/lib/supabase/server";
import { adminEmail, siteUrl } from "@/lib/supabase/env";

/**
 * Per-exercise pipeline. Runs inside `after()` once a lift is complete and every
 * set that recorded a clip has uploaded it:
 *   1. download the lift's set clips
 *   2. concat with ffmpeg (stream copy — same device, same codec) into ONE file
 *   3. upload sessions/{user}/{date}/{exercise}.{ext}, 7-day signed link
 *   4. Edge Function → Resend: "Day N: Dumbbell incline press"
 * Fallbacks: concat fails → zip clips + description; zip can't be stored →
 * per-clip signed links. Email failure never fails the workout.
 */

const SIGNED_URL_SECONDS = 7 * 24 * 3600;
const ATTACH_LIMIT_BYTES = 20 * 1024 * 1024;

interface Outcome {
  kind: "lift" | "zip" | "clips" | "none";
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

/**
 * Claims the lift for processing if it is completed, still pending, and every
 * set that promised a clip has delivered it. With `force`, missing clips are
 * ignored and failed / stale-stitching lifts can be re-claimed (retry, day
 * close, cron sweep). Returns true when this call won the claim.
 */
export async function claimLiftForEmail(liftId: string, force = false): Promise<boolean> {
  const admin = createAdminClient();
  const { data: lift } = await admin.from("session_lifts").select("id, status, email_status, finished_at").eq("id", liftId).maybeSingle();
  if (!lift || lift.status !== "completed") return false;
  const claimable: string[] = force ? ["pending", "failed", "stitching"] : ["pending"];
  if (!claimable.includes(lift.email_status)) return false;
  if (!force) {
    const [{ data: sets }, { data: clips }] = await Promise.all([
      admin.from("session_sets").select("set_number, has_clip").eq("lift_id", liftId).eq("kind", "work").eq("result", "completed"),
      admin.from("clips").select("set_number").eq("lift_id", liftId),
    ]);
    const have = new Set((clips ?? []).map((c) => c.set_number));
    if ((sets ?? []).some((s) => s.has_clip && !have.has(s.set_number))) return false;
  }
  const { data: claimed } = await admin
    .from("session_lifts")
    .update({ email_status: "stitching", email_error: null })
    .eq("id", liftId)
    .in("email_status", claimable)
    .select("id");
  return (claimed ?? []).length > 0;
}

/** Full pipeline for one lift. Call after claimLiftForEmail() returned true (or from retry). */
export async function stitchLiftAndEmail(liftId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: liftRow } = await admin.from("session_lifts").select("*").eq("id", liftId).single();
  if (!liftRow) return;
  const lift = liftRow as LiftRow;
  const [{ data: session }, { data: sets }, { data: clips }, { data: user }, { data: exercise }] = await Promise.all([
    admin.from("sessions").select("*").eq("id", lift.session_id).single(),
    admin.from("session_sets").select("*").eq("lift_id", liftId).eq("kind", "work").order("set_number"),
    admin.from("clips").select("*").eq("lift_id", liftId).order("set_number"),
    admin.from("users").select("email, delivery_email, records_video").eq("id", lift.user_id).single(),
    admin.from("exercises").select("slug, exercise_key").eq("id", lift.exercise_id).single(),
  ]);
  if (!session || !user) return;
  if (!user.records_video) {
    await admin.from("session_lifts").update({ email_status: "sent", video_kind: "none" }).eq("id", liftId);
    return;
  }

  const def = EXERCISES.find((e) => e.slug === exercise?.slug);
  const date = ymdToDate(session.session_date);
  const longName = def ? emailName(def, date, lift.variant_index ?? 0, lift.exercise_key) : lift.display_name;
  const dayNumber = (session.day_number as number | null) ?? 1;
  const subject = `Day ${dayNumber}: ${longName}`;
  const to = (user.delivery_email || user.email || "").trim();
  const repUnit = variantFor(lift.exercise_key, lift.variant_index ?? 0).repUnit ?? null;
  const load = formatPrescription(Number(lift.prescribed_weight), lift.prescribed_reps, repUnit);
  const setRows = ((sets ?? []) as SetRow[]).map((s) => ({
    n: s.set_number,
    load: formatPrescription(Number(s.prescribed_weight), s.prescribed_reps, repUnit),
    done: s.result === "completed",
    restSkipped: s.rest_skipped,
  }));
  const description = liftDescription(subject, session.session_date, load, setRows);
  const clipRows = (clips ?? []) as ClipRow[];

  let outcome: Outcome = { kind: "none", path: null, bytes: null, links: [] };
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

      // --- 1. one video for the exercise
      try {
        const ext = extOf(local[0].file);
        if (!local.every((l) => extOf(l.file) === ext)) throw new Error("mixed containers");
        const listFile = `${workDir}/list.txt`;
        await writeFile(listFile, local.map((l) => `file '${l.file.replace(/'/g, "'\\''")}'`).join("\n"));
        const out = `${workDir}/lift.${ext}`;
        const args = ["-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy"];
        if (ext === "mp4") args.push("-movflags", "+faststart");
        args.push(out);
        const res = await run(await ffmpegPath(), args, 120_000);
        if (res.code !== 0) throw new Error(`ffmpeg exit ${res.code}: ${res.stderr.slice(-500)}`);
        const size = (await stat(out)).size;
        if (size < 1024) throw new Error("empty output");
        const storagePath = `${prefix}/${lift.exercise_key}.${ext}`;
        const { error: upErr } = await admin.storage.from("sessions").upload(storagePath, await readFile(out), {
          contentType: ext === "mp4" ? "video/mp4" : "video/webm",
          upsert: true,
        });
        if (upErr) throw new Error(`upload: ${upErr.message}`);
        const { data: signed } = await admin.storage.from("sessions").createSignedUrl(storagePath, SIGNED_URL_SECONDS, { download: `${subject}.${ext}` });
        outcome = { kind: "lift", path: storagePath, bytes: size, links: signed?.signedUrl ? [{ label: `${longName} · ${local.length} sets`, url: signed.signedUrl }] : [] };
        await admin.storage.from("sessions").remove(clipRows.map((c) => c.storage_path));
      } catch (e) {
        console.warn("lift concat failed, falling back to zip:", (e as Error).message);
        // --- 2. zip of clips + description
        try {
          const zipPath = `${workDir}/${lift.exercise_key}.zip`;
          await new Promise<void>((resolve, reject) => {
            const outStream = createWriteStream(zipPath);
            const archive = new ZipArchive({ zlib: { level: 0 } });
            outStream.on("close", () => resolve());
            archive.on("error", reject);
            archive.pipe(outStream);
            local.forEach((l) => archive.file(l.file, { name: `${lift.exercise_key}-set${l.clip.set_number}.${extOf(l.file)}` }));
            archive.append(description, { name: "youtube-description.txt" });
            archive.finalize();
          });
          const size = (await stat(zipPath)).size;
          const storagePath = `${prefix}/${lift.exercise_key}.zip`;
          const { error: upErr } = await admin.storage.from("sessions").upload(storagePath, await readFile(zipPath), { contentType: "application/zip", upsert: true });
          if (upErr) throw new Error(`upload zip: ${upErr.message}`);
          const { data: signed } = await admin.storage.from("sessions").createSignedUrl(storagePath, SIGNED_URL_SECONDS);
          outcome = { kind: "zip", path: storagePath, bytes: size, links: signed?.signedUrl ? [{ label: `${longName} · clips (zip)`, url: signed.signedUrl }] : [] };
        } catch (e2) {
          console.warn("zip failed, falling back to per-clip links:", (e2 as Error).message);
          const links: { label: string; url: string }[] = [];
          for (const c of clipRows) {
            const { data: signed } = await admin.storage.from("sessions").createSignedUrl(c.storage_path, SIGNED_URL_SECONDS);
            if (signed?.signedUrl) links.push({ label: `${longName} · set ${c.set_number}`, url: signed.signedUrl });
          }
          outcome = { kind: "clips", path: null, bytes: null, links };
        }
      }
    }
  } catch (e) {
    console.error("lift pipeline error:", e);
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }

  await admin
    .from("session_lifts")
    .update({ video_path: outcome.path, video_bytes: outcome.bytes, video_kind: outcome.kind, email_to: to, email_subject: subject })
    .eq("id", liftId);

  try {
    if (!to) throw new Error("no delivery address");
    let attachment: { filename: string; content: string } | null = null;
    if (outcome.kind === "lift" && outcome.path && outcome.bytes && outcome.bytes < ATTACH_LIMIT_BYTES) {
      const { data } = await admin.storage.from("sessions").download(outcome.path);
      if (data) attachment = { filename: `${subject}.${extOf(outcome.path)}`, content: Buffer.from(await data.arrayBuffer()).toString("base64") };
    }
    await sendLiftEmail({ to, subject, date: session.session_date, longName, load, sets: setRows, links: outcome.links, description, attachment, note: lift.note });
    await admin.from("session_lifts").update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null }).eq("id", liftId);
  } catch (e) {
    console.error("lift email failed:", e);
    await admin.from("session_lifts").update({ email_status: "failed", email_error: String((e as Error).message ?? e).slice(0, 500) }).eq("id", liftId);
  }
}

export function liftDescription(subject: string, date: string, load: string, sets: { n: number; load: string; done: boolean; restSkipped: boolean }[]): string {
  return [
    `${subject} — ${date}`,
    "",
    `${load} × ${sets.length} sets`,
    ...sets.map((s) => `Set ${s.n}: ${s.load}${s.done ? "" : " (missed)"}${s.restSkipped ? " · rest skipped" : ""}`),
    "",
    "Two Bowflex SelectTech 552s, a bench, wall pull-up handles, a mat.",
    siteUrl(),
  ].join("\n");
}

interface LiftEmail {
  to: string;
  subject: string;
  date: string;
  longName: string;
  load: string;
  sets: { n: number; load: string; done: boolean; restSkipped: boolean }[];
  links: { label: string; url: string }[];
  description: string;
  attachment: { filename: string; content: string } | null;
  note: string | null;
}

/** Sends through the Supabase Edge Function (Resend); falls back to Resend directly if the function is unreachable. */
async function sendLiftEmail(mail: LiftEmail): Promise<void> {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const setsHtml = mail.sets
    .map((s) => `<tr><td style="padding:6px 0;border-bottom:1px solid #2A2A28;color:${s.done ? "#F3E5AB" : "#5E5B55"}">Set ${s.n}</td><td style="padding:6px 0;border-bottom:1px solid #2A2A28;color:#9A958A;text-align:right;white-space:nowrap">${esc(s.load)}${s.done ? "" : " · missed"}${s.restSkipped ? " · rest skipped" : ""}</td></tr>`)
    .join("");
  const linkHtml =
    mail.links.length > 0
      ? mail.links.map((l) => `<p style="margin:8px 0"><a href="${l.url}" style="color:#F3E5AB">${esc(l.label)}</a> <span style="color:#5E5B55">· link works for 7 days</span></p>`).join("")
      : `<p style="color:#9A958A">No video was recorded for this lift.</p>`;
  const html = `<!doctype html><html><body style="margin:0;background:#0A0A0A;color:#F3E5AB;font-family:'IBM Plex Sans',system-ui,sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#F3E5AB">Blythe Workout</div>
    <h1 style="font-weight:600;font-size:22px;margin:24px 0 4px;color:#F3E5AB">${esc(mail.subject)}</h1>
    <div style="color:#9A958A;font-size:14px;margin-bottom:24px">${esc(mail.date)} · ${esc(mail.load)} × ${mail.sets.length}</div>
    ${linkHtml}
    <table style="width:100%;border-collapse:collapse;margin-top:24px;font-size:15px">${setsHtml}</table>
    ${mail.note ? `<p style="color:#9A958A;font-size:14px;margin-top:16px">${esc(mail.note)}</p>` : ""}
    <pre style="white-space:pre-wrap;color:#5E5B55;font-size:12px;margin-top:28px;font-family:inherit">${esc(mail.description)}</pre>
  </div></body></html>`;
  const text = `${mail.subject}\n${mail.date}\n\n${mail.links.map((l) => `${l.label}: ${l.url}`).join("\n")}\n\n${mail.description}`;

  const payload = { to: mail.to, subject: mail.subject, html, text, attachment: mail.attachment };
  const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-day-email`;
  const res = await fetch(fnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bw-secret": process.env.EDGE_FUNCTION_SECRET ?? "" },
    body: JSON.stringify(payload),
  });
  if (res.ok) return;
  const body = await res.text().catch(() => "");
  if (res.status === 404 || res.status >= 500 || res.status === 401) {
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

/** Try to claim + process a lift. Safe to call from any route; only one caller wins. */
export async function processLiftIfReady(liftId: string, force = false): Promise<void> {
  try {
    if (await claimLiftForEmail(liftId, force)) await stitchLiftAndEmail(liftId);
  } catch (e) {
    console.error("processLiftIfReady", e);
  }
}
