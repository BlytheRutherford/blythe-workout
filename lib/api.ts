import { NextResponse } from "next/server";
import { createClient, currentUser } from "@/lib/supabase/server";
import { ServiceError } from "@/lib/session/service";

type Handler = (ctx: {
  db: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email: string };
  request: Request;
  params: Record<string, string>;
}) => Promise<Response>;

/** Wraps a route handler with auth + error mapping. */
export function withUser(handler: Handler) {
  return async (request: Request, ctx?: { params: Promise<Record<string, string>> }) => {
    try {
      const user = await currentUser();
      if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
      const db = await createClient();
      const params = ctx?.params ? await ctx.params : {};
      return await handler({ db, user, request, params });
    } catch (e) {
      if (e instanceof ServiceError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error(e);
      return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    }
  };
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ServiceError("Invalid JSON body.", 400);
  }
}
