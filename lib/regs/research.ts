import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import table from "../../rules/screening.json";
import { MODEL } from "../agent/model";
import type { City } from "../types";
import { getCached, putCached } from "./cache";
import { isOfficial, OFFICIAL_DOMAINS } from "./domains";

const Topic = z.enum(["zoning", "business_license", "occupancy", "health", "professional_license", "parking", "accessibility", "fire", "signage"]);
const Extracted = z.object({
  topic: Topic,
  jurisdiction: z.enum(["city", "county", "state", "federal"]),
  requirement: z.string(),
  appliesWhen: z.string(),
  certainty: z.enum(["applies", "may_apply"]),
  url: z.string(),
  citedText: z.string(),
});
export type Finding = z.infer<typeof Extracted> & { retrievedAt: string };
export type RegQuery = { city: City; useType: string; zoning?: string | null };
type Client = Pick<Anthropic, "messages">;

const STATE: Record<City, string> = { los_angeles: "Los Angeles, California (Los Angeles County)", houston: "Houston, Texas (Harris County)" };
const today = () => new Date().toISOString().slice(0, 10);

export function screeningFindings(q: RegQuery): Finding[] {
  const s = table.sources;
  const row = (topic: Finding["topic"], jurisdiction: Finding["jurisdiction"], src: { title: string; url: string }): Finding => ({
    topic, jurisdiction, requirement: src.title, appliesWhen: `opening a ${q.useType}`, certainty: "may_apply", url: src.url, citedText: src.title, retrievedAt: table.reviewed,
  });
  return q.city === "houston"
    ? [row("zoning", "city", s.houston_zoning), row("parking", "city", s.houston_parking), row("occupancy", "city", s.houston_permits), row("accessibility", "federal", s.ada)]
    : [row("zoning", "city", s.lamc_zoning), row("parking", "city", s.lamc_parking), row("parking", "state", s.ab2097), row("occupancy", "city", s.ladbs), row("accessibility", "federal", s.ada)];
}

const SYSTEM = `You research the rules a small business must follow to open in a specific city. Use web search on official government and code sites only.
Cover, where they apply to this use: city zoning/permitted use, city business tax or license, certificate of occupancy / tenant-improvement permits, county or state health permits, state professional or establishment licensing, parking minimums, accessibility (ADA), fire/occupancy limits, and signage.
Write short plain-language notes. For every rule, say which page it came from.`;

export async function researchRegulations(q: RegQuery, client?: Client | null): Promise<{ findings: Finding[]; fromCache: boolean }> {
  const key = `regs:${q.city}:${q.useType.toLowerCase().trim().replace(/\s+/g, " ")}`;
  const cached = await getCached<Finding[]>(key);
  if (cached) return { findings: cached, fromCache: true };
  const c = client !== undefined ? client : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  if (!c) return { findings: screeningFindings(q), fromCache: false };

  try {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Business: ${q.useType}\nLocation: ${STATE[q.city]}${q.zoning ? `\nParcel zoning: ${q.zoning}` : ""}` }];
    const urls = new Set<string>();
    let notes = "";
    for (let turn = 0; turn < 3; turn++) {
      const res = await c.messages.create({
        model: MODEL, max_tokens: 8000, system: SYSTEM, messages,
        output_config: { effort: "medium" },
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6, allowed_domains: OFFICIAL_DOMAINS }],
      } as Anthropic.MessageCreateParamsNonStreaming, { timeout: 20_000 });
      for (const b of res.content as { type: string; text?: string; content?: unknown }[]) {
        if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content as { url?: string }[]) if (r.url) urls.add(r.url);
        if (b.type === "text" && b.text) notes += `${b.text}\n`;
      }
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content });
    }
    if (!urls.size) return { findings: screeningFindings(q), fromCache: false };

    const parsed = await c.messages.parse({
      model: MODEL, max_tokens: 4096,
      output_config: { effort: "low", format: zodOutputFormat(z.object({ findings: z.array(Extracted) })) },
      messages: [{ role: "user", content: `Research notes:\n${notes}\nSource URLs you may cite (copy exactly, use no others):\n${[...urls].join("\n")}\n\nList each rule that applies or may apply to a ${q.useType} in ${STATE[q.city]}. Quote the supporting sentence in citedText.` }],
    });
    const findings = (parsed.parsed_output?.findings ?? [])
      .filter((f) => urls.has(f.url) && isOfficial(f.url))
      .map((f) => ({ ...f, retrievedAt: today() }));
    // Every finding can fail the citation gate; show the screening rules then, and retry research next time.
    if (!findings.length) return { findings: screeningFindings(q), fromCache: false };
    await putCached(key, findings, 30);
    return { findings, fromCache: false };
  } catch {
    return { findings: screeningFindings(q), fromCache: false };
  }
}
