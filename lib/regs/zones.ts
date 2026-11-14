// Pure zone-code helpers; safe to import from client code (no database access).
export function normalizeZone(z: string): string {
  const s = z.toUpperCase().replace(/,\s*LOS ANGELES$/, "").replace(/[\[(][A-Z]+[\])]/g, "").trim();
  const noLA = /^LA(R|C|M|P|A|O|S|H)/.test(s) ? s.slice(2) : s;
  return noLA.split("-")[0].trim();
}

export function zoningAgreement(costar: string | null, parcel: string): "agree" | "disagree" | "unknown" {
  if (!costar) return "unknown";
  return normalizeZone(costar) === normalizeZone(parcel) ? "agree" : "disagree";
}
