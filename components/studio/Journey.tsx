import Link from "next/link";

const STEPS = ["Find a space", "Furnish & tour", "Talk to your broker"];

// The three-step path shown once matches exist. `links[i]` makes step i clickable.
export function Journey({ step, links = [] }: { step: 0 | 1 | 2; links?: (string | undefined)[] }) {
  return (
    <ol className="journey" aria-label="Your progress">
      {STEPS.map((label, i) => {
        const state = i < step ? "done" : i === step ? "current" : "next";
        const body = <><span className="journey-dot" aria-hidden="true">{i + 1}</span><span>{label}</span></>;
        return (
          <li key={label} data-state={state} aria-current={i === step ? "step" : undefined}>
            {links[i] && i !== step ? <Link href={links[i]!}>{body}</Link> : body}
          </li>
        );
      })}
    </ol>
  );
}
