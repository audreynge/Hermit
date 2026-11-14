import { NextResponse } from "next/server";

export const runtime = "nodejs";

// ~2 min of compressed browser audio; keeps one recording from burning the STT budget.
const MAX_BYTES = 4_000_000;

export async function POST(req: Request) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return NextResponse.json({ error: "Speech-to-text is not configured" }, { status: 503 });
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || !audio.size) return NextResponse.json({ error: "Missing audio" }, { status: 400 });
  if (audio.size > MAX_BYTES) return NextResponse.json({ error: "Recording too long" }, { status: 413 });
  const body = new FormData();
  body.append("model_id", "scribe_v2");
  body.append("file", audio, "speech.webm");
  const r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", { method: "POST", headers: { "xi-api-key": key }, body });
  if (!r.ok) return NextResponse.json({ error: `ElevenLabs ${r.status}` }, { status: 502 });
  const { text } = (await r.json()) as { text?: string };
  return NextResponse.json({ text: (text ?? "").trim() });
}
