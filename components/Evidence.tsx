"use client";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { PanoCheck } from "@/lib/types";

// "How we know": a small toggle that reveals one or two short source lines under a finding. Inline (span) markup so it
// can sit inside a sentence, a list item or a caption. Renders nothing when there is nothing to cite.
export function Evidence({ lines, label = "How we know", className }: { lines: (string | null | undefined | false)[]; label?: string; className?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const items = lines.filter((l): l is string => !!l);
  if (!items.length) return null;
  return (
    <span className={`ev${className ? ` ${className}` : ""}`}>
      <button type="button" className="ev-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {label} <ChevronDown aria-hidden="true" className="ev-chev" />
      </button>
      <span id={id} className="ev-body" hidden={!open}>
        {items.map((l, i) => <span key={i} className="ev-line">{l}</span>)}
      </span>
    </span>
  );
}

// The cropped scan photo behind a "looked closer" check, served by app/api/asset. undefined when the check has no photo.
export const panoUrl = (c: PanoCheck) => {
  const f = c.image?.split("/").pop();
  return f ? `/api/asset/${encodeURIComponent(c.sid)}?kind=pano&f=${encodeURIComponent(f)}` : undefined;
};

// "sink", "toilet and sink", "sink, counter and toilet"
export const listWords = (xs: string[], conj = "and") => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} ${conj} ${xs.at(-1)}`);

// The source line for a scan-photo check.
export const checkSource = (c: PanoCheck | undefined) => (c ? `Photo from the Matterport scan of this space, checked by Gemini${c.retrieved ? ` on ${plainDate(c.retrieved)}` : ""}.` : null);

// "2026-11-15T05:22:11Z" or "2026-01" -> "Nov 15, 2026" / "January 2026". Bad input comes back unchanged.
export function plainDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1)));
  return m[3] ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
