import { Hero, type HeroShell } from "@/components/Hero";
import { loadRun } from "@/lib/agent/replay";
import { loadShells } from "@/lib/query/load";
import { an } from "@/lib/text";
import { fitRows } from "@/lib/uses/rooms";

export const dynamic = "force-dynamic";

// A gallery of real shells from the recorded runs: real scans, real measurements, one plain line each.
export default async function Home() {
  const shells: HeroShell[] = [];
  for (const id of ["swap", "clinic", "demo"]) {
    const run = await loadRun(id);
    const reports = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])) ?? [];
    for (const r of reports.slice(0, 1)) {
      // Only rooms the scan labels as that room count as built (same rule as the report's "Will it fit?").
      const { built, convert } = fitRows(r);
      const more = convert.length ? `, and ${convert.length} more could be made from rooms there` : "";
      shells.push({
        id: r.shellId, run: id, name: r.name, city: run!.spec.city === "houston" ? "Houston" : "Los Angeles",
        line: `${built.length} of ${r.fit.assignment.length} rooms already built for ${an(run!.spec.useType)}${more}. About ${r.weeksToOpen[0]}–${r.weeksToOpen[1]} weeks to open.`,
        img: r.floorplan?.floorplan ? `/api/asset/${r.inside?.sid}?kind=floorplan` : "/hermit-logo.svg", alt: `Floor plan of ${r.name}`,
      });
    }
  }
  return <Hero shells={shells} total={loadShells().length} />;
}
