import { z } from "zod";
import { getShell, isSafeId, loadRoomGraph, loadShells } from "../query/load";
import { searchShells } from "../query/shells";
import type { Draft } from "../spec/survey";
import type { RequirementSpec } from "../types";
import type { EditContext } from "./edit";
import { FitoutOp, PlainLabel } from "./fitout";

// Request shapes shared by /api/chat and /api/fitout. Client data is untrusted: bounded sizes, safe ids.
export const BlockIn = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/), label: PlainLabel, kind: z.enum(["room", "object"]).optional(),
  x: z.number().finite(), y: z.number().finite(), w: z.number().finite().positive(), h: z.number().finite().positive(),
});
export const LayoutIn = z.array(BlockIn).max(200);
export const FitoutIn = z.object({ shellId: z.string().refine(isSafeId, "bad shell id"), ops: z.array(FitoutOp).max(50) });

/** Loads the selected space for fit-out edits. Returns an error message when it can't be edited. */
export function fitoutContext(shellId: string, kept: z.infer<typeof FitoutOp>[], spec: Draft): NonNullable<EditContext["fitout"]> | { error: string } {
  const shell = getShell(shellId);
  if (!shell) return { error: "not found" };
  const graph = shell.sid ? loadRoomGraph(shell.sid) : null;
  if (!graph || !graph.rooms.length) return { error: "no scan to edit: this space is record-only" };
  const hit = spec.city && spec.useType ? searchShells(spec as RequirementSpec, loadShells()).results.find((c) => c.shell.id === shellId) : undefined;
  return { shell, graph, ops: kept, search: hit ? { score: hit.score, reasons: hit.reasons } : { score: 50, reasons: [] } };
}
