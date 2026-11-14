import { isLoopback, signOut, status } from "@/lib/llm/openai";

export const runtime = "nodejs";

export async function GET(req: Request) {
  return Response.json(status(req));
}

// Disconnect: revoke the refresh token and clear local tokens. Only from this machine.
export async function DELETE(req: Request) {
  if (!isLoopback(req)) return Response.json({ error: "local only" }, { status: 403 });
  return Response.json(await signOut());
}
