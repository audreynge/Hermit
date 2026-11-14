import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { MODEL } from "../agent/loop";
import { RequirementSpec, type City, type Mode } from "../types";
import { parseText } from "./parse";

const n = z.number().nullable();
const b = z.boolean().nullable();
export const LlmSpec = z.object({
  mode: z.enum(["home", "business", "enterprise"]),
  city: z.enum(["los_angeles", "houston"]),
  useType: z.string(),
  sizeMinSqft: n, sizeMaxSqft: n, headcount: n, beds: n, baths: n, budgetMonthly: n, budgetTotal: n,
  rooms: z.array(z.object({ label: z.string(), count: z.number(), minSqft: n, fixtures: z.array(z.string()), hard: z.boolean() })),
  needs: z.object({ kitchen: b, threePhase: b, heavyPower: b, parkingStalls: n, groundFloor: b, stepFree: b, wheelchair: b, outdoorArea: b, driveInBays: n, esfr: b }),
});
type LlmSpec = z.infer<typeof LlmSpec>;

const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)));

export function fromLlm(x: LlmSpec, rawText: string): RequirementSpec {
  const { sizeMinSqft, sizeMaxSqft, rooms, needs, ...rest } = x;
  return RequirementSpec.parse({
    ...clean(rest),
    ...(sizeMinSqft && sizeMaxSqft ? { sizeSqft: [sizeMinSqft, sizeMaxSqft] } : {}),
    rooms: rooms.map((r) => clean(r)),
    needs: clean(needs),
    priorities: {},
    input: "text",
    rawText,
  });
}

type Client = Pick<Anthropic, "messages">;
const PROMPT = `Extract a space-search RequirementSpec from the user's request. Mode: home (a place to live), business (a commercial suite), enterprise (industrial/site requirements).
City must be los_angeles or houston; use the default if the request names neither. Use null for anything the user did not state; do not invent rooms or needs.
Mark a room hard only if the user says it is required. Room labels should be short nouns like "exam room", "office", "bathroom", "reception", "kitchen".`;

export async function specFromText(text: string, defaults: { city?: City; mode?: Mode }, client?: Client | null): Promise<RequirementSpec> {
  const c = client !== undefined ? client : process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  if (c) {
    try {
      const res = await c.messages.parse({
        model: MODEL,
        max_tokens: 2048,
        output_config: { effort: "low", format: zodOutputFormat(LlmSpec) },
        system: PROMPT,
        messages: [{ role: "user", content: `Defaults: ${JSON.stringify(defaults)}\nRequest: ${text}` }],
      });
      if (res.parsed_output) return fromLlm(res.parsed_output, text);
    } catch {
      // fall through to the deterministic parser
    }
  }
  return parseText(text, defaults);
}
