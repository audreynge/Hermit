import { inflateSync } from "node:zlib";

export const MAX_PDF_BYTES = 3 * 1024 * 1024;

// Red flags we look for even without a model, so the coach works offline.
export const RULES: [RegExp, string, string, string][] = [
  [/personal(ly)? guarant/i, "Personal guarantee", "You'd be personally on the hook if the business can't pay.", "Ask to cap it (for example, 12 months of rent) or to burn it off after 2 years of on-time payments."],
  [/\bCAM\b|common area maintenance|operating expenses|NNN|triple net/i, "Extra charges on top of rent (CAM / NNN)", "These can rise every year and aren't in the headline rent.", "Ask for last year's actual charges and a cap on yearly increases."],
  [/escalat|annual increase|increase.{0,20}(percent|%)|CPI/i, "Rent increases", "Rent goes up each year; check by how much.", "Ask for a fixed increase (e.g. 3%) instead of an open-ended one."],
  [/assign|sublet|sublease/i, "Assignment and subletting", "Limits on selling the business or subletting can trap you.", "Ask that consent can't be unreasonably withheld if you sell the business."],
  [/relocat/i, "Relocation clause", "The landlord may be able to move you.", "Ask to remove it, or to have moving costs and build-out covered."],
  [/demolition|terminat.{0,30}(landlord|lessor)/i, "Landlord can end the lease early", "You could lose the space after paying for build-out.", "Ask to remove it or get your unamortized build-out costs back."],
];

export const ruleFlags = (text: string) => RULES.filter(([re]) => re.test(text)).map(([, flag, why, ask]) => ({ flag, why, ask }));

export const flagTopic = (t: string) => (/guarant/i.test(t) ? "guarantee" : /cam|nnn|common area|operating/i.test(t) ? "cam" : /escalat|increase/i.test(t) ? "increase" : /assign|sublet|sublease/i.test(t) ? "assign" : /relocat/i.test(t) ? "relocate" : /terminat|demolition/i.test(t) ? "terminate" : t.toLowerCase());

function pdfStrings(s: string): string {
  const out: string[] = [];
  const unesc = (x: string) => x.replace(/\\([nrtbf])/g, " ").replace(/\\([()\\])/g, "$1").replace(/\\\d{3}/g, "");
  for (const m of s.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")/g)) {
    if (m[2] != null) out.push(unesc(m[2]));
    else out.push([...m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((p) => unesc(p[1])).join(""));
  }
  return out.join(" ");
}

// Best effort: only reads plain or Flate streams with literal-string text; scanned or font-encoded PDFs return "".
export function extractPdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const parts: string[] = [];
  let budget = 8 * 1024 * 1024, streams = 0;
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    if (++streams > 2000 || budget <= 0) break;
    let body: string;
    try {
      const out = inflateSync(Buffer.from(m[1], "latin1"), { maxOutputLength: budget });
      budget -= out.length;
      body = out.toString("latin1");
    } catch (e) {
      if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") break;
      body = m[1];
    }
    if (/\bBT\b/.test(body)) parts.push(pdfStrings(body));
  }
  const text = parts.join("\n").replace(/\s+/g, " ").trim();
  return /[a-z]{3,}\s+[a-z]{2,}/i.test(text) ? text : "";
}

const STOP = new Set("the a an and or of to in is are can i my me we do does it for on be this that with what when how if at by as".split(" "));

// No-model Q&A: the sentences sharing the most words with the question.
export function searchLease(text: string, question: string): string[] {
  const words = [...new Set(question.toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !STOP.has(w)))];
  if (!words.length) return [];
  const stems = words.map((w) => w.replace(/(ing|ed|es|s)$/, ""));
  return text.split(/(?<=[.;!?])\s+/)
    .map((s) => ({ s: s.trim(), n: stems.filter((w) => w.length > 2 && s.toLowerCase().includes(w)).length }))
    .filter((x) => x.n > 0 && x.s.length > 20)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((x) => (x.s.length > 400 ? `${x.s.slice(0, 400)}…` : x.s));
}
