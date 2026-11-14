"use client";
import { Upload } from "lucide-react";
import { useState } from "react";
import { breakEven, buyEstimate, readPnl } from "@/lib/money";
import { useMoney } from "./shared";
import type { ReportCtx } from "./ShellReportPage";

const $ = (n: number) => `$${Math.round(n).toLocaleString()}`;

function Num({ id, label, value, onChange, hint, prefix = "$" }: { id: string; label: string; value: number; onChange: (v: number) => void; hint?: string; prefix?: string }) {
  return (
    <label className="money-field" htmlFor={id}>
      <span>{label}</span>
      <span className="money-input">{prefix && <span aria-hidden="true">{prefix}</span>}<input id={id} inputMode="decimal" value={value || ""} placeholder="0" onChange={(e) => onChange(Number(e.target.value.replace(/[^\d.]/g, "")) || 0)} /></span>
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function Money({ report, spec }: ReportCtx) {
  const [m, setM] = useMoney(spec, report);
  const [pnl, setPnl] = useState<{ revenue?: number; expenses?: number; rows: number } | null>(null);
  const set = (k: keyof typeof m) => (v: number) => setM({ ...m, [k]: v });
  const be = breakEven(m);
  const buy = spec.transaction === "buy" && m.buyPrice ? buyEstimate(m.buyPrice) : null;
  const sqft = report.sqft ?? report.floorplan?.totalAreaSqft;

  return (
    <div className="money">
      <section className="card pad money-inputs" aria-labelledby="money-in">
        <h2 id="money-in">Your numbers</h2>
        <p className="muted small">Saved in this browser. Hermit never sends these anywhere.</p>
        <div className="money-grid">
          <Num id="m-price" label="Average sale per customer" value={m.price} onChange={set("price")} hint="What one visit brings in" />
          <Num id="m-days" label="Days open per week" value={m.daysPerWeek} onChange={set("daysPerWeek")} prefix="" />
          <Num id="m-rent" label="Monthly rent" value={m.rent} onChange={set("rent")} hint={m.rentKnown ? "From the listing's asking rate" : "Not in the listing data: ask the broker"} />
          <Num id="m-util" label="Utilities per month" value={m.utilities} onChange={set("utilities")} hint={sqft ? `Starting guess: about $2 per sf per year for ${Math.round(sqft).toLocaleString()} sf` : undefined} />
          <Num id="m-other" label="Other monthly costs" value={m.other} onChange={set("other")} hint="Payroll, supplies, insurance…" />
          <Num id="m-cost" label="Cost per sale (optional)" value={m.costPerSale ?? 0} onChange={set("costPerSale")} hint="Products used on each customer" />
        </div>
        <label className="upload btn small">
          <Upload aria-hidden="true" /> Upload a P&amp;L (CSV)
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const r = readPnl(await f.text()); setPnl(r); if (r.expenses) setM({ ...m, other: Math.round(r.expenses) }); }} />
        </label>
        {pnl && <p className="small">{pnl.rows ? `Read ${pnl.rows} rows: about ${pnl.revenue ? `${$(pnl.revenue)} revenue and ` : ""}${pnl.expenses ? $(pnl.expenses) : "no"} expenses a month. I used the expenses as your other costs.` : "I couldn't read that file. Use columns like month, revenue, expenses."}</p>}
        <p className="muted small">QuickBooks and other bookkeeping tools can feed this later; for now, upload a CSV export.</p>
      </section>

      <section className="card pad breakeven" aria-labelledby="be-title">
        <h2 id="be-title">Can I afford it?</h2>
        {be && m.rent ? (
          <>
            <p className="big-answer">You need about <strong className="num">{be.perDayRounded}</strong> customer{be.perDayRounded === 1 ? "" : "s"} a day</p>
            <p>at your {$(m.price)} average, open {m.daysPerWeek} days a week, just to cover {$(be.monthlyCosts)} a month in rent and running costs. That&apos;s about {be.perMonth.toLocaleString()} customers a month.</p>
            <p className="muted small">Break-even only: it doesn&apos;t include your own pay, loan payments or taxes. Screening math, not financial advice.</p>
          </>
        ) : <p className="big-answer muted">{m.price ? "Add the monthly rent to see how many customers a day you need." : "Add your average sale and the rent, and I'll turn the lease into customers a day."}</p>}
      </section>

      {spec.transaction === "buy" && (
        <section className="card pad" aria-labelledby="buy-title">
          <h2 id="buy-title">What you&apos;d need to buy it</h2>
          <Num id="m-buy" label="Purchase price" value={m.buyPrice ?? 0} onChange={set("buyPrice")} hint="CoStar assessed values aren't loaded in this build" />
          {buy && <p>About <strong>{$(buy.down)}</strong> upfront (10% down, SBA 504-style for owner-occupied buyers) and about <strong>{$(buy.monthly)}</strong> a month on the loan (25 years at 7%). Confirm real terms with a lender.</p>}
        </section>
      )}
    </div>
  );
}
