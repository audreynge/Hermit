import { defineConfig, devices } from "@playwright/test";

// E2E_PORT runs the tests against a separate dev server (e.g. when 3000 is taken by another checkout).
const port = process.env.E2E_PORT ?? "3000", url = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: url, trace: "retain-on-failure" },
  projects: [
    // SwiftShader gives headless Chromium WebGL, which the Matterport 3D tour needs.
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: { command: `npx next dev -p ${port}`, url, reuseExistingServer: true, timeout: 120_000 },
});
