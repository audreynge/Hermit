import { completeSignIn, isLoopback } from "@/lib/llm/openai";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isLoopback(req)) return new Response("not found", { status: 404 });
  try {
    const back = new URL(await completeSignIn(new URL(req.url).searchParams));
    back.searchParams.set("ai", "connected");
    return Response.redirect(back, 302);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sign-in failed.";
    return new Response(`<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><p>${msg.replace(/[<&>]/g, "")}</p><p><a href="/">Back to Hermit</a></p>`, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}
