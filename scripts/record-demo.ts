// Records the dental-clinic demo run as replay "demo" in the active bundle (data/processed if present).
import { runAgent } from "../lib/agent/loop";
import { saveRun } from "../lib/agent/replay";
import { dataDir, loadRoomGraph, loadShells } from "../lib/query/load";
import { parseText } from "../lib/spec/parse";
import type { TraceEvent } from "../lib/types";

const spec = parseText(process.argv[2] ?? "I'm looking for a space for a small medical clinic in Houston. I need about 1,200-1,800 sq ft, with 3 exam rooms, a reception area, and some storage.");
const events: TraceEvent[] = [{ type: "run", id: "run", runId: "demo", replay: false }];
const reports = await runAgent(spec, (e) => events.push(e), { shells: loadShells, graph: loadRoomGraph });
saveRun("demo", spec, events);
console.log(`recorded demo in ${dataDir()}: ${reports.length} reports, ${events.length} events`);
