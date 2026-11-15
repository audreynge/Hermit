import { z } from "zod";
import { fromLayout, type Block } from "../spec/parse";
import type { Draft } from "../spec/survey";
import type { RequirementSpec, RoomGraph, Shell } from "../types";
import { applyFitout, describeGraph, evaluateFitout, type FitoutEvaluation, type FitoutOp } from "./fitout";
import { applyLayoutOps, describeLayout, SIDES, type Rejected } from "./layout-ops";

/** Model-facing op: one flat object so it works with any structured-output backend. Validated strictly afterwards. */
export const FlatOp = z.object({
  op: z.enum(["add", "remove", "resize", "relabel", "add_object", "move", "use_as", "merge", "split", "add_fixture"]),
  id: z.string().optional(), label: z.string().optional(), count: z.number().optional(), w: z.number().optional(), h: z.number().optional(), scale: z.number().optional(),
  nextTo: z.string().optional(), in: z.string().optional(), roomId: z.string().optional(), roomIds: z.array(z.string()).optional(), into: z.number().optional(),
  fixture: z.string().optional(), side: z.enum(SIDES).optional(),
});
export const EditOut = z.object({ target: z.enum(["none", "layout", "fitout", "ask"]), ops: z.array(FlatOp) });
export type EditOut = z.infer<typeof EditOut>;

/** Drops nulls/empty arrays so the strict LayoutOp/FitoutOp schemas see only what the model actually set. */
export const unflatten = <T extends object>(ops: T[]) =>
  ops.map((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))));

export type EditContext = {
  layout?: Block[] | null;
  fitout?: { shell: Shell; graph: RoomGraph; ops: FitoutOp[]; search?: { score: number; reasons: string[] } } | null;
};

const searchable = (s: Draft): s is RequirementSpec => !!s.city && !!s.useType;

export function promptContext(ctx: EditContext, spec: Draft): string {
  const parts: string[] = [];
  if (ctx.layout) parts.push(`LAYOUT (the user's own drawn floor plan; ids are block ids):\n${describeLayout(ctx.layout)}`);
  const f = ctx.fitout;
  if (f) {
    // Describe what the user is looking at: the measured scan plus the changes they already kept.
    const current = f.ops.length ? applyFitout(f.graph, f.ops).graph : f.graph;
    const ev = searchable(spec) ? evaluateFitout(spec, f.shell, f.graph, [], f.search, f.ops) : null;
    parts.push(`SELECTED SPACE (a real scanned space, "${f.shell.name}"; ids are room ids${f.ops.length ? "; includes changes already kept" : ""}):\n${describeGraph(current)}` +
      (ev ? `\nCurrent fit ${ev.after.fit.score}/100. Still to do: ${ev.after.fit.edits.join("; ") || "nothing"}.${ev.after.fit.hardFails.length ? ` Hard fails: ${ev.after.fit.hardFails.join("; ")}.` : ""}` : ""));
  }
  return parts.join("\n\n");
}

export type EditOutcome =
  | { kind: "layout"; blocks: Block[]; spec: Draft; applied: unknown[]; rejected: Rejected[]; notes: string[] }
  | { kind: "fitout"; shellId: string; evaluation: FitoutEvaluation; ops: FitoutOp[]; rejected: Rejected[]; notes: string[] };

/** Applies the model's (or the offline parser's) ops to the right design. Returns null when nothing could apply. */
export function resolveEdit(target: "layout" | "fitout", ops: unknown[], ctx: EditContext, spec: Draft): EditOutcome | null {
  if (target === "layout") {
    if (!ctx.layout) return null;
    const r = applyLayoutOps(ctx.layout, ops);
    const s = fromLayout(r.blocks, { mode: spec.mode, city: spec.city ?? "houston", useType: spec.useType || "office" });
    const next: Draft = { ...spec, rooms: s.rooms, ...(s.rooms.length ? { sizeSqft: s.sizeSqft } : {}) };
    return { kind: "layout", blocks: r.blocks, spec: next, applied: r.applied, rejected: r.rejected, notes: r.notes };
  }
  if (!ctx.fitout || !searchable(spec)) return null;
  const f = ctx.fitout;
  const evaluation = evaluateFitout(spec, f.shell, f.graph, ops, f.search, f.ops);
  return { kind: "fitout", shellId: f.shell.id, evaluation, ops: evaluation.ops, rejected: evaluation.rejected, notes: evaluation.notes };
}

const money = (n: number) => `$${Math.round(n / 1000)}k`;
/** "$6k–$18k", or "none" for a zero range (not "$0k–$0k"). */
const workRange = ([lo, hi]: readonly number[]) => (hi ? `${money(lo)}–${money(hi)}` : "none");

/** Deterministic summary of what changed, so numbers in the chat come from code, never from the model. */
export function describeOutcome(o: EditOutcome, before: number): string {
  const lines: string[] = [];
  if (o.kind === "layout") {
    const n = o.applied.length;
    if (n) lines.push(`Updated your layout (${n} change${n > 1 ? "s" : ""}). It now has ${o.blocks.filter((b) => b.kind !== "object").length} rooms, about ${Math.round(o.blocks.filter((b) => b.kind !== "object").reduce((s, b) => s + b.w * b.h, 0)).toLocaleString()} sq ft.`);
  } else {
    const d = o.evaluation.diff;
    if (o.ops.length > before) lines.push(`Proposed changes: ${d.fit[1] > d.fit[0] ? "fits better" : d.fit[1] < d.fit[0] ? "fits worse" : "same fit"}, known work ${workRange(d.cost[1])} (was ${workRange(d.cost[0])}), ${d.weeks[1][0]}–${d.weeks[1][1]} weeks to open. These are proposals, not measured rooms.`);
    if (d.hardFailsCleared.length) lines.push(`Clears: ${d.hardFailsCleared.join("; ")}.`);
  }
  lines.push(...o.notes);
  if (o.rejected.length) lines.push(`I couldn't do ${o.rejected.length === 1 ? "one change" : `${o.rejected.length} changes`}: ${o.rejected.map((r) => r.reason).join("; ")}.`);
  if (o.rejected.some((r) => /^there's no (room|block)/.test(r.reason))) lines.push("Which room did you mean?");
  return lines.join(" ");
}
