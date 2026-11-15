"use client";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
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

const WALLS = "A photo shows what's there, not what's behind the walls (plumbing, drains, power). Ask the landlord about those.";

// A scan-photo thumbnail that opens larger in a modal dialog with each photo's note and "How we know".
// `title` heads the dialog ("Exam room #1: sink seen"); `children` is the button's visible text (optional).
export function SeenPhoto({ checks, labels, title, alt, children, className }: { checks: PanoCheck[]; labels?: string[]; title: string; alt: string; children?: React.ReactNode; className?: string }) {
  const dlg = useRef<HTMLDialogElement | null>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => { if (open && dlg.current && !dlg.current.open) dlg.current.showModal(); }, [open]);
  const shown = checks.map((c, i) => ({ ...c, label: labels?.[i] })).filter((c) => panoUrl(c));
  if (!shown.length) return null;
  return (
    <>
      <button type="button" className={`seen-photo${className ? ` ${className}` : ""}`} onClick={() => setOpen(true)} aria-haspopup="dialog">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={panoUrl(shown[0])} alt="" width={56} height={56} />
        {children}<span className="sr-only">{children ? ". " : ""}Open the photo: {alt}</span>
      </button>
      {open && (
        <dialog ref={dlg} className="seen-dialog" aria-labelledby={id} onClose={() => setOpen(false)} onClick={(e) => { if (e.target === dlg.current) dlg.current?.close(); }}>
          <div className="seen-dialog-head">
            <h3 id={id}>{title}</h3>
            <button type="button" className="btn small" onClick={() => dlg.current?.close()} autoFocus>Close</button>
          </div>
          {shown.map((c, i) => (
            <figure key={`${c.roomId}-${c.feature}-${i}`} className="seen-fig">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={panoUrl(c)} alt={`Scan photo${c.label ? ` of ${c.label}` : ""}: ${c.note}`} />
              <figcaption>{c.label && <strong>{c.label.charAt(0).toUpperCase() + c.label.slice(1)}: </strong>}{c.note}</figcaption>
            </figure>
          ))}
          <Evidence lines={[checkSource(shown[0]), WALLS]} />
        </dialog>
      )}
    </>
  );
}
