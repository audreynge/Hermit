import { authorizeUrl, isLoopback } from "@/lib/llm/openai";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!isLoopback(req)) return new Response("Sign in with ChatGPT is only available on the machine running Hermit.", { status: 403 });
  const back = new URL(req.url).searchParams.get("return") ?? "/";
  return Response.redirect(authorizeUrl(req, back.startsWith("/") && !back.startsWith("//") ? back : "/"), 302);
}
