// Demo prompts with a recorded run (scripts/record-demo.ts): sending one replays that run instead of searching live.
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const RUNS: [string, string][] = [
  ["medbill", "We need a new office in Houston for our medical billing company, which has outgrown its current space. We want to lease 4,800 to 5,800 square feet for 25 employees, ideally in a medical office building since our clients are doctors. We need a reception area, 3 private offices, 1 conference room, 2 kitchens, 2 storage rooms for paper records and 2 bathrooms, with the rest as an open work area for our billing team. We need on-site parking for 25 cars and an elevator. We don't have walk-in customers. Our budget is about \$12,000 a month for rent, and we'd like to move in within 1 to 3 months on a 3 to 5 year lease. That's everything, so search now."],
];
const BY_TEXT = new Map(RUNS.map(([id, text]) => [norm(text), id]));

export const cachedRun = (text: string): string | undefined => BY_TEXT.get(norm(text));
