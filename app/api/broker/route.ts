import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJSON, hasGemini } from "@/lib/llm/gemini";
import { ASK, emptyProfile, nextAsk, parseAnswer, type AskField, type Profile } from "@/lib/packet";

export const runtime = "nodejs";

const str = z.string().max(2000);
const ProfileIn = z.object({
  business: str, concept: str, useClause: str, years: str, trackRecord: str, cash: z.number().nonnegative(), reserveMonths: z.number().nonnegative(),
  financing: str, guarantee: z.enum(["yes", "capped", "no", ""]), contactName: str, email: str, phone: str, moveIn: str, leaseTerm: str,
}).partial();
const Body = z.object({
  step: z.literal("next"),
  profile: ProfileIn.default({}),
  spec: z.object({ useType: z.string().max(80).default("business"), transaction: z.enum(["lease", "buy"]).optional(), mode: z.string().max(20).optional(), rawText: z.string().max(4000).optional() }),
  report: z.object({ name: z.string().max(300), address: z.string().max(300).optional() }).optional(),
  field: z.enum(ASK.map((a) => a.field) as [AskField, ...AskField[]]).optional(),
  answer: z.string().max(500).optional(),
  skipped: z.array(z.string().max(20)).max(ASK.length).default([]),
  seed: z.boolean().optional(),
});

const s = z.string().nullable();
const Extract = z.object({
  business: s, contactName: s, email: s, phone: s, moveIn: s, leaseTerm: s, years: s, trackRecord: s, concept: s,
  cash: z.number().nullable(), reserveMonths: z.number().nullable(), financing: s, guarantee: z.enum(["yes", "capped", "no"]).nullable(),
});

async function extract(text: string, context: string): Promise<Partial<Profile> | null> {
  const out = await generateJSON(
    `You fill in a small-business owner's tenant packet for a commercial lease. ${context} Extract only fields the text clearly states; use null for everything else. cash is US dollars as a number (80k = 80000). reserveMonths is months of rent they could cover. guarantee is whether they'd give a personal guarantee. years is time in the trade (e.g. "6 years"); trackRecord is where they've worked. Keep wording short and in their words.`,
    [{ role: "user", parts: [{ text }] }], Extract, 12_000);
  if (!out) return null;
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== null && v !== "" && v !== 0)) as Partial<Profile>;
}

const ask = (a: (typeof ASK)[number] | null) => (a ? { field: a.field, text: a.q, hint: a.hint } : null);

// One turn of the "Your details" chat: read the answer (Gemini, else a simple parser), then ask the next missing field.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });
  const { profile, spec, report, field, answer, skipped, seed } = parsed.data;
  let p: Profile = { ...emptyProfile(spec), ...profile };
  const where = report ? `They're asking about ${report.name}${report.address ? ` (${report.address})` : ""} for a ${spec.useType}.` : `They run a ${spec.useType}.`;

  if (field && answer?.trim()) {
    const meta = ASK.find((a) => a.field === field)!;
    // Contact details never go to the model; the parser handles them exactly.
    const ai = hasGemini() && field !== "email" && field !== "phone" ? await extract(answer, `${where} They were just asked: "${meta.q}"`) : null;
    const got = ai?.[field] ? { [field]: ai[field] } : parseAnswer(field, answer);
    if (ai) p = { ...p, ...ai };
    if (!got) return NextResponse.json({ question: ask(meta), done: false, profile: p, note: `Sorry, I didn't catch that. Try something like "${meta.hint}", or skip it.` });
    p = { ...p, ...got };
  } else if (seed && spec.rawText && hasGemini()) {
    const got = await extract(spec.rawText, `${where} This is how they first described what they need.`);
    for (const [k, v] of Object.entries(got ?? {}) as [keyof Profile, never][]) if (!p[k]) p = { ...p, [k]: v };
  }

  const next = nextAsk(p, spec, skipped);
  return NextResponse.json({ question: ask(next), done: !next, profile: p });
}
