import { NextResponse } from "next/server";
import { withUser } from "@/lib/api";
import { getSessionById } from "@/lib/session/service";

export const GET = withUser(async ({ db, user, params }) => {
  const bundle = await getSessionById(db, user.id, params.id);
  if (!bundle) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json(bundle);
});
