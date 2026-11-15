import type { ShellReport } from "../types";

const SID = /^[A-Za-z0-9]{6,20}$/;

export function tourUrl(sid: string, sweepIndex?: number): string {
  if (!SID.test(sid)) throw new Error("not a Matterport sid");
  return `https://my.matterport.com/show/?m=${sid}&play=1&qs=1&brand=0${sweepIndex != null ? `&ss=${sweepIndex}` : ""}`;
}

export type TourStep = { text: string; sweep?: number; room?: string };

// Hermit narrates where each requested room lands, like an agent on a showing.
export function tourSteps(report: ShellReport, furniture: Record<string, string[]> = {}): TourStep[] {
  const g = report.floorplan;
  const panoIndex = (id?: string) => { const l = g?.panos?.find((p) => p.id === id)?.label; return l && /^\d+$/.test(l) ? Number(l) : undefined; };
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  const steps: TourStep[] = [{ text: `Welcome to ${report.name.split(" · ")[0]}! Let me show you where everything you need would go.`, sweep: panoIndex(report.inside?.sweepId) }];
  for (const a of report.fit.assignment) {
    const name = a.req.replace(/\s*#(\d+)/, " $1");
    if (!a.roomId) { steps.push({ text: `Your ${name} isn't built here yet. The full report prices that work.`, room: name }); continue; }
    const room = g?.rooms.find((r) => r.id === a.roomId);
    const items = [...new Set(furniture[a.req.replace(/ #\d+$/, "")] ?? [])];
    const area = room?.areaSqft ? ` It's about ${Math.round(room.areaSqft).toLocaleString()} sq ft.` : "";
    steps.push({ text: `This is where your ${name} would go.${area}${items.length ? ` Picture your ${list(items)} right here.` : ""}`, sweep: room?.sweeps?.[0]?.index ?? panoIndex(room?.panoId), room: name });
  }
  steps.push({ text: report.unknowns.length ? `That's the tour! I couldn't see ${report.unknowns.length} things from the scan. They're questions for the landlord in the full report.` : "That's the tour! Look around on your own as long as you like." });
  return steps;
}
