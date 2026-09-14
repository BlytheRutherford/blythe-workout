import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/server";

/** Deletes the user's videos, then the auth user (cascades to every row). */
export const POST = withUser(async ({ db, user }) => {
  const admin = createAdminClient();
  // Storage objects don't cascade; remove sessions/{user}/** and photos/{user}/**.
  for (const bucket of ["sessions", "photos"] as const) {
    const { data: dirs } = await admin.storage.from(bucket).list(user.id, { limit: 1000 });
    for (const d of dirs ?? []) {
      const { data: files } = await admin.storage.from(bucket).list(`${user.id}/${d.name}`, { limit: 1000 });
      const paths = (files ?? []).map((f) => `${user.id}/${d.name}/${f.name}`);
      if (paths.length) await admin.storage.from(bucket).remove(paths);
      if (d.id) await admin.storage.from(bucket).remove([`${user.id}/${d.name}`]);
    }
  }
  const { error } = await db.rpc("delete_own_account");
  if (error) {
    const { error: e2 } = await admin.auth.admin.deleteUser(user.id);
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  }
  await db.auth.signOut();
  return NextResponse.json({ ok: true });
});
