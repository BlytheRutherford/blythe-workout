"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Lift {
  key: string;
  name: string;
  current: { updatedAt: string; bytes: number | null } | null;
}

export function FormVideoList({ lifts: initial }: { lifts: Lift[] }) {
  const [lifts, setLifts] = useState(initial);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const targetKey = useRef<string | null>(null);

  function pick(key: string) {
    targetKey.current = key;
    inputRef.current?.click();
  }

  async function upload(file: File) {
    const key = targetKey.current;
    if (!key) return;
    setBusyKey(key);
    setError(null);
    try {
      const ext = file.type.includes("webm") ? "webm" : file.type.includes("quicktime") ? "mov" : "mp4";
      const path = `${key}.${ext}`;
      const supabase = createClient();
      const { error: upErr } = await supabase.storage.from("form").upload(path, file, { contentType: file.type || "video/mp4", upsert: true });
      if (upErr) throw new Error(upErr.message);
      const res = await fetch("/api/admin/form-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseKey: key, storagePath: path, mime: file.type || "video/mp4", bytes: file.size }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save.");
      setLifts((ls) => ls.map((l) => (l.key === key ? { ...l, current: { updatedAt: new Date().toISOString(), bytes: file.size } } : l)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyKey(null);
      targetKey.current = null;
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      {error && <p className="caption mb-3">{error}</p>}
      <ul>
        {lifts.map((l) => (
          <li key={l.key} className="hairline-row">
            <div>
              <div className="text-bone">{l.name}</div>
              <div className="faint">{l.current ? `${(l.current.bytes ?? 0) / 1e6 > 0 ? ((l.current.bytes ?? 0) / 1e6).toFixed(1) + " MB · " : ""}${new Date(l.current.updatedAt).toLocaleDateString()}` : "none"}</div>
            </div>
            <button type="button" className="link whitespace-nowrap" onClick={() => pick(l.key)} disabled={busyKey !== null}>
              {busyKey === l.key ? "Uploading…" : l.current ? "Replace" : "Set"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
