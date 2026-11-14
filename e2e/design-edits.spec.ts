import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Runs without an API key: chat edits go through the deterministic offline parser.
const conversation = (page: Page) => page.getByLabel("Conversation");
const cards = (page: Page) => page.locator("article.space");
const say = async (page: Page, text: string) => {
  await page.getByLabel("Message Hermit").fill(text);
  await page.getByLabel("Message Hermit").press("Enter");
};

async function fresh(page: Page, path = "/") {
  await page.goto(path);
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.goto(path);
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

async function homeResults(page: Page) {
  await fresh(page);
  await page.getByLabel("City").selectOption("houston");
  await page.getByRole("radio", { name: "Buy" }).click();
  await page.getByLabel("Use Type").selectOption("home");
  await page.getByRole("button", { name: "Find shells" }).click();
  await expect(conversation(page)).toContainText("How many bedrooms");
  await page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name: "3 bed / 2 bath" }).click();
  await expect(conversation(page)).toContainText(/Would you like me to compare|couldn't find/, { timeout: 45_000 });
  // Pick a scanned ("measured") home; both sample homes have bedrooms b1/b2 and an office or more bedrooms.
  const scanned = cards(page).filter({ hasText: "measured" }).first();
  await scanned.locator("h3 button").click();
}

test.describe("design edits in chat", () => {
  test("[E1] saved layout -> search -> chat adds an exam room; the saved layout and Layout Studio both show it", async ({ page }) => {
    await fresh(page, "/layout");
    await page.getByLabel("Layout name").fill("Clinic A");
    await page.getByRole("button", { name: "Save layout" }).click();
    await page.goto("/");
    await page.getByLabel("City").selectOption("houston");
    await page.getByLabel(/Layout/).selectOption({ label: "Clinic A" });
    await page.getByRole("button", { name: "Find shells" }).click();
    await expect(conversation(page)).toContainText("Use my layout \u201cClinic A\u201d");
    await say(page, "add another exam room");
    const preview = conversation(page).getByRole("img", { name: /Your layout:/ }).last();
    await expect(preview).toHaveAttribute("aria-label", /Exam Room 3/);
    await expect(page.getByLabel("Message Hermit")).toBeFocused();
    await axe(page);
    await page.goto("/layout");
    await expect(page.getByRole("application")).toHaveAttribute("aria-label", /6 rooms/);
    await expect(page.getByLabel("Layout name")).toHaveValue("Clinic A");
    await expect(page.getByRole("listitem").filter({ hasText: "Clinic A" })).toContainText("6 rooms");
  });

  test("[E2] fit tab: convert a bedroom, see the change, undo restores the measured plan", async ({ page }) => {
    await homeResults(page);
    await say(page, "turn bedroom 2 into an exam room");
    const panel = page.locator("#evidence-panel");
    const strip = panel.getByRole("group", { name: "Proposed changes" });
    await expect(strip).toContainText(/fit \d+ → \d+/);
    await expect(strip).toContainText(/known work \$\d+k/);
    await expect(panel.getByRole("img", { name: /proposed changes to exam room/ })).toBeVisible();
    await axe(page);
    await strip.getByRole("button", { name: "Undo" }).click();
    await expect(strip).toBeHidden();
    await expect(panel.getByRole("img", { name: /Floor plan of/ })).not.toHaveAttribute("aria-label", /proposed/);
  });

  test("[E3] keyboard only: Keep and Undo are reachable; focus returns to the chat after an edit", async ({ page }) => {
    await homeResults(page);
    await say(page, "add a sink to the office");
    await expect(page.getByLabel("Message Hermit")).toBeFocused();
    const keep = page.getByRole("group", { name: "Proposed changes" }).getByRole("button", { name: "Keep" });
    await keep.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Proposed changes" })).toContainText("(kept)");
    await page.getByRole("group", { name: "Proposed changes" }).getByRole("button", { name: "Undo" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Proposed changes" })).toBeHidden();
    await page.getByLabel("Message Hermit").focus();
    await say(page, "undo");
    await expect(conversation(page)).toContainText(/nothing to undo|Undone/);
    await expect(page.getByLabel("Message Hermit")).toBeFocused();
  });

  test("[E4] a record-only space answers a fit-out request with 'no scan to edit'", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("City").selectOption("los_angeles");
    await page.getByLabel("Use Type").selectOption("office");
    await page.getByRole("button", { name: "Find shells" }).click();
    await say(page, "just search");
    await expect(conversation(page)).toContainText(/Would you like me to compare|couldn't find/, { timeout: 45_000 });
    await say(page, "turn the office into an exam room");
    await expect(conversation(page)).toContainText(/no scan to edit|record-only/);
    await expect(page.locator("#evidence-panel").getByRole("group", { name: "Proposed changes" })).toHaveCount(0);
  });

  test("[E5] reload keeps the layout and kept proposal; blocked storage doesn't crash", async ({ page, browser }) => {
    await homeResults(page);
    await say(page, "turn bedroom 1 into an office");
    await page.getByRole("group", { name: "Proposed changes" }).getByRole("button", { name: "Keep" }).click();
    await page.reload();
    await page.getByRole("button", { name: "Fit" }).click();
    await expect(page.getByRole("group", { name: "Proposed changes" })).toContainText("(kept)");

    const blocked = await browser.newPage();
    await blocked.addInitScript(() => {
      for (const k of ["sessionStorage", "localStorage"]) Object.defineProperty(window, k, { get() { throw new Error("blocked"); } });
    });
    await blocked.goto("/layout");
    await expect(blocked.getByRole("heading", { level: 1 })).toContainText("Build your layout");
    await blocked.getByRole("button", { name: "Save layout" }).click();
    await expect(blocked.getByRole("status")).toContainText("Couldn't save");
    await blocked.goto("/");
    await blocked.getByRole("button", { name: "Find shells" }).click();
    await expect(blocked).toHaveURL(/\/search$/);
    await blocked.getByLabel("Message Hermit").fill("add an office");
    await blocked.getByLabel("Message Hermit").press("Enter");
    await expect(blocked.getByLabel("Conversation")).not.toContainText("Something went wrong");
    await blocked.close();
  });
});
