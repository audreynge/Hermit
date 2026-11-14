import { z } from "zod";
import { City, RequirementSpec } from "../types";

export const Draft = RequirementSpec.omit({ city: true }).extend({ city: City.optional(), useType: z.string() });
export const ChatStateSchema = z.object({ spec: Draft, asked: z.array(z.enum(["use", "city", "size", "rooms", "musts", "chair"])).max(10), phase: z.enum(["gathering", "results"]) });
export const StoredMsgSchema = z.object({
  role: z.enum(["user", "bot"]),
  kind: z.enum(["text", "thinking", "compare", "design", "results", "regulations"]),
  payload: z.unknown(),
});
