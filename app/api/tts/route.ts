import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

// Cap length so one click can't burn the character budget.
const Body = z.object({ text: z.string().min(1).max(2500) });

export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY, voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return NextResponse.json({ error: "Text-to-speech is not configured" }, { status: 503 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues }, { status: 400 });
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: p.data.text, model_id: "eleven_flash_v2_5" }),
  });
  if (!r.ok || !r.body) return NextResponse.json({ error: `ElevenLabs ${r.status}` }, { status: 502 });
  return new Response(r.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
