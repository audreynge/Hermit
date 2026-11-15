import { describe, expect, it } from "vitest";
import { landlordQuestions } from "@/lib/packet";
import type { PanoCheck, RequirementSpec, ShellReport } from "@/lib/types";
import { brokerDraft, contactOf } from "./Broker";
import { cleanQuestions } from "./Questions";

const check = (roomId: string, feature: string, result: PanoCheck["result"] = "seen"): PanoCheck =>
  ({ sid: "s", roomId, feature, result, confidence: 0.8, note: "", model: "m", retrieved: "" });

// Trimmed from the Priya replay (Suite 1202, EK8LMNkDsv3).
const report = {
  shellId: "EK8LMNkDsv3",
  name: "Suite 1202 · MEDPLACE",
  address: "1315 St Joseph Pky, Houston, TX",
  listing: { listingId: 1, status: "active", kind: "lease", availableSqft: 3022 },
  fit: { score: 97, assignment: [{ req: "exam room #1", roomId: "e1", cost: 0 }, { req: "exam room #2", roomId: "e2", cost: 0 }, { req: "lab", roomId: "l1", cost: 0 }], edits: [], breakdown: {}, hardFails: [], unknowns: [] },
  checks: [check("e1", "sink"), check("e2", "sink")],
  unknowns: [
    { topic: "exclusive use", question: "Does any tenant in this building or center hold an exclusive for clinic use, or would my use need landlord approval?" },
    { topic: "unverified build-out", question: "Do the exam rooms have their own sinks?" },
    { topic: "accessibility", question: "Is there a step-free entry and an accessible restroom on this floor?" },
    { topic: "zoning", question: "Are there deed restrictions or zoning conditions that would limit our use?" },
    { topic: "parking", question: "Where do patients or customers park? The aerial shows no marked surface lot around the building." },
    { topic: "hvac", question: "What cooling capacity (tons) serves the suite, and how old is the equipment?" },
    { topic: "code", question: "Houston has no use zoning; check deed restrictions and the plat for this lot — can you confirm?" },
    { topic: "access", question: "Is the entry step-free, and is there an accessible restroom (60 in turning space) in the suite?" },
    { topic: "systems", question: "Medical gas or vacuum lines: what's in place today?" },
  ],
  buildout: [{ item: "Exam-room sinks", status: "unverified", evidence: "Not seen in the scan", question: "Do the exam rooms have their own sinks?" }],
} as unknown as ShellReport;

const spec = {
  mode: "business", city: "houston", useType: "clinic", sizeSqft: [1500, 3500],
  rooms: [{ label: "exam room", count: 2, hard: false, fixtures: ["sink"] }, { label: "reception", count: 1, hard: false }, { label: "lab", count: 1, hard: false }],
  needs: { parkingStalls: 10, stepFree: true },
  rawText: "I'm a pediatrician opening my own clinic in Houston. 1,500 to 3,500 sq ft, 2 exam rooms with sinks.",
} as unknown as RequirementSpec;

describe("cleanQuestions", () => {
  const qs = cleanQuestions(report, landlordQuestions(report));

  it("drops a question the scan photos already answered", () => {
    expect(qs.some((q) => /own sinks/.test(q))).toBe(false);
  });

  it("keeps the sink question when the sinks weren't seen", () => {
    const r = { ...report, checks: [check("e1", "sink", "unclear")] };
    expect(cleanQuestions(r, landlordQuestions(r)).some((q) => /own sinks/.test(q))).toBe(true);
  });

  it("asks zoning and step-free entry once each, keeping the plainer wording", () => {
    expect(qs.filter((q) => /zoning|deed/i.test(q))).toEqual(["Are there deed restrictions or zoning conditions that would limit our use?"]);
    expect(qs.filter((q) => /step-free/i.test(q))).toEqual(["Is there a step-free entry and an accessible restroom on this floor?"]);
  });

  it("keeps at most five, most important first", () => {
    expect(qs).toHaveLength(5);
    expect(qs[0]).toMatch(/exclusive/);
  });
});

describe("brokerDraft", () => {
  const qs = cleanQuestions(report, landlordQuestions(report));
  const d = brokerDraft(report, spec, {}, qs);

  it("goes to the listing broker when there's no contact on record", () => {
    expect(d.to).toEqual({ label: "the listing broker", email: "", first: "" });
    expect(d.body.startsWith("Hi,\n")).toBe(true);
  });

  it("says who she is, what she needs, why this space and the questions", () => {
    expect(d.body).toMatch(/I'm a pediatrician opening my own clinic in Houston\./);
    expect(d.body).toMatch(/about 1,500 to 3,500 sq ft with 2 exam rooms \(with sinks\), a reception area, a lab, step-free entry and parking for 10 cars/);
    expect(d.body).toMatch(/Suite 1202 at 1315 St Joseph Pky looks like a good fit: the 3D scan shows sinks already in both rooms I'd use as exam rooms\./);
    expect(d.body).toMatch(/1\. Does any tenant/);
    expect(d.body).not.toMatch(/property manager|own sinks/);
    expect(d.subject).toBe("Question about Suite 1202 at 1315 St Joseph Pky");
  });

  it("greets the listing contact by name and signs with her details", () => {
    const r = { ...report, listing: { ...report.listing!, contact: { name: "Dana Ruiz", company: "Medplace Realty.", email: "dana@example.com" } } };
    const x = brokerDraft(r, spec, { contactName: "Priya Shah", business: "Little Sprouts Pediatrics", email: "priya@example.com" }, qs);
    expect(contactOf(r).label).toBe("Dana Ruiz, Medplace Realty");
    expect(x.body.startsWith("Hi Dana,")).toBe(true);
    expect(x.body).toMatch(/My name is Priya Shah and I run Little Sprouts Pediatrics\./);
    expect(x.body).toMatch(/I've attached a short tenant packet/);
    expect(x.body.endsWith("Thanks,\nPriya Shah\nLittle Sprouts Pediatrics\npriya@example.com")).toBe(true);
  });
});
