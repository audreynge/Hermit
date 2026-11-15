import { expect, test, type Page } from "@playwright/test";

// The review walkthrough run after every wave. It saves screenshots to test-results/walk/ (gitignored) for review
// and uses soft checks, so one problem doesn't hide the rest. Point it at a run with WALK_RUN and WALK_SHELL.
// Run: npx playwright test e2e/walk.spec.ts --project=desktop   (and --project=mobile for the @mobile checks)
const RUN = process.env.WALK_RUN ?? "priya-det";
const SHELL = process.env.WALK_SHELL ?? "EK8LMNkDsv3";
const OUT = "test-results/walk/";
const BANNED = [/\bcrew\b/i, /compliant/i, /guaranteed/i, /middleman/i, /\ban own\b/i, /\bown clinic\b/i, /kit is loaded/i, /undefined|NaN/];

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(matterport|vexcel|arcgis)/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  return errors;
}

async function checkCopy(page: Page, where: string) {
  const text = await page.locator("body").innerText();
  for (const re of BANNED) expect.soft(text.match(re)?.[0] ?? null, `${where}: banned or broken copy ${re}`).toBeNull();
}

test("home page", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.screenshot({ path: `${OUT}home.png`, fullPage: true });
  await checkCopy(page, "home");
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: `${OUT}home-dark.png` });
  expect.soft(errors, "home console errors").toEqual([]);
});

test("recorded run in Find a space", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/studio?replay=${RUN}`);
  await expect(page.getByText(/Matching Spaces/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/How Hermit decided/)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${OUT}studio-results.png`, fullPage: true });
  await checkCopy(page, "studio");
  expect.soft(errors, "studio console errors").toEqual([]);
});

test("every Shell Report tab", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/shell/${SHELL}?run=${RUN}`);
  const tabs = await page.getByRole("tab").allInnerTexts();
  expect(tabs.length).toBeGreaterThanOrEqual(4);
  for (const [i, name] of tabs.entries()) {
    await page.getByRole("tab", { name: name.trim() }).click();
    await page.waitForTimeout(/Inside/.test(name) ? 6000 : 1500);
    const panel = page.locator("#report-panel");
    expect.soft((await panel.innerText()).trim().length, `${name} tab has content`).toBeGreaterThan(40);
    await page.screenshot({ path: `${OUT}report-${i}-${name.trim().replace(/\W+/g, "-").toLowerCase()}.png`, fullPage: true });
    await checkCopy(page, `report/${name.trim()}`);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("tab").first().click();
  await page.screenshot({ path: `${OUT}report-dark.png`, fullPage: true });
  expect.soft(errors, "report console errors").toEqual([]);
});

test("report on a phone @mobile", async ({ page }) => {
  await page.goto(`/shell/${SHELL}?run=${RUN}`);
  await page.screenshot({ path: `${OUT}report-mobile.png`, fullPage: true });
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), "no horizontal scroll").toBe(false);
});
