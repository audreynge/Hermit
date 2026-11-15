import type { Finding } from "@/lib/regs/research";

const ORDER = ["city", "county", "state", "federal"] as const;
const TITLE = { city: "City", county: "County", state: "State", federal: "Federal" };
const TOPIC = (t: string) => t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

type Item = Pick<Finding, "jurisdiction" | "requirement" | "certainty" | "url"> & { topic: string; level?: Finding["level"] };

export function RegulationList({ findings }: { findings: Item[] }) {
  if (!findings.length) return <p className="muted">No official rules found yet for this use. Ask the city's permit desk before signing.</p>;
  const levelOf = (f: Item) => f.level ?? f.jurisdiction;
  return (
    <div className="regs">
      {ORDER.filter((l) => findings.some((f) => levelOf(f) === l)).map((l) => (
        <section key={l} aria-label={`${TITLE[l]} rules`}>
          <h4>{TITLE[l]}</h4>
          <ul>
            {findings.filter((f) => levelOf(f) === l).map((f, i) => (
              <li key={i}>
                <strong>{TOPIC(f.topic)}:</strong> {f.requirement}
                {f.certainty !== "applies" && <span className="muted"> (may apply)</span>}{" "}
                <a href={f.url} target="_blank" rel="noreferrer">source</a>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="muted" style={{ fontSize: 13 }}>A screening checklist from official sources, not legal advice. Confirm each item with the office.</p>
    </div>
  );
}
