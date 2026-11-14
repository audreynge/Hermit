import fs from "node:fs";
import path from "node:path";

export function dataDir(): string {
  if (process.env.HERMIT_DATA_DIR) return process.env.HERMIT_DATA_DIR;
  const processed = path.join(process.cwd(), "data", "processed");
  return fs.existsSync(processed) ? processed : path.join(process.cwd(), "data", "sample");
}
