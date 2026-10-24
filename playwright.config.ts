import { defineConfig } from "@playwright/test";

// Uses the locally installed Google Chrome (channel "chrome") so tests run with real GPU WebGL where available.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://localhost:3200", viewport: { width: 1600, height: 950 }, colorScheme: "dark", trace: "retain-on-failure" },
  webServer: { command: "npm run start -- -p 3200", url: "http://localhost:3200", reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: "webgl", testIgnore: /fallback/, use: { channel: "chrome", launchOptions: { args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] } } },
    { name: "no-webgl", testMatch: /fallback/, use: { channel: "chrome", launchOptions: { args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"] } } },
  ],
});
