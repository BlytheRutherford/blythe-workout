"use client";

import { createClient } from "@/lib/supabase/client";
import { extensionFor } from "./camera";

/**
 * Durable upload queue for set clips. Blobs are parked in IndexedDB so a
 * reload or a backgrounded tab never loses a set's video; uploads run in the
 * background during rest and are retried with backoff.
 */

export interface PendingClip {
  id: string;
  sessionId: string;
  liftId: string;
  setNumber: number;
  exerciseKey: string;
  ymd: string;
  userId: string;
  mime: string;
  durationMs: number;
  trimmedMs: number;
  blob: Blob;
  attempts: number;
  createdAt: number;
}

const DB_NAME = "blythe-clips";
const STORE = "pending";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(item: PendingClip) {
  try {
    const db = await openDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* memory-only fallback */
  }
}

async function idbDelete(id: string) {
  try {
    const db = await openDb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
}

async function idbAll(): Promise<PendingClip[]> {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).getAll();
      r.onsuccess = () => res(r.result as PendingClip[]);
      r.onerror = () => rej(r.error);
    });
  } catch {
    return [];
  }
}

type Listener = (pending: number, failed: number) => void;

class UploadQueue {
  private items = new Map<string, PendingClip>();
  private running = false;
  private listeners = new Set<Listener>();
  private failed = new Set<string>();
  private loaded = false;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.pendingCount(), this.failed.size);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.pendingCount(), this.failed.size);
  }

  pendingCount() {
    return this.items.size;
  }

  /** Restore anything left over from a previous page load for this session. */
  async restore(sessionId: string) {
    if (this.loaded) return;
    this.loaded = true;
    for (const it of await idbAll()) {
      if (it.sessionId === sessionId && !this.items.has(it.id)) this.items.set(it.id, { ...it, attempts: 0 });
    }
    this.emit();
    void this.process();
  }

  async enqueue(item: Omit<PendingClip, "attempts" | "createdAt">) {
    const full: PendingClip = { ...item, attempts: 0, createdAt: Date.now() };
    this.items.set(full.id, full);
    this.failed.delete(full.id);
    await idbPut(full);
    this.emit();
    void this.process();
  }

  /** Resolves when every queued clip has uploaded (or given up). */
  async drain(timeoutMs = 120_000): Promise<{ ok: boolean; failed: number }> {
    const start = Date.now();
    void this.process();
    while (this.items.size > 0 && Date.now() - start < timeoutMs) {
      if ([...this.items.keys()].every((id) => this.failed.has(id))) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    return { ok: this.items.size === 0, failed: this.items.size };
  }

  retryFailed() {
    for (const id of this.failed) {
      const it = this.items.get(id);
      if (it) it.attempts = 0;
    }
    this.failed.clear();
    this.emit();
    void this.process();
  }

  private async process() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const next = [...this.items.values()].filter((i) => !this.failed.has(i.id)).sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next) break;
        try {
          await this.upload(next);
          this.items.delete(next.id);
          await idbDelete(next.id);
        } catch (e) {
          next.attempts += 1;
          if (next.attempts >= 4) {
            this.failed.add(next.id);
            console.warn("clip upload failed", e);
          } else {
            await new Promise((r) => setTimeout(r, 1500 * next.attempts));
          }
        }
        this.emit();
      }
    } finally {
      this.running = false;
      this.emit();
    }
  }

  private async upload(item: PendingClip) {
    const supabase = createClient();
    const ext = extensionFor(item.mime);
    const path = `${item.userId}/${item.ymd}/${item.exerciseKey}-set${item.setNumber}.${ext}`;
    const { error } = await supabase.storage.from("sessions").upload(path, item.blob, {
      contentType: item.mime.split(";")[0],
      upsert: true,
    });
    if (error) throw new Error(error.message);
    const res = await fetch(`/api/session/${item.sessionId}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        liftId: item.liftId,
        setNumber: item.setNumber,
        storagePath: path,
        mime: item.mime.split(";")[0],
        bytes: item.blob.size,
        durationMs: item.durationMs,
        trimmedMs: item.trimmedMs,
      }),
    });
    if (!res.ok) throw new Error(`clip row ${res.status}`);
  }
}

export const uploadQueue = new UploadQueue();
