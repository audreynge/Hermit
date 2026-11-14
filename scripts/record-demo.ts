// Records the dental-clinic demo run as replay "demo" in the active bundle (data/processed if present).
import { runAgent } from "../lib/agent/loop";
import { saveRun } from "../lib/agent/replay";
import { dataDir, loadRoomGraph, loadShells } from "../lib/query/load";
import { parseText } from "../lib/spec/parse";
import type { TraceEvent } from "../lib/types";

const spec = parseText(process.argv[2] ?? "Dental clinic in Houston, 2,000-3,000 sq ft, 3 exam rooms with sinks, a waiting room, 2 restrooms, wheelchair accessible");
const events: TraceEvent[] = [{ type: "run", id: "run", runId: "demo", replay: false }];
const reports = await runAgent(spec, (e) => events.push(e), { shells: loadShells, graph: loadRoomGraph });
saveRun("demo", spec, events);
console.log(`recorded demo in ${dataDir()}: ${reports.length} reports, ${events.length} events`);
