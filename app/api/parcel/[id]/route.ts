import { getShell, isSafeId } from "@/lib/query/load";
import { lookupZoning } from "@/lib/regs/zoning";
import type { Shell } from "@/lib/types";

export type ParcelResponse = {
  shell: Pick<Shell, "id" | "address" | "lat" | "lon" | "propertyId" | "homesListingId" | "propertyType" | "subtype" | "yearBuilt" | "buildingSqft" | "sqft" | "sqftSource" | "stories" | "zoning" | "parcel">;
  // LA only: the SCAG zoning layer's parcel under the point (cached in regulation_findings by lookupZoning).
  la: { apn: string; zone: string; source: string; url: string } | null;
};

const SCAG_URL = "https://maps.scag.ca.gov/scaggis/rest/services/LDX/Zoning_poly_LA/MapServer/0";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = isSafeId(id) ? getShell(id) : null;
  if (!s) return Response.json({ error: "not found" }, { status: 404 });
  const z = s.city === "los_angeles" && s.lat != null && s.lon != null ? await lookupZoning(s.lat, s.lon) : null;
  const body: ParcelResponse = {
    shell: {
      id: s.id, address: s.address, lat: s.lat, lon: s.lon, propertyId: s.propertyId, homesListingId: s.homesListingId,
      propertyType: s.propertyType, subtype: s.subtype, yearBuilt: s.yearBuilt, buildingSqft: s.buildingSqft, sqft: s.sqft,
      sqftSource: s.sqftSource, stories: s.stories, zoning: s.zoning, parcel: s.parcel,
    },
    la: z ? { ...z, url: SCAG_URL } : null,
  };
  return Response.json(body);
}
