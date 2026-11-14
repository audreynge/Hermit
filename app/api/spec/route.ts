import { NextResponse } from "next/server";
import { z } from "zod";
import { fromLayout } from "@/lib/spec/parse";
import { specFromText } from "@/lib/spec/llm";
import { City, Mode, RequirementSpec } from "@/lib/types";

const Body = z.object({
  text: z.string().max(2000).optional(),
  input: z.enum(["text", "voice", "survey", "layout"]).default("text"),
  survey: RequirementSpec.partial().default({}),
  layout: z.array(z.object({ id: z.string(), label: z.string().min(1), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() })).max(40).optional(),
  defaults: z.object({ city: City.optional(), mode: Mode.optional() }).default({}),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const { text, input, survey, layout, defaults } = parsed.data;
  const base = { mode: survey.mode ?? defaults.mode ?? "business", city: survey.city ?? defaults.city ?? "los_angeles", useType: survey.useType || "office" };

  let spec: RequirementSpec;
  if (input === "layout" && layout?.length) spec = { ...fromLayout(layout, base), ...pickSurvey(survey) };
  else if ((input === "text" || input === "voice") && text?.trim()) {
    const fromText = await specFromText(text, defaults);
    const { mode: _m, city: _c, ...rest } = pickSurvey(survey);
    spec = { ...fromText, ...rest, input };
  } else spec = RequirementSpec.parse({ ...base, ...survey, input: "survey" });

  const ok = RequirementSpec.safeParse(spec);
  return ok.success ? NextResponse.json(ok.data) : NextResponse.json({ error: ok.error.issues }, { status: 422 });
}

// Survey answers win over inferred values, except city/mode, which text names more precisely than a defaulted dropdown.
function pickSurvey(s: Partial<RequirementSpec>): Partial<RequirementSpec> {
  const out = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && v !== "" && !["rooms", "needs", "priorities", "input"].includes(k)));
  return { ...out, ...(s.needs && Object.keys(s.needs).length ? { needs: s.needs } : {}) } as Partial<RequirementSpec>;
}
