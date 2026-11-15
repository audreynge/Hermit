import { NextResponse } from "next/server";
import { z } from "zod";
import { generateJSON, hasGemini } from "@/lib/llm/gemini";
import { cleanWording } from "@/lib/llm/wording";

export const runtime = "nodejs";

const Body = z.object({ text: z.string().min(40).max(60_000) });
const Out = z.object({
  summary: z.array(z.string()),
  terms: z.object({ length: z.string().nullable(), rent: z.string().nullable(), increases: z.string().nullable(), extraCharges: z.string().nullable(), deposit: z.string().nullable(), personalGuarantee: z.string().nullable() }),
  redFlags: z.array(z.object({ flag: z.string(), why: z.string(), ask: z.string() })),
});

// Red flags we look for even without a model, so the coach works offline.
const RULES: [RegExp, string, string, string][] = [
  [/personal(ly)? guarant/i, "Personal guarantee", "You'd be personally on the hook if the business can't pay.", "Ask to cap it (for example, 12 months of rent) or to burn it off after 2 years of on-time payments."],
  [/\bCAM\b|common area maintenance|operating expenses|NNN|triple net/i, "Extra charges on top of rent (CAM / NNN)", "These can rise every year and aren't in the headline rent.", "Ask for last year's actual charges and a cap on yearly increases."],
  [/escalat|annual increase|increase.{0,20}(percent|%)|CPI/i, "Rent increases", "Rent goes up each year; check by how much.", "Ask for a fixed increase (e.g. 3%) instead of an open-ended one."],
  [/assign|sublet|sublease/i, "Assignment and subletting", "Limits on selling the business or subletting can trap you.", "Ask that consent can't be unreasonably withheld if you sell the business."],
  [/relocat/i, "Relocation clause", "The landlord may be able to move you.", "Ask to remove it, or to have moving costs and build-out covered."],
  [/demolition|terminat.{0,30}(landlord|lessor)/i, "Landlord can end the lease early", "You could lose the space after paying for build-out.", "Ask to remove it or get your unamortized build-out costs back."],
];

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste at least a few sentences of the lease." }, { status: 400 });
  const { text } = parsed.data;
  const rule = RULES.filter(([re]) => re.test(text)).map(([, flag, why, ask]) => ({ flag, why, ask }));
  if (hasGemini()) {
    try {
      const out = await generateJSON(
        `You are a friendly lease coach for a small-business owner. Read the lease text and explain it in plain words. "summary": 3-5 short bullets. "terms": short plain values or null if not stated. "redFlags": anything risky for a tenant (personal guarantee, CAM/NNN charges, escalations, assignment, relocation, early termination, use restrictions), each with why it matters and what to ask for. Never give legal conclusions; this is not legal advice.`,
        [{ role: "user", parts: [{ text: text.slice(0, 40_000) }] }], Out, 20_000);
      if (out) {
        // Add a rule-based flag only when the model didn't already raise the same topic.
        const topic = (t: string) => (/guarant/i.test(t) ? "guarantee" : /cam|nnn|common area|operating/i.test(t) ? "cam" : /escalat|increase/i.test(t) ? "increase" : /assign|sublet|sublease/i.test(t) ? "assign" : /relocat/i.test(t) ? "relocate" : /terminat|demolition/i.test(t) ? "terminate" : t.toLowerCase());
        const seen = new Set(out.redFlags.map((f) => topic(f.flag)));
        return NextResponse.json({ ...out, summary: out.summary.map(cleanWording), redFlags: [...out.redFlags, ...rule.filter((r) => !seen.has(topic(r.flag)))], llm: true });
      }
    } catch { /* rule-based fallback below */ }
  }
  return NextResponse.json({ summary: ["Here are the clauses I spotted. Add an AI key for a full plain-English summary."], terms: { length: null, rent: null, increases: null, extraCharges: null, deposit: null, personalGuarantee: null }, redFlags: rule, llm: false });
}
