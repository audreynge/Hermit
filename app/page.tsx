import { Hero, type HeroShell } from "@/components/Hero";
import { loadRun } from "@/lib/agent/replay";
import { loadShells } from "@/lib/query/load";

export const dynamic = "force-dynamic";

// A gallery of real shells from the recorded runs: real scans, real measurements, one plain line each.
export default function Home() {
  const shells: HeroShell[] = [];
  for (const id of ["swap", "clinic", "demo"]) {
    const run = loadRun(id);
    const reports = run?.events.flatMap((e) => (e.type === "report" ? e.reports : [])) ?? [];
    for (const r of reports.slice(0, 1)) {
      const built = r.fit.assignment.filter((a) => a.roomId).length;
      shells.push({
        id: r.shellId, run: id, name: r.name, city: run!.spec.city === "houston" ? "Houston" : "Los Angeles",
        line: `${built} of ${r.fit.assignment.length} rooms already built for ${/^[aeiou]/i.test(run!.spec.useType) ? "an" : "a"} ${run!.spec.useType}. About ${r.weeksToOpen[0]}–${r.weeksToOpen[1]} weeks to open.`,
        img: r.floorplan?.floorplan ? `/api/asset/${r.inside?.sid}?kind=floorplan` : "/hermit-logo.svg", alt: `Floor plan of ${r.name}`,
      });
    }
  }
  return <Hero shells={shells} total={loadShells().length} />;
}
