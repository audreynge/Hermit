"use client";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import type { ParcelResponse } from "@/app/api/parcel/[id]/route";
import type { RequirementSpec, ShellReport } from "@/lib/types";
import { Modal } from "./Modal";

// Buyers get parcel facts; renters don't need them. An explicit lease listing or lease search opts out of home mode's default.
export const isBuying = (spec: RequirementSpec | null | undefined, r: ShellReport) =>
  spec?.transaction === "buy" || r.listing?.kind === "sale" || (spec?.mode === "home" && spec.transaction !== "lease" && r.listing?.kind !== "lease");

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
type Row = { label: string; value?: React.ReactNode; source?: React.ReactNode };

function rows({ shell: s, la }: ParcelResponse): Row[] {
  const p = s.parcel;
  const src = p?.sources ?? {};
  const home = !s.propertyId;
  const scag = la && <>SCAG zoning layer (APN24, ZN24_CITY) · <a href={la.url} target="_blank" rel="noreferrer">source</a></>;
  return [
    { label: "Address", value: s.address, source: home ? "CoStar ResidentialListing.property.address" : "CoStar CommercialProperty.primaryAddress" },
    p?.apns ? { label: "APN", value: p.apns.join(", "), source: `CoStar ${src.apns}` }
      : { label: "APN", value: la?.apn || undefined, source: la?.apn ? scag : undefined },
    { label: "Lot size", value: p?.lotAcres != null ? `${p.lotAcres.toLocaleString()} acres` : p?.lotSqft != null ? `${p.lotSqft.toLocaleString()} sq ft` : undefined, source: `CoStar ${src.lotAcres ?? src.lotSqft}` },
    p?.landUse ? { label: "Land use", value: p.landUse, source: `CoStar ${src.landUse}` }
      : { label: "Property use", value: [s.propertyType, s.subtype].filter((x) => x && x !== "Unknown").join(" · ") || undefined, source: home ? "CoStar ResidentialListing.property.mlsPropertyType" : "CoStar CommercialProperty.propertyType / propertySubtype" },
    ...(home ? [{ label: "Subdivision", value: p?.subdivision, source: `CoStar ${src.subdivision}` }] : []),
    { label: "Zoning", value: la?.zone ?? s.zoning ?? undefined, source: la ? scag : "CoStar CommercialProperty.zoningDescription" },
    ...(la && s.zoning && s.zoning !== la.zone ? [{ label: "Zoning (CoStar record)", value: s.zoning, source: "CoStar CommercialProperty.zoningDescription" }] : []),
    { label: "Year built", value: s.yearBuilt, source: home ? "CoStar ResidentialListing.property.yearBuilt" : "CoStar CommercialProperty.constructionEvents" },
    home ? { label: "Home size", value: s.sqft != null ? `${s.sqft.toLocaleString()} sq ft` : undefined, source: "CoStar ResidentialListing.property.sqftMax" }
      : { label: "Building size", value: s.buildingSqft != null ? `${s.buildingSqft.toLocaleString()} sq ft` : undefined, source: "CoStar CommercialProperty.grossBuildingAreaSquareFeet" },
    { label: "Stories", value: s.stories, source: "CoStar CommercialProperty.numStoriesAboveGrade" },
    { label: "Assessed value", value: p?.assessedTotal != null ? `${usd(p.assessedTotal)}${p.assessmentYear ? ` (${p.assessmentYear})` : ""}${p.assessedLand != null && p.assessedImproved != null ? ` · land ${usd(p.assessedLand)}, improvements ${usd(p.assessedImproved)}` : ""}` : undefined, source: `CoStar ${src.assessedTotal}` },
    { label: "Property tax", value: p?.taxAmount != null ? `${usd(p.taxAmount)}/yr${p.taxYear ? ` (${p.taxYear})` : ""}` : undefined, source: `CoStar ${src.taxAmount}` },
    { label: "Last sale", value: p?.lastSaleDate ? `${p.lastSaleDate}${p.lastSalePrice ? ` for ${usd(p.lastSalePrice)}` : " (price not on record)"}` : undefined, source: `CoStar ${src.lastSaleDate}${src.lastSalePrice ? `, ${src.lastSalePrice}` : ""}` },
  ];
}

export function ParcelInfo({ report, onClose }: { report: ShellReport; onClose: () => void }) {
  const [data, setData] = useState<ParcelResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    fetch(`/api/parcel/${encodeURIComponent(report.shellId)}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then(setData).catch(() => setError(true));
  }, [report.shellId]);
  const at = data?.shell.lat != null && data.shell.lon != null ? { lat: data.shell.lat, lon: data.shell.lon } : null;
  return (
    <Modal title={`Parcel info · ${report.name.split(" · ")[0]}`} onClose={onClose}>
      {error && <p role="alert">Couldn&apos;t load parcel records for this property. Try again in a moment.</p>}
      {!data && !error && <p className="muted" role="status">Loading parcel records…</p>}
      {data && (
        <>
          <dl className="parcel-list">
            {rows(data).map((r) => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>
                  {r.value != null && r.value !== "" ? <span className="num">{r.value}</span> : <span className="muted">Not on record</span>}
                  {r.value != null && r.value !== "" && r.source && <small className="muted">{r.source}</small>}
                </dd>
              </div>
            ))}
          </dl>
          {at && (
            <p style={{ marginTop: 14 }}>
              <a className="btn small parcel-map" href={`https://www.openstreetmap.org/?mlat=${at.lat}&mlon=${at.lon}#map=18/${at.lat}/${at.lon}`} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" /> Open on a map
              </a>
            </p>
          )}
        </>
      )}
      <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>Screening data from property records, not a title report or survey. Confirm with the county assessor and a title company before you buy.</p>
    </Modal>
  );
}
