import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const DENTAL = "Dental clinic in Houston, 2,000-3,000 sq ft, 3 exam rooms with sinks, a waiting room, 2 restrooms, wheelchair accessible";

async function buildSpec(page: Page) {
  await page.getByRole("button", { name: "Build my requirements" }).click();
  await expect(page.getByRole("heading", { name: "Your requirements" })).toBeVisible();
}

async function waitForResults(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: /Shell Reports|Search stopped/ })).toBeVisible({ timeout: 45_000 });
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

test.describe("landing", () => {
  test("pitch, start link and skip link work by keyboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tell Hermit what you need");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.getByRole("link", { name: "Start a search" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/plan/);
    await axe(page);
  });
});

test.describe("business search by text", () => {
  test("text → editable spec → streamed reports with evidence-driven trace", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/plan");
    await page.getByLabel("Describe the space in your own words").fill(DENTAL);
    await buildSpec(page);

    await expect(page.getByLabel("Summary")).toContainText("dental clinic");
    await expect(page.getByLabel("exam room count")).toHaveValue("3");
    await expect(page.getByLabel("bathroom is required")).toBeChecked();
    await page.getByLabel("exam room minimum square feet").fill("90");
    await axe(page);

    const t0 = Date.now();
    await page.getByRole("button", { name: "Find spaces" }).click();
    await expect(page).toHaveURL(/\/results\?spec=/);
    await expect(page.getByRole("heading", { name: /Spaces for a dental clinic/ })).toBeVisible();
    await waitForResults(page);
    expect(Date.now() - t0).toBeLessThan(45_000);

    const cards = page.getByRole("navigation", { name: "Shortlist" }).getByRole("button");
    expect(await cards.count()).toBeGreaterThan(0);
    expect(await cards.count()).toBeLessThanOrEqual(5);
    await expect(cards.first()).toHaveAttribute("aria-pressed", "true");

    const trace = page.getByRole("list", { name: "Agent trace" });
    await expect(trace).toContainText("search_shells");
    await expect(trace.locator(".kind.drop").first()).toBeVisible();
    await expect(trace.locator(".kind.escalate, .kind.rerank").first()).toBeVisible();

    const report = page.locator("article").first();
    await expect(report.getByRole("heading", { name: "Screening checks" })).toBeVisible();
    await expect(report.getByRole("link", { name: "source" }).first()).toHaveAttribute("href", /^https:/);
    await expect(report.locator("pre.draft")).toContainText("dental clinic");
    await report.getByRole("button", { name: "Copy inquiry" }).click();
    await expect(report.getByRole("status")).toContainText("never sends it");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("dental clinic");
    await axe(page);

    if ((await cards.count()) > 1) {
      await cards.nth(1).click();
      await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "true");
    }

    await report.getByRole("link", { name: "Printable report" }).click();
    await expect(page).toHaveURL(/\/shell\/.+\?run=run-/);
    await expect(page.getByRole("heading", { name: "Fit overlay" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Screening checks" })).toBeVisible();
    await axe(page);
  });

  test("Inside / Above / Fit tabs switch with mouse and arrow keys", async ({ page }) => {
    await page.goto("/plan");
    await page.getByLabel("Describe the space in your own words").fill(DENTAL);
    await buildSpec(page);
    await page.getByRole("button", { name: "Find spaces" }).click();
    await waitForResults(page);

    const tabs = page.getByRole("tablist", { name: "Evidence" });
    await expect(tabs.getByRole("tab", { name: "Fit" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel").locator("figure")).toBeVisible();

    await tabs.getByRole("tab", { name: "Fit" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Inside" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("button", { name: "Load 3D tour" })).toBeVisible();
    await expect(page.getByRole("link", { name: "open it in a new tab" })).toHaveAttribute("href", /my\.matterport\.com\/show\/\?m=/);
    await page.getByRole("button", { name: "Load 3D tour" }).click();
    await expect(page.locator("iframe[title^='Matterport 3D tour']")).toHaveAttribute("src", /my\.matterport\.com/);

    await page.keyboard.press("ArrowRight");
    await tabs.getByRole("tab", { name: "Above" }).click();
    await expect(page.getByRole("img", { name: /Aerial image centered on/ })).toBeVisible();
    await expect(page.getByText(/Imagery: Esri World Imagery/)).toBeVisible();
  });
});

test.describe("other input modes", () => {
  test("drawn layout becomes a spec with keyboard-moved rooms", async ({ page }) => {
    await page.goto("/plan");
    await page.getByRole("tab", { name: "Draw a layout" }).click();
    await expect(page.getByRole("button", { name: "Build my requirements" })).toBeDisabled();
    await page.getByRole("button", { name: "+ exam room" }).click();
    await page.getByRole("button", { name: "+ exam room" }).click();
    await page.getByRole("button", { name: "+ bathroom" }).click();
    await page.getByLabel("Custom room name").fill("sterilization");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    const block = page.getByRole("button", { name: /^bathroom, 7 by 8 feet/ });
    await block.focus();
    const before = await block.getAttribute("aria-label");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+ArrowRight");
    await expect(block).not.toHaveAttribute("aria-label", before!);
    await expect(page.getByText(/4 rooms · \d+ sf drawn/)).toBeVisible();

    await buildSpec(page);
    await expect(page.getByLabel("Summary")).toContainText("via layout");
    await expect(page.getByLabel("exam room count")).toHaveValue("2");
    await expect(page.getByLabel("sterilization count")).toHaveValue("1");
    await page.getByRole("button", { name: "Find spaces" }).click();
    await waitForResults(page);
  });

  test("voice input fills the request via the Web Speech API", async ({ page }) => {
    await page.addInitScript(() => {
      class FakeRec {
        lang = ""; interimResults = false;
        onresult: (e: unknown) => void = () => {}; onend: () => void = () => {}; onerror: () => void = () => {};
        start() { setTimeout(() => { this.onresult({ results: [[{ transcript: "hair salon in Los Angeles about 1500 square feet" }]] }); this.onend(); }, 50); }
      }
      (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRec;
    });
    await page.goto("/plan");
    await page.getByRole("tab", { name: "Say it" }).click();
    await page.getByRole("button", { name: "Start speaking" }).click();
    await expect(page.getByLabel("Describe the space in your own words")).toHaveValue(/hair salon/);
    await buildSpec(page);
    await expect(page.getByLabel("Summary")).toContainText("via voice");
    await expect(page.getByLabel("Summary")).toContainText("Los Angeles");
  });

  test("voice falls back to a message when speech is unsupported", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w.SpeechRecognition;
      delete w.webkitSpeechRecognition;
    });
    await page.goto("/plan");
    await page.getByRole("tab", { name: "Say it" }).click();
    await page.getByRole("button", { name: "Start speaking" }).click();
    await expect(page.getByText(/isn't supported in this browser/)).toBeVisible();
  });

  test("survey only builds a spec from the form fields", async ({ page }) => {
    await page.goto("/plan");
    await page.getByLabel("City").selectOption("los_angeles");
    await page.getByLabel("Intended use").fill("creative office");
    await page.getByLabel("Min sf").fill("1500");
    await page.getByLabel("Max sf").fill("4000");
    await page.getByLabel("Wheelchair accessible").check();
    await page.getByRole("tab", { name: "Survey only" }).click();
    await buildSpec(page);
    await expect(page.getByLabel("Summary")).toContainText("via survey");
    await expect(page.getByLabel("Summary")).toContainText("1,500–4,000 sf");
    await page.getByRole("button", { name: "Find spaces" }).click();
    await waitForResults(page);
  });
});

test.describe("modes", () => {
  test("enterprise warehouse search screens power, sprinklers and bays", async ({ page }) => {
    await page.goto("/plan");
    await page.getByLabel("Industrial / site").check();
    await page.getByLabel("Describe the space in your own words").fill("Need a 20,000 sf warehouse in LA with heavy power, ESFR sprinklers and 2 drive-in doors");
    await buildSpec(page);
    await expect(page.getByLabel("Summary")).toContainText("enterprise");
    await expect(page.getByRole("region", { name: "Your requirements" }).getByLabel("Heavy power")).toBeChecked();
    await page.getByRole("button", { name: "Find spaces" }).click();
    await waitForResults(page);
    await expect(page.getByRole("list", { name: "Agent trace" })).toContainText(/electrical|fire|drive_in_bays/);
  });

  test("home search compares listing and measured size", async ({ page }) => {
    await page.goto("/plan");
    await page.getByLabel("Home", { exact: true }).check();
    await page.getByLabel("Describe the space in your own words").fill("3 bedroom 2 bath house in Houston under $450k with a home office");
    await buildSpec(page);
    await expect(page.getByLabel("Summary")).toContainText("3 bd");
    await page.getByRole("button", { name: "Find spaces" }).click();
    await waitForResults(page);
    await expect(page.locator("article").first()).toContainText(/measured size/);
  });
});

test.describe("replay and failure states", () => {
  test("replay works with every external request blocked", async ({ page }) => {
    const external: string[] = [];
    await page.route("**/*", (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === "localhost") return route.continue();
      external.push(u.hostname);
      return route.abort();
    });
    await page.goto("/results?replay=demo");
    await expect(page.getByRole("heading", { name: "Recorded run" })).toBeVisible();
    await waitForResults(page);
    await expect(page.getByRole("status").filter({ hasText: "replay planner" })).toBeVisible();
    await expect(page.getByRole("tabpanel").locator("figure")).toBeVisible();
    await page.getByRole("tab", { name: "Above" }).click();
    await expect(page.getByText(/couldn't load/)).toBeVisible();
  });

  test("invalid search links and missing runs fail gracefully", async ({ page }) => {
    await page.goto("/results?spec=garbage");
    await expect(page.getByRole("alert").filter({ hasText: "invalid" })).toBeVisible();
    await page.goto("/results?replay=run-doesnotexist");
    await expect(page.getByRole("alert").filter({ hasText: "No recorded run" })).toBeVisible();
    await page.goto("/shell/nope?run=nope");
    await expect(page.getByText("Report not found")).toBeVisible();
  });

  test("APIs validate input and refuse path tricks", async ({ request }) => {
    expect((await request.post("/api/agent", { data: { mode: "nope" } })).status()).toBe(400);
    expect((await request.post("/api/spec", { data: { input: "bogus" } })).status()).toBe(400);
    expect((await request.get("/api/agent?replay=..%2F..%2Fshells")).status()).toBe(404);
    expect((await request.get("/api/shell/..%2Fshells")).status()).toBe(404);
  });
});

test.describe("layout and theming", () => {
  for (const path of ["/", "/plan", "/results?replay=demo"]) {
    test(`no horizontal overflow on ${path} @mobile`, async ({ page }) => {
      await page.goto(path);
      if (path.includes("replay")) await waitForResults(page);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw).toBeLessThanOrEqual(cw);
    });
  }

  test("dark mode swaps the palette and stays accessible", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/plan");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe("rgb(15, 26, 43)");
    await axe(page);
  });

  test("reduced motion disables transitions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const t = await page.getByRole("link", { name: "Start a search" }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(t).toBe("0s");
  });
});
