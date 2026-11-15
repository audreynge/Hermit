import { describe, expect, it, vi } from "vitest";
vi.mock("../llm/gemini", () => ({ hasGemini: () => false, generateJSON: vi.fn() }));
import { cleanUse } from "../uses/label";
import { describe as describeSpec } from "../chat/converse";
import type { Draft } from "../spec/survey";
import { interviewTurn, type IState } from "./turn";
import { checkAnswer, daysFrom } from "./validate";

const biz: Draft = { mode: "business", useType: "salon", city: "houston", rooms: [], needs: {}, priorities: {}, input: "chat" };

describe("answer checks", () => {
  it("re-asks a price that isn't a money amount", () => {
    expect(checkAnswer("price", "Lease", biz).kind).toBe("bad");
    expect(checkAnswer("price", "$40", biz).kind).toBe("ok");
    expect(checkAnswer("price", "about 150 per visit", biz).kind).toBe("ok");
    expect(checkAnswer("price", "not sure", biz).kind).toBe("skip");
  });
  it("moves a monthly budget given for days open into the budget", () => {
    const c = checkAnswer("days", "Around $6,000 a month", biz);
    expect(c).toMatchObject({ kind: "other", field: "budget", patch: { budgetMonthly: 6000 } });
    expect(checkAnswer("price", "$6,000 a month", biz)).toMatchObject({ kind: "other", field: "budget" });
  });
  it("reads days open as 1 to 7", () => {
    expect(daysFrom("6")).toBe(6);
    expect(daysFrom("every day")).toBe(7);
    expect(daysFrom("weekdays")).toBe(5);
    expect(daysFrom("Monday to Saturday")).toBe(6);
    expect(daysFrom("tuesday through saturday")).toBe(5);
    expect(daysFrom("12")).toBeUndefined();
    expect(checkAnswer("days", "Lease", biz).kind).toBe("bad");
    expect(checkAnswer("days", "12", biz).kind).toBe("bad");
    expect(checkAnswer("price", "5 days a week", biz)).toMatchObject({ kind: "other", field: "days", patch: { daysOpen: 5 } });
  });
  it("checks counts, sizes, dates and yes/no answers", () => {
    expect(checkAnswer("baths", "two", biz).kind).toBe("ok");
    expect(checkAnswer("baths", "Lease", biz).kind).toBe("bad");
    expect(checkAnswer("size", "2,000 sq ft", biz).kind).toBe("ok");
    expect(checkAnswer("size", "8 people", biz).kind).toBe("ok");
    expect(checkAnswer("size", "Lease", biz).kind).toBe("bad");
    expect(checkAnswer("moveIn", "in 3 months", biz).kind).toBe("ok");
    expect(checkAnswer("moveIn", "March", biz).kind).toBe("ok");
    expect(checkAnswer("moveIn", "asap", biz).kind).toBe("ok");
    expect(checkAnswer("moveIn", "Lease", biz).kind).toBe("bad");
    expect(checkAnswer("parking", "10", biz).kind).toBe("ok");
    expect(checkAnswer("parking", "street parking is fine", biz).kind).toBe("ok");
    expect(checkAnswer("parking", "Lease", biz).kind).toBe("bad");
    expect(checkAnswer("accessibility", "no", biz).kind).toBe("ok");
    expect(checkAnswer("budget", "$5k a month", biz).kind).toBe("ok");
    expect(checkAnswer("musts", "Lease", biz).kind).toBe("ok");
  });
});

describe("interview re-asks", () => {
  const atPrice: IState = { spec: biz, asked: ["city", "use", "rooms", "roomsOk", "baths", "size", "moveIn", "parking", "accessibility"], history: [], field: "price" };

  it("re-asks the price with a hint and keeps the field open", async () => {
    const t = await interviewTurn(atPrice, "Lease", []);
    expect(t.state.field).toBe("price");
    expect(t.state.spec.avgPrice).toBeUndefined();
    expect(t.reply).toMatch(/^Sorry, I didn't quite get that\. A rough dollar amount works/);
    expect(t.reply).toMatch(/spend per visit/);
    const ok = await interviewTurn(t.state, "$40", []);
    expect(ok.state.spec.avgPrice).toBe(40);
    expect(ok.state.spec.budgetMonthly).toBeUndefined();
    expect(ok.state.field).toBe("days");
    expect(ok.state.asked.some((a) => a.startsWith("again:"))).toBe(false);
  });

  it("stores a budget given for days open, then asks days again", async () => {
    const t = await interviewTurn({ ...atPrice, spec: { ...biz, avgPrice: 40 }, asked: [...atPrice.asked, "price"], field: "days" }, "Around $6,000 a month", []);
    expect(t.state.spec.budgetMonthly).toBe(6000);
    expect(t.state.spec.daysOpen).toBeUndefined();
    expect(t.state.field).toBe("days");
    expect(t.reply).toMatch(/\$6,000 a month as your rent budget\. How many days a week/);
  });

  it("skips after two misses, so the interview never stalls", async () => {
    let t = await interviewTurn(atPrice, "Lease", []);
    t = await interviewTurn(t.state, "Lease", []);
    expect(t.state.field).toBe("price");
    t = await interviewTurn(t.state, "Lease", []);
    expect(t.state.field).not.toBe("price");
    expect(t.reply).toMatch(/skip that one/);
  });
});

describe("use labels", () => {
  it("never keeps filler words like 'own'", () => {
    expect(cleanUse("own clinic", "I'm a pediatrician opening my own clinic in Houston")).toBe("pediatric clinic");
    expect(cleanUse("own clinic", "opening my own clinic")).toBe("medical clinic");
    expect(cleanUse("own practice", "I'm a dentist starting my own practice")).toBe("dental clinic");
    expect(cleanUse("own salon")).toBe("salon");
    expect(cleanUse("nail salon")).toBe("nail salon");
    expect(cleanUse("medical clinic")).toBe("medical clinic");
    expect(cleanUse("")).toBe("");
  });

  it("the pediatrician sentence becomes 'a pediatric clinic' in the interview", async () => {
    const blank: Draft = { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" };
    const t = await interviewTurn({ spec: blank, asked: [], history: [] }, "I'm a pediatrician opening my own clinic in Houston", []);
    expect(t.state.spec.useType).toBe("pediatric clinic");
    expect(describeSpec(t.state.spec)).toMatch(/^a pediatric clinic in Houston/);
    expect(t.reply).not.toMatch(/\bown\b/);
  });
});
