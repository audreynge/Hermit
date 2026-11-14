import type { Finding } from "@/lib/regs/research";

const ORDER = ["city", "county", "state", "federal"] as const;
const TITLE = { city: "City", county: "County", state: "State", federal: "Federal" };
const TOPIC = (t: string) => t.replace(/_/g, " ");

type Item = Pick<Finding, "jurisdiction" | "requirement" | "certainty" | "url" | "retrievedAt"> & { topic: string };

export function RegulationList({ findings }: { findings: Item[] }) {
  if (!findings.length) return <p className="muted">No official rules found yet for this use. Ask the city's permit desk before signing.</p>;
  return (
    <div className="regs">
      {ORDER.filter((j) => findings.some((f) => f.jurisdiction === j)).map((j) => (
        <section key={j} aria-label={`${TITLE[j]} rules`}>
          <h4>{TITLE[j]}</h4>
          <ul>
            {findings.filter((f) => f.jurisdiction === j).map((f, i) => (
              <li key={i}>
                <span className={`badge-src ${f.certainty === "applies" ? "applies" : "record"}`}>{f.certainty === "applies" ? "applies" : "may apply"}</span>{" "}
                <strong>{TOPIC(f.topic)}:</strong> {f.requirement}{" "}
                <a href={f.url} target="_blank" rel="noreferrer">source</a> <span className="muted">(checked {f.retrievedAt})</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>A screening checklist from official sources, not legal advice. Confirm each item with the jurisdiction.</p>
    </div>
  );
}
