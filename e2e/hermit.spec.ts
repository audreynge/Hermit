import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`)).toEqual([]);
}

const conversation = (page: Page) => page.getByLabel("Conversation");
const cards = (page: Page) => page.locator("article.space");
const quick = (page: Page, name: string) => page.getByRole("group", { name: "Suggested replies" }).getByRole("button", { name });

async function waitForResults(page: Page) {
  await expect(conversation(page)).toContainText(/Would you like me to compare|couldn't find/, { timeout: 45_000 });
}

async function fresh(page: Page, path = "/") {
  await page.goto(path);
  await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
  await page.goto(path);
}

const RICH = "I'm looking for a space for a small medical clinic in Houston. I need about 1,200-1,800 sq ft, with 3 exam rooms, a reception area, and some storage.";

async function chatToResults(page: Page) {
  await fresh(page);
  await page.getByLabel("Message Hermit").fill(RICH);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(conversation(page)).toContainText("Perfect, I have what I need");
  await waitForResults(page);
}

test.describe("chat onboarding", () => {
  test("one Chat tab greets you and offers tap-to-answer choices", async ({ page }) => {
    await fresh(page);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link")).toHaveText(["Chat", "Saved"]);
    await expect(nav.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await expect(quick(page, "Medical / dental clinic")).toBeVisible();
    await axe(page);
  });

  test("the survey questions arrive one at a time, including a must-haves card", async ({ page }) => {
    await fresh(page);
    await quick(page, "Medical / dental clinic").click();
    await expect(conversation(page)).toContainText("Houston or Los Angeles");
    await quick(page, "Houston").click();
    await expect(conversation(page)).toContainText("how much space");
    await quick(page, "1,000 – 2,500 sq ft").click();
    await expect(conversation(page)).toContainText("How many exam rooms");
    await quick(page, "3 exam rooms with sinks").click();
    const card = page.getByRole("group", { name: "Choose all that apply" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "ADA Accessible" }).click();
    await card.getByRole("button", { name: "On-site Parking" }).click();
    await expect(card.getByRole("button", { name: "ADA Accessible" })).toHaveAttribute("aria-pressed", "true");
    await axe(page);
    await card.getByRole("button", { name: "Done" }).click();
    await expect(conversation(page)).toContainText("ADA Accessible, On-site Parking");
    await expect(conversation(page)).toContainText("Checking accessibility");
    await expect(conversation(page)).toContainText("Counting parking");
    await waitForResults(page);

    const n = await cards(page).count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(5);
    await expect(cards(page).first().locator(".fit-badge")).toContainText(/\d+% Fit/);
    await expect(cards(page).first().locator("li")).toHaveCount(3);
    const trace = page.getByRole("region", { name: "Agent trace" });
    await expect(trace).toContainText(/Searched \d+ candidates/);
    await expect(trace).toContainText(/Ranked \d+ matching space/);
    await trace.getByText("See every step").click();
    await expect(page.getByLabel("Full agent trace")).toContainText("search_shells");
    await axe(page);
  });

  test("a single detailed message searches right away", async ({ page }) => {
    await chatToResults(page);
    await expect(conversation(page)).toContainText(/I found \d+ .*best fit \(\d+%\)/);
    await expect(cards(page).first()).toBeVisible();
  });

  test("old /search links land on the chat", async ({ page }) => {
    await page.goto("/search");
    await expect(page).toHaveURL(/\/(\?c=.*)?$/);
    await expect(conversation(page)).toBeVisible();
  });
});

test.describe("results", () => {
  test.beforeEach(async ({ page }) => {
    await chatToResults(page);
  });

  test("email drafts are obvious, editable and never sent", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const btn = cards(page).first().getByRole("button", { name: "Email manager" });
    await btn.click();
    const dialog = page.getByRole("dialog", { name: "Email the property manager" });
    await expect(dialog.getByLabel("Subject")).toHaveValue(/^Inquiry about /);
    await expect(dialog.getByLabel("Message")).toHaveValue(/medical clinic/);
    await expect(dialog.getByRole("link", { name: "Open in my email app" })).toHaveAttribute("href", /^mailto:/);
    await expect(dialog).toContainText("never sends it");
    await dialog.getByLabel("Message").fill("Hello, is the suite available in March?");
    await dialog.getByRole("button", { name: "Copy email" }).click();
    await expect(dialog.getByRole("status")).toContainText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("available in March");
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(btn).toBeFocused();

    await quick(page, "Draft an email").click();
    await expect(page.getByRole("dialog", { name: "Email the property manager" })).toBeVisible();
  });

  test("full report, printable page and saving", async ({ page }) => {
    await cards(page).first().getByRole("button", { name: "Full report" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "What Hermit checked" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "source" }).first()).toHaveAttribute("href", /^https:/);
    await dialog.getByRole("link", { name: "Open printable report" }).click();
    await expect(page).toHaveURL(/\/shell\/.+\?run=/);
    await expect(page.getByRole("heading", { name: "Fit overlay" })).toBeVisible();
    await axe(page);

    await page.goBack();
    await expect(cards(page).first()).toBeVisible();
    const name = await cards(page).first().locator("h3").innerText();
    await cards(page).first().getByRole("button", { name: "Save" }).click();
    await expect(cards(page).first().getByRole("button", { name: "Saved" })).toBeVisible();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Saved" }).click();
    await expect(page).toHaveURL(/\/saved$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Saved spaces");
    await expect(page.locator("article.space")).toHaveCount(1);
    await expect(page.locator("article.space h3")).toContainText(name);
    await axe(page);
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText("No saved spaces yet.")).toBeVisible();
  });

  test("reloading keeps the conversation and results; saved spaces stay with this browser", async ({ page, browser }) => {
    await expect(page).toHaveURL(/[?&]c=c_[a-f0-9]{24}/);
    const name = await cards(page).first().locator("h3").innerText();
    await cards(page).first().getByRole("button", { name: "Save" }).click();
    await expect(cards(page).first().getByRole("button", { name: "Saved" })).toBeVisible();
    await page.reload();
    await expect(conversation(page)).toContainText("Perfect, I have what I need");
    await expect(conversation(page)).toContainText(/Would you like me to compare/);
    await expect(cards(page).first().locator("h3")).toHaveText(name);
    await expect(cards(page).first().getByRole("button", { name: "Saved" })).toBeVisible();

    const other = await browser.newContext();
    const p2 = await other.newPage();
    await p2.goto(page.url());
    await expect(p2.getByLabel("Conversation")).toContainText("Perfect, I have what I need");
    await p2.goto("/saved");
    await expect(p2.getByText("No saved spaces yet.")).toBeVisible();
    await other.close();
  });

  test("regulations are researched, shown on reports, and answer permit questions", async ({ page }) => {
    await expect(conversation(page)).toContainText("Researching Houston and Texas rules for a medical clinic");
    await cards(page).first().getByRole("button", { name: "Full report" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Rules that may apply" })).toBeVisible();
    await expect(dialog.getByRole("region", { name: "City rules" }).getByRole("link", { name: "source" }).first()).toHaveAttribute("href", /^https:\/\//);
    await expect(dialog.getByRole("region", { name: "Federal rules" })).toContainText(/ADA/);
    await page.keyboard.press("Escape");
    await page.getByLabel("Message Hermit").fill("what permits do I need?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("Here are the rules I found");
    await expect(conversation(page).getByRole("region", { name: "City rules" })).toBeVisible();
    await page.reload();
    await expect(conversation(page).getByRole("region", { name: "City rules" })).toBeVisible();
  });

  test("View property opens a 3D tour that jumps between your rooms", async ({ page }) => {
    await cards(page).first().getByRole("button", { name: "View property" }).click();
    const dialog = page.getByRole("dialog");
    const frame = dialog.locator("iframe");
    await expect(frame).toHaveAttribute("src", /my\.matterport\.com\/show\/\?m=[A-Za-z0-9]+/);
    await expect(frame).not.toHaveAttribute("src", /ss=/);
    const stops = dialog.getByRole("navigation", { name: "Jump to a room" }).getByRole("button");
    await expect(stops.first()).toBeVisible();
    await stops.first().click();
    await expect(stops.first()).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator("iframe")).toHaveAttribute("src", /&ss=\d+/);
    await dialog.getByRole("tab", { name: "Aerial" }).click();
    await expect(dialog.getByRole("img", { name: /Aerial image/ })).toBeVisible();
    await dialog.getByRole("tab", { name: "Fit" }).click();
    await expect(dialog.locator("figure")).toBeVisible();
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("Inside, Above and Fit open evidence for the selected space", async ({ page }) => {
    if ((await cards(page).count()) > 1) {
      await cards(page).nth(1).locator("h3 button").click();
      await expect(cards(page).nth(1)).toHaveAttribute("data-selected", "true");
    }
    await page.getByRole("button", { name: "Inside" }).click();
    const panel = page.locator("#evidence-panel");
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Open 3D tour" }).click();
    await expect(panel.locator("iframe")).toHaveAttribute("src", /my\.matterport\.com/);
    await page.getByRole("button", { name: "Above" }).click();
    await expect(panel.getByRole("img", { name: /Aerial image/ })).toBeVisible();
    await page.getByRole("button", { name: "Fit" }).click();
    await expect(panel.locator("figure")).toBeVisible();
    await page.getByRole("button", { name: "Fit" }).click();
    await expect(panel).toBeHidden();
  });

  test("follow-ups compare layouts and refine the search", async ({ page }) => {
    await quick(page, "Compare the layouts").click();
    const table = page.locator("table.compare");
    await expect(table).toBeVisible();
    await expect(table).toContainText("Rooms already built");
    await page.getByLabel("Message Hermit").fill("actually make it 2,500-4,000 sq ft");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("Updating your search");
    await expect(conversation(page)).toContainText(/2,500–4,000 sq ft/);
    await expect(conversation(page).getByText(/Would you like me to compare/)).toHaveCount(2, { timeout: 45_000 });
  });
});

test.describe("designs in the chat", () => {
  test("draw a layout inside the chat, then match it", async ({ page }) => {
    await fresh(page);
    await page.getByRole("button", { name: "Add a design" }).click();
    await page.getByRole("menuitem", { name: "Draw a layout" }).click();
    const sheet = page.getByRole("dialog", { name: "Build your layout" });
    const canvas = sheet.getByRole("application");
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);

    await sheet.getByRole("button", { name: "Add Office" }).click();
    await expect(canvas).toHaveAttribute("aria-label", /6 rooms/);
    await sheet.getByRole("button", { name: "Undo" }).click();
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);
    await sheet.getByRole("button", { name: "Redo" }).click();
    const office = sheet.getByRole("button", { name: /^Office, 10 by 10 feet/ });
    await office.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Delete");
    await expect(canvas).toHaveAttribute("aria-label", /5 rooms/);
    const before = Number((await canvas.getAttribute("aria-label"))!.match(/(\d+) objects/)![1]);
    await sheet.getByRole("button", { name: "Add Sink" }).dragTo(sheet.locator(".canvas"), { targetPosition: { x: 200, y: 200 } });
    await expect(canvas).toHaveAttribute("aria-label", new RegExp(`${before + 1} objects`));
    await sheet.getByLabel("Zoom", { exact: true }).selectOption("150");
    await sheet.getByRole("button", { name: "Zoom out" }).click();
    await expect(sheet.getByLabel("Zoom", { exact: true })).toHaveValue("125");
    const snap = sheet.getByRole("switch", { name: /Snap to grid/ });
    await snap.click();
    await expect(snap).toHaveAttribute("aria-checked", "false");
    await axe(page);

    await sheet.getByRole("button", { name: /Use this layout/ }).click();
    await expect(sheet).toBeHidden();
    await expect(conversation(page)).toContainText("Here's my layout");
    await expect(conversation(page)).toContainText("2 exam rooms with sinks");
    await expect(conversation(page).getByRole("img", { name: /Drawn layout with 5 rooms/ })).toBeVisible();
    await quick(page, "Houston").click();
    await quick(page, "None of these").click();
    await waitForResults(page);

    await page.reload();
    await expect(conversation(page).getByRole("img", { name: /Drawn layout/ })).toBeVisible();
  });

  test("/layout opens the drawing sheet in the chat", async ({ page }) => {
    await page.goto("/layout");
    await expect(page.getByRole("dialog", { name: "Build your layout" })).toBeVisible();
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Build your layout" })).toBeHidden();
    await expect(conversation(page)).toBeVisible();
  });

  test("uploading a floor plan continues the conversation", async ({ page }) => {
    await page.route("**/api/design", async (route) => {
      const body = { conversationId: "x", turn: { reply: "I read your floor plan: 3 exam rooms, a reception. Which city should I search: Houston or Los Angeles?", state: { spec: { mode: "business", useType: "medical clinic", rooms: [{ label: "exam room", count: 3, hard: false }], needs: {}, priorities: {}, input: "layout" }, asked: ["size", "rooms", "city"], phase: "gathering" }, ready: false, quickReplies: ["Houston", "Los Angeles"] } };
      await route.fulfill({ json: body });
    });
    await fresh(page);
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.getByRole("button", { name: "Add a design" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Upload a floor plan" }).click();
    await (await chooser).setFiles({ name: "plan.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
    await expect(conversation(page)).toContainText("Uploaded plan.png");
    await expect(conversation(page).getByRole("img", { name: /Uploaded floor plan/ })).toBeVisible();
    await expect(conversation(page)).toContainText("I read your floor plan");
    await expect(quick(page, "Houston")).toBeVisible();
  });

  test("uploads explain the missing key and offer drawing instead", async ({ page }) => {
    test.skip(!!process.env.ANTHROPIC_API_KEY, "only meaningful without a key");
    await fresh(page);
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.locator('input[type="file"]').setInputFiles({ name: "plan.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
    await expect(conversation(page)).toContainText("needs the Claude API key");
    await quick(page, "Draw a layout").click();
    await expect(page.getByRole("dialog", { name: "Build your layout" })).toBeVisible();
  });

  test("oversized uploads are refused before sending", async ({ page }) => {
    await fresh(page);
    await expect(conversation(page)).toContainText(/what kind of space/i);
    await page.locator('input[type="file"]').setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(11 * 1024 * 1024) });
    await expect(conversation(page)).toContainText("over 10 MB");
  });
});

test.describe("other uses", () => {
  test("a warehouse search asks about equipment and screens power", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("Message Hermit").fill("I need a 20,000 sf warehouse in Los Angeles");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("heavy power");
    await quick(page, "Heavy power + 2 drive-in doors").click();
    await expect(conversation(page)).toContainText("Checking electrical requirements");
    await waitForResults(page);
  });

  test("buying a home asks for bedrooms, then must-haves", async ({ page }) => {
    await fresh(page);
    await page.getByLabel("Message Hermit").fill("I want to buy a house in Houston under $450k");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("How many bedrooms");
    await quick(page, "3 bed / 2 bath").click();
    await expect(page.getByRole("group", { name: "Choose all that apply" })).toBeVisible();
    await quick(page, "None of these").click();
    await waitForResults(page);
  });
});

test.describe("replay and failure states", () => {
  test("the recorded demo replays with every outside request blocked", async ({ page }) => {
    await page.route("**/*", (route) => (new URL(route.request().url()).hostname === "localhost" ? route.continue() : route.abort()));
    await fresh(page, "/?replay=demo");
    await expect(conversation(page)).toContainText("recorded run");
    await waitForResults(page);
    await expect(cards(page).first()).toBeVisible();
    await page.getByRole("region", { name: "Agent trace" }).getByText("See every step").click();
    await expect(page.getByLabel("Full agent trace")).toContainText("replay planner");
    await expect(conversation(page)).toContainText(/(medical|dental) clinic/);
    await expect(conversation(page)).not.toContainText("for a space");
  });

  test("a failed search tells you and lets you keep chatting", async ({ page }) => {
    await page.route("**/api/agent", (route) => route.fulfill({ status: 500, body: "boom" }));
    await fresh(page, "/");
    await page.getByLabel("Message Hermit").fill("small medical clinic in Houston, 1,200-1,800 sq ft, 3 exam rooms, a reception area and storage");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(conversation(page)).toContainText("Search failed");
    await expect(page.getByRole("region", { name: "Matching Spaces" }).getByRole("status")).not.toContainText("Searching");
    await page.getByLabel("Message Hermit").fill("try again");
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("APIs validate input and refuse path tricks", async ({ request }) => {
    expect((await request.post("/api/chat", { data: { text: "" } })).status()).toBe(400);
    expect((await request.post("/api/agent", { data: { mode: "nope" } })).status()).toBe(400);
    expect((await request.get("/api/agent?replay=..%2F..%2Fshells")).status()).toBe(404);
    expect((await request.get("/api/asset/..%2Fshells")).status()).toBe(404);
    expect((await request.get("/api/shell/..%2Fshells")).status()).toBe(404);
    const open = await request.post("/api/chat", { data: { open: true, spec: { mode: "business", useType: "", rooms: [], needs: {}, priorities: {}, input: "chat" } } });
    expect(open.status()).toBe(200);
    const opened = await open.json();
    expect(opened.turn.reply).toMatch(/what kind of space/i);
    expect(opened.conversationId).toMatch(/^c_[a-f0-9]{24}$/);
    expect((await request.post("/api/chat", { data: { conversationId: "c_000000000000000000000000", text: "hi" } })).status()).toBe(404);
    expect((await request.get("/api/conversations/..%2Fx")).status()).toBe(404);
    expect((await request.post("/api/saved", { data: { report: {} } })).status()).toBe(400);
    expect((await request.get("/api/regulations?city=paris&useType=salon")).status()).toBe(400);
    const regs = await (await request.get("/api/regulations?city=houston&useType=salon")).json();
    expect(regs.findings.every((f: { url: string }) => f.url.startsWith("https://"))).toBe(true);
  });

  test("missing printable reports fail gracefully", async ({ page }) => {
    await page.goto("/shell/nope?run=nope");
    await expect(page.getByText("Report not found")).toBeVisible();
  });
});

test.describe("layout and motion", () => {
  for (const path of ["/", "/saved", "/?design=draw"]) {
    test(`no horizontal overflow on ${path} @mobile`, async ({ page }) => {
      await page.goto(path);
      await page.waitForTimeout(300);
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(sw).toBeLessThanOrEqual(cw);
    });
  }

  test("reduced motion turns animation off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?design=draw");
    const t = await page.getByRole("button", { name: /Use this layout/ }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(t).toBe("0s");
  });
});
