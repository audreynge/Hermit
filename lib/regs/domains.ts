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
