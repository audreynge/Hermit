import { describe, expect, it } from "vitest";
import { actionTurn, converse, openChat, parseTarget, type ChatState } from "./converse";
import { surveyToSpec } from "../spec/survey";

const fromSurvey = (over = {}) => surveyToSpec({ transaction: "lease", accessibility: false, requirements: [], ...over });

describe("openChat", () => {
  it("greets with what the survey captured and asks the first missing thing", () => {
    const t = openChat(fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" }));
    expect(t.reply).toMatch(/medical clinic/i);
    expect(t.reply).toMatch(/Houston/);
    expect(t.reply).toMatch(/exam rooms/i);
    expect(t.ready).toBe(false);
    expect(t.quickReplies).toEqual([]);
  });

  it("asks what the space is for when the survey was skipped", () => {
    const t = openChat(fromSurvey());
    expect(t.reply).toMatch(/what kind of space/i);
    expect(t.quickReplies).toEqual([]);
  });
});

describe("converse while gathering", () => {
  it("asks once for the chair width after the rooms, and reads a tapped answer", () => {
    const t0 = openChat(fromSurvey({ city: "houston", useType: "home", accessibility: true }));
    expect(t0.reply).toMatch(/bedrooms/i);
    const t1 = converse(t0.state, "3 bed / 2 bath");
    expect(t1.reply).toMatch(/how wide is the wheelchair/i);
    expect(t1.reply).toMatch(/manual chair is about 25 inches/);
    expect(t1.quickReplies).toEqual([]);
    const t2 = converse(t1.state, "Manual (~25 in)");
    expect(t2.state.spec.needs).toMatchObject({ wheelchair: true, chairWidthIn: 25 });
    expect(t2.ready).toBe(true);
    expect(t2.reply).toMatch(/25 in chair/);
  });

  it("does not ask for the chair width when it is known or the user skips it", () => {
    const spec = fromSurvey({ city: "houston", useType: "home", accessibility: true });
    const known = converse(openChat({ ...spec, needs: { ...spec.needs, chairWidthIn: 26 } }).state, "3 bed / 2 bath");
    expect(known.reply).not.toMatch(/how wide/i);
    const t1 = converse(openChat(spec).state, "3 bed / 2 bath");
    const later = converse(t1.state, "I'll measure later");
    expect(later.ready).toBe(true);
    expect(later.state.spec.needs.chairWidthIn).toBeUndefined();
  });

  it("asks for the chair width even when the 5-question budget is spent", () => {
    const state = { spec: { ...fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" }), needs: { wheelchair: true } }, asked: ["use", "city", "size", "rooms", "musts"] as const, phase: "gathering" as const };
    expect(converse({ ...state, asked: [...state.asked] }, "3 exam rooms").reply).toMatch(/how wide is the wheelchair/i);
  });

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
  it("asks must-haves as one plain question once rooms are known, with no chips or cards", () => {
    const t0 = openChat(fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" }));
    const t1 = converse(t0.state, "3 exam rooms");
    expect(t1.ready).toBe(false);
    expect(t1.reply).toMatch(/can't do without.*parking/i);
    expect(t1.card).toBeUndefined();
    expect(t1.quickReplies).toEqual([]);
    expect(converse(t1.state, "None of these").ready).toBe(true);
  });

  it("parses a multi-select answer into needs", () => {
    const s = openChat(fromSurvey({ city: "houston", useType: "medical", size: "1000-2500" })).state;
    const t = converse({ ...s, asked: ["rooms", "musts"] }, "Step-free / wheelchair access, On-site Parking, Ground Floor");
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

  it("offers help as one follow-up question when it doesn't understand", () => {
    const t = converse(results(), "hello?");
    expect(t.ready).toBe(false);
    expect(t.reply).toMatch(/compare/i);
    expect(t.reply).toMatch(/\?$/);
    expect(t.quickReplies).toEqual([]);
  });

  it("does what the user can do in the app: save, view, report, broker, with a target", () => {
    expect(converse(results(), "save the second one")).toMatchObject({ action: "save", target: 2 });
    expect(converse(results(), "show me #2")).toMatchObject({ action: "view", target: 2 });
    expect(converse(results(), "let me see inside the first one")).toMatchObject({ action: "view", target: 1 });
    expect(converse(results(), "full report on #1")).toMatchObject({ action: "report", target: 1 });
    expect(converse(results(), "contact the broker")).toMatchObject({ action: "broker" });
    expect(converse(results(), "contact the broker").target).toBeUndefined();
    expect(converse(results(), "send the packet").action).toBe("broker");
    expect(converse(results(), "save it").action).toBe("save");
    expect(converse(results(), "I want to save money on rent").action).toBeUndefined();
  });

  it("starts over, searches and opens the layout editor in any phase", () => {
    const reset = converse(results(), "let's start over");
    expect(reset.action).toBe("reset");
    expect(reset.state).toMatchObject({ phase: "gathering", spec: { useType: "" } });
    expect(converse(results(), "search again").action).toBe("search");
    const g = openChat(fromSurvey({ city: "houston", useType: "office" }));
    expect(converse(g.state, "search now")).toMatchObject({ action: "search", ready: true });
    expect(converse(g.state, "let me edit the layout").action).toBe("edit_layout");
  });

  it("match actions wait for results", () => {
    const g = openChat(fromSurvey({ city: "houston", useType: "office" }));
    const t = converse(g.state, "save the first one");
    expect(t.action).toBeUndefined();
    expect(t.reply).toMatch(/search/i);
  });
});

describe("parseTarget", () => {
  it("reads ordinals and numbers as a 1-based rank", () => {
    expect(parseTarget("the second one")).toBe(2);
    expect(parseTarget("#3")).toBe(3);
    expect(parseTarget("number four")).toBe(4);
    expect(parseTarget("match 5")).toBe(5);
    expect(parseTarget("the top one")).toBe(1);
    expect(parseTarget("this one")).toBeUndefined();
    expect(actionTurn({ spec: fromSurvey(), asked: [], phase: "results" }, "hello")).toBeNull();
  });
});

describe("no suggestion chips", () => {
  it("every turn has empty quickReplies", () => {
    let t = openChat(fromSurvey());
    for (const msg of ["a dental clinic", "Houston", "about 1500 sq ft", "3 exam rooms", "parking", "compare them"]) {
      expect(t.quickReplies).toEqual([]);
      t = converse(t.state, msg);
    }
    expect(t.quickReplies).toEqual([]);
  });
});
