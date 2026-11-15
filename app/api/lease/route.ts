import { NextResponse } from "next/server";
import { z } from "zod";
import { generate, generateJSON, hasGemini, type Content, type Part } from "@/lib/llm/gemini";
import { cleanWording } from "@/lib/llm/wording";
import { MAX_PDF_BYTES, extractPdfText, flagTopic, ruleFlags, searchLease } from "@/lib/lease";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  text: z.string().max(60_000).optional(),
  pdf: z.string().max(Math.ceil(MAX_PDF_BYTES * 4 / 3) + 16).optional(),
  filename: z.string().max(200).optional(),
  question: z.string().min(2).max(500).optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(12).optional(),
});
const Out = z.object({
  text: z.string(),
  keyPoints: z.array(z.string()),
  summary: z.array(z.string()),
  terms: z.object({ length: z.string().nullable(), rent: z.string().nullable(), increases: z.string().nullable(), extraCharges: z.string().nullable(), deposit: z.string().nullable(), personalGuarantee: z.string().nullable() }),
  redFlags: z.array(z.object({ flag: z.string(), why: z.string(), ask: z.string() })),
});

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const NO_TEXT = "I couldn't read text out of that PDF (it may be a scan). Paste the lease text instead.";

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("That file or text is too large or malformed. PDFs can be up to 3 MB; too big? Paste the text instead.");
  const { pdf, question, history = [] } = parsed.data;
  let text = parsed.data.text?.trim() ?? "";
  const gem = hasGemini();
  if (question) {
    if (text.length < 40) return bad("Analyze the lease first, or paste the lease text.");
    if (gem) {
      try {
        const contents: Content[] = [
          { role: "user", parts: [{ text: `THE LEASE:\n${text.slice(0, 40_000)}` }] },
          ...history.map((h): Content => ({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] })),
          { role: "user", parts: [{ text: question }] },
        ];
        const { parts } = await generate({
          systemInstruction: { parts: [{ text: `You answer a small-business tenant's questions about THE LEASE in plain, short English. Use only what the lease says. Cite the clause or section (for example "Section 12.2") when you can. If the lease doesn't address it, say "Not stated in this lease." and say what to ask the landlord. Do not add legal disclaimers.` }] },
          contents, generationConfig: { temperature: 0.2 },
        }, 30_000);
        const answer = parts.filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
        if (answer) return NextResponse.json({ answer: cleanWording(answer), llm: true });
      } catch { /* keyword fallback below */ }
    }
    const hits = searchLease(text, question);
    return NextResponse.json({ answer: hits.length ? `Closest parts of the lease:\n${hits.map((h) => `• ${h}`).join("\n")}` : "Not stated in this lease, as far as I can find. Try different words, or ask the landlord.", llm: false });
  }

  let pdfPart: Part | null = null;
  let buf: Buffer | null = null;
  if (pdf) {
    buf = Buffer.from(pdf, "base64");
    if (buf.length > MAX_PDF_BYTES) return bad("That PDF is too big (3 MB max). Paste the text instead.");
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return bad("That doesn't look like a PDF.");
    pdfPart = { inlineData: { mimeType: "application/pdf", data: pdf } };
  } else if (text.length < 40) return bad("Paste at least a few sentences of the lease, or upload a PDF.");
  const doc: Part[] = pdfPart && gem ? [pdfPart] : [{ text: text.slice(0, 40_000) }];
  const rules = () => ruleFlags(text);
  if (gem) {
    try {
      const out = await generateJSON(
        `You are a friendly lease coach for a small-business owner. Read the lease and explain it in plain words. "text": the lease's plain text (at most 40000 characters; copy it faithfully, do not summarize). "keyPoints": 5-8 plain bullets of what matters most (rent, length, extra charges, increases, guarantee, who fixes what, how to get out), each one sentence with real numbers when stated. "summary": 3-5 short bullets. "terms": short plain values or null if not stated. "redFlags": anything risky for a tenant (personal guarantee, CAM/NNN charges, escalations, assignment, relocation, early termination, use restrictions), each with why it matters and what to ask for. Never give legal conclusions; this is not legal advice.`,
        [{ role: "user", parts: doc }], Out, 45_000);
      if (out) {
        if (pdfPart) text = out.text.trim();
        const seen = new Set(out.redFlags.map((f) => flagTopic(f.flag)));
        return NextResponse.json({ ...out, text: text.slice(0, 40_000), keyPoints: out.keyPoints.slice(0, 8).map(cleanWording), summary: out.summary.map(cleanWording), redFlags: [...out.redFlags, ...rules().filter((r) => !seen.has(flagTopic(r.flag)))], llm: true });
      }
    } catch { /* rule-based fallback below */ }
  }
  if (buf) text = extractPdfText(buf);
  if (!text) return bad(NO_TEXT);
  return NextResponse.json({
    keyPoints: [], summary: ["Here are the clauses I spotted. Add an AI key for a full plain-English summary."],
    terms: { length: null, rent: null, increases: null, extraCharges: null, deposit: null, personalGuarantee: null }, redFlags: rules(), text: text.slice(0, 40_000), llm: false,
  });
}
