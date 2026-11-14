import Link from "next/link";

const STEPS = [
  { n: 1, label: "Survey", href: "/" },
  { n: 2, label: "Search", href: "/search" },
  { n: 3, label: "Layout", href: "/layout" },
];

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  return (
    <nav className="stepper" aria-label="Progress">
      {STEPS.map((s, i) => (
        <span key={s.n} style={{ display: "contents" }}>
          {i > 0 && <span className={`step-line${s.n - 1 <= current ? " done" : ""}`} aria-hidden="true" />}
          <Link href={s.href} className="step" aria-current={s.n === current ? "step" : undefined}>
            <span className="dot">{s.n}</span><span className="label">{s.label}</span>
          </Link>
        </span>
      ))}
    </nav>
  );
}
