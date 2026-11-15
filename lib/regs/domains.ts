// Official sources the regulation agent may cite; subdomains are included.
export const OFFICIAL_DOMAINS = [
  "lacity.gov", "lacity.org", "codelibrary.amlegal.com", "publichealth.lacounty.gov", "lacounty.gov",
  "dca.ca.gov", "barbercosmo.ca.gov", "leginfo.legislature.ca.gov", "dir.ca.gov", "cdph.ca.gov",
  "houstontx.gov", "houstonpermittingcenter.org", "library.municode.com", "hcphes.org",
  "tdlr.texas.gov", "dshs.texas.gov", "statutes.capitol.texas.gov", "tmb.state.tx.us",
  "ada.gov", "access-board.gov", "nfpa.org",
];

export function isOfficial(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return OFFICIAL_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export type Level = "city" | "county" | "state" | "federal";
const LEVEL_DOMAINS: Record<Level, string[]> = {
  city: ["lacity.gov", "lacity.org", "codelibrary.amlegal.com", "houstontx.gov", "houstonpermittingcenter.org", "library.municode.com"],
  county: ["publichealth.lacounty.gov", "lacounty.gov", "hcphes.org"],
  state: ["dca.ca.gov", "barbercosmo.ca.gov", "leginfo.legislature.ca.gov", "dir.ca.gov", "cdph.ca.gov", "tdlr.texas.gov", "dshs.texas.gov", "statutes.capitol.texas.gov", "tmb.state.tx.us"],
  federal: ["ada.gov", "access-board.gov"],
};

// Government level of a source, read from its domain; undefined when the domain isn't one we classify.
export function levelOf(url: string): Level | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (Object.keys(LEVEL_DOMAINS) as Level[]).find((l) => LEVEL_DOMAINS[l].some((d) => host === d || host.endsWith(`.${d}`)));
  } catch {
    return undefined;
  }
}
