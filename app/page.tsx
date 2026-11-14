import Link from "next/link";

export default function Home() {
  return (
    <section className="hero">
      <h1>Tell Hermit what you need. It finds the space already built for it.</h1>
      <p>
        Hermit reads CoStar building and listing records, measures Matterport scans room by room, and screens power, fire,
        parking, zoning and access. Each match comes with the evidence, the work still left to do, and the questions to ask
        before you sign.
      </p>
      <div className="row">
        <Link className="btn" href="/plan">Start a search</Link>
        <Link className="btn ghost" href="/results?replay=demo">Watch a recorded run</Link>
      </div>
      <p className="muted">
        A screening tool, not an inspection or a permit decision. Availability comes from listing records and may be out of date.
      </p>
    </section>
  );
}
