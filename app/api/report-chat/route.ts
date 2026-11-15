import { NextResponse } from "next/server";
import { z } from "zod";
import { loadRun } from "@/lib/agent/replay";
import { generate, hasGemini, type Content } from "@/lib/llm/gemini";
import { cleanWording } from "@/lib/llm/wording";
import { detectAction, fallbackReply, reportFacts } from "@/lib/report-chat";

export const runtime = "nodejs";

const Body = z.object({
  runId: z.string().max(60), shellId: z.string().max(60), tab: z.string().max(30).optional(),
  messages: z.array(z.object({ role: z.enum(["user", "hermit"]), text: z.string().max(2000) })).min(1).max(40),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const { runId, shellId, tab, messages } = parsed.data;
  const run = await loadRun(runId);
  const r = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])).find((x) => x.shellId === shellId);
  if (!run || !r) return NextResponse.json({ reply: "I can't find this report on the server, so I can't answer about it." });
  const facts = reportFacts(r, run.spec);
  const last = messages[messages.length - 1];
  const isQuestion = /\?|\bhow\b|\bwhat\b|\btotal\b/i.test(last.text);
  const action = last.role === "user" && !isQuestion ? detectAction(last.text) : undefined;
  const done = action?.type === "save" ? "Saved." : action ? `Opening ${action.tab}.` : null;
  if (action && done) return NextResponse.json({ reply: done, action });

  let reply = fallbackReply(last.text, facts);
  if (hasGemini()) {
    try {
      const contents: Content[] = messages.slice(-10).map((m) => ({ role: m.role === "hermit" ? "model" : "user", parts: [{ text: m.text }] }));
      const out = await generate({
        systemInstruction: { parts: [{ text: `You are Hermit, helping a small-business owner with one commercial space. Answer ONLY from FACTS (JSON). Plain, short sentences (at most 4). For any total or sum, show the math. Use only numbers in FACTS; if something is null or missing say "not on record" and suggest asking the broker. Never invent numbers. Never say "compliant" or "guaranteed".${done ? ` The app is already doing this for the user: ${done}` : ""} The user is on the ${tab ?? "overview"} tab.\nFACTS: ${JSON.stringify(facts)}` }] },
        contents, generationConfig: { temperature: 0.3 },
      }, 12_000);
      const text = out.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      if (text) reply = cleanWording(text);
    } catch { /* keep the deterministic reply */ }
  }
  return NextResponse.json({ reply: done ? `${done} ${reply}` : reply, ...(action ? { action } : {}) });
}
