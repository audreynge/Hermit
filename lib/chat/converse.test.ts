import { describe, expect, it } from "vitest";
import { converse, openChat, type ChatState } from "./converse";
import { surveyToSpec } from "../spec/survey";

const fromSurvey = (over = {}) => surveyToSpec({ transaction: "lease", accessibility: false, requirements: [], ...over });

describe("openChat", () => {
  it("greets with what the survey captured and asks the first missing thing", () => {
    const t = openChat(fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" }));
    expect(t.reply).toMatch(/medical clinic/i);
    expect(t.reply).toMatch(/Houston/);
    expect(t.reply).toMatch(/exam rooms/i);
    expect(t.ready).toBe(false);
    expect(t.quickReplies.length).toBeGreaterThan(0);
  });

  it("asks what the space is for when the survey was skipped", () => {
    const t = openChat(fromSurvey());
    expect(t.reply).toMatch(/what kind of space/i);
    expect(t.quickReplies).toContain("Medical / dental clinic");
  });
});

describe("converse while gathering", () => {
  it("understands a rich first message and only asks what is still missing", () => {
    const t0 = openChat(fromSurvey());
    const t1 = converse(t0.state, "I'm looking for a space for a small medical clinic in Houston. I need about 1,200-1,800 sq ft, with 3 exam rooms, a reception area, and some storage.");
    expect(t1.state.spec).toMatchObject({ city: "houston", useType: "medical clinic", sizeSqft: [1200, 1800] });
    expect(t1.state.spec.rooms.map((r) => `${r.count} ${r.label}`)).toEqual(expect.arrayContaining(["3 exam room", "1 reception", "1 storage"]));
    expect(t1.ready).toBe(true);
    expect(t1.reply).toMatch(/1,200.1,800/);
  });

  it("treats a bare number as the main room count for the use", () => {
    const t0 = openChat(fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" }));
    const t1 = converse(t0.state, "3, with sinks please");
    const exam = t1.state.spec.rooms.find((r) => r.label === "exam room");
    expect(exam).toMatchObject({ count: 3, fixtures: ["sink"] });
  });

  it("asks for the city before searching and accepts a short answer", () => {
    const t0 = openChat(fromSurvey({ useType: "salon", size: "lt1000" }));
    const t1 = converse(t0.state, "2 stations");
    expect(t1.ready).toBe(false);
    expect(t1.reply).toMatch(/Houston or Los Angeles/);
    const t2 = converse(t1.state, "LA");
    expect(t2.state.spec.city).toBe("los_angeles");
  });

  it("recognizes an office even though office is the parser's default", () => {
    expect(converse(openChat(fromSurvey()).state, "office in Houston").state.spec.useType).toBe("office");
  });

  it("stops asking and searches when the user keeps saying just search", () => {
    let t = openChat(fromSurvey());
    for (let i = 0; i < 6 && !t.ready; i++) t = converse(t.state, "just search");
    expect(t.ready).toBe(true);
  });

  it("lets the user skip optional questions", () => {
    const t0 = openChat(fromSurvey({ city: "houston", useType: "office" }));
    const t1 = converse(t0.state, "just search");
    expect(t1.ready).toBe(true);
  });

  it("never asks more than three questions before searching", () => {
    let t = openChat(fromSurvey());
    let asked = 0;
    for (const msg of ["a cafe", "not sure", "no idea", "whatever", "hmm"]) {
      if (t.ready) break;
      asked++;
      t = converse(t.state, msg);
    }
    expect(asked).toBeLessThanOrEqual(4);
  });
});

describe("survey questions inside the chat", () => {
  it("asks must-haves as a multi-select card once rooms are known", () => {
    const t0 = openChat(fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" }));
    const t1 = converse(t0.state, "3 exam rooms");
    expect(t1.ready).toBe(false);
    expect(t1.card).toMatchObject({ kind: "multi" });
    expect(t1.card!.options.map((o) => o.label)).toEqual(expect.arrayContaining(["ADA Accessible", "On-site Parking", "Ground Floor"]));
    expect(converse(t1.state, "None of these").ready).toBe(true);
  });

  it("parses a multi-select answer into needs", () => {
    const s = openChat(fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" })).state;
    const t = converse({ ...s, asked: ["rooms", "musts"] }, "ADA Accessible, On-site Parking, Ground Floor");
    expect(t.state.spec.needs).toMatchObject({ wheelchair: true, parking: true, groundFloor: true });
  });

  it("infers buy from the wording", () => {
    const t = converse(openChat(fromSurvey()).state, "We're looking to purchase a small retail shop in LA");
    expect(t.state.spec.transaction).toBe("buy");
    expect(converse(openChat(fromSurvey()).state, "want to lease an office in Houston").state.spec.transaction).toBe("lease");
  });

  it("never asks more than five questions", () => {
    let t = openChat(fromSurvey());
    let asked = 1;
    for (const msg of ["idk", "idk", "idk", "idk", "idk", "idk"]) {
      if (t.ready) break;
      t = converse(t.state, msg);
      if (!t.ready) asked++;
    }
    expect(t.ready).toBe(true);
    expect(asked).toBeLessThanOrEqual(5);
  });
});

describe("converse after results", () => {
  const results = (spec = fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" })): ChatState => ({ spec, asked: ["rooms", "size"], phase: "results" });

  it("routes compare and email requests to actions", () => {
    expect(converse(results(), "can you compare the layouts?").action).toBe("compare");
    expect(converse(results(), "draft an email to the property manager").action).toBe("email");
  });

  it("re-searches when the user adjusts size, budget or location", () => {
    const t = converse(results(), "actually make it 2,500-4,000 sq ft in Los Angeles");
    expect(t.ready).toBe(true);
    expect(t.state.spec).toMatchObject({ city: "los_angeles", sizeSqft: [2500, 4000] });
    expect(t.reply).toMatch(/updat/i);
  });

  it("routes permit and regulation questions to the regulations action", () => {
    expect(converse(results(), "what permits do I need?").action).toBe("regulations");
    expect(converse(results(), "Which licenses or regulations apply?").action).toBe("regulations");
  });

  it("handles relative refinements from the quick replies", () => {
    const bigger = converse(results(), "Make it bigger");
    expect(bigger.ready).toBe(true);
    expect(bigger.state.spec.sizeSqft).toEqual([1500, 3750]);
    expect(converse(results(), "a bit smaller please").state.spec.sizeSqft).toEqual([670, 1675]);
    const cheaper = converse(results({ ...fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" }), budgetMonthly: 5000 }), "something cheaper");
    expect(cheaper.state.spec.budgetMonthly).toBe(4000);
  });

  it("offers help when it doesn't understand", () => {
    const t = converse(results(), "hello?");
    expect(t.ready).toBe(false);
    expect(t.reply).toMatch(/compare|email|adjust/i);
  });
});
