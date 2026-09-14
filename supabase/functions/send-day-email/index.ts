// Supabase Edge Function: sends the "Day N of Blythe Workouts" email via Resend.
// Deployed with --no-verify-jwt; callers must present x-bw-secret = EDGE_FUNCTION_SECRET.
// Secrets: RESEND_API_KEY, EMAIL_FROM, EDGE_FUNCTION_SECRET

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("EDGE_FUNCTION_SECRET") ?? "";
  if (!secret || req.headers.get("x-bw-secret") !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return new Response(JSON.stringify({ error: "RESEND_API_KEY missing" }), { status: 500 });
  const from = Deno.env.get("EMAIL_FROM") || "Blythe Workout <onboarding@resend.dev>";

  let body: { to: string; subject: string; html: string; text?: string; attachment?: { filename: string; content: string } | null };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  if (!body.to || !body.subject || !body.html) return new Response(JSON.stringify({ error: "to, subject, html required" }), { status: 400 });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [body.to],
      subject: body.subject,
      html: body.html,
      text: body.text,
      attachments: body.attachment ? [body.attachment] : undefined,
    }),
  });
  const text = await res.text();
  return new Response(text, { status: res.ok ? 200 : res.status, headers: { "Content-Type": "application/json" } });
});
