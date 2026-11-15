// Sanity check for the LEHD daytime-worker proxy at well-known places (dense downtowns should dwarf suburbs).
import { workersNear } from "../lib/neighborhood/build";
const spots: [string, number, number, string][] = [
  ["Downtown Houston", 29.7577, -95.3655, "houston"], ["Houston suburb (Cypress)", 29.9691, -95.6972, "houston"],
  ["Downtown LA", 34.0522, -118.2551, "los_angeles"], ["Westwood", 34.0617, -118.4452, "los_angeles"],
];
for (const [n, lat, lon, c] of spots) console.log(`${n}: ${workersNear(c, lat, lon)?.jobs.toLocaleString()} jobs within 800 m`);
