// Performance probe against a running production server (default http://localhost:3200).
//   node tests/perf/measure.mjs [url]
// Reports first-usable timing, single-view and comparison frame rates, and asset transfer sizes.
import { chromium } from "@playwright/test";
const url = process.argv[2] ?? "http://localhost:3200";
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const transfers = [];
page.on("response", async (r) => { if (r.url().includes("/models/")) transfers.push({ url: r.url().split("/").pop(), status: r.status(), encoding: r.headers()["content-encoding"] ?? "none", bytes: Number(r.headers()["content-length"] ?? 0) }); });
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => Number(document.querySelector("[data-frames]")?.getAttribute("data-frames") ?? 0) >= 30, null, { timeout: 60000 });
const firstUsableMs = Date.now() - t0;
async function fps(ms) {
  const rafFps = await page.evaluate((ms) => new Promise((res) => { let n = 0; const s = performance.now(); const f = () => { n++; if (performance.now() - s < ms) requestAnimationFrame(f); else res((n * 1000) / (performance.now() - s)); }; requestAnimationFrame(f); }), ms);
  return Math.round(rafFps * 10) / 10;
}
await page.waitForTimeout(3000); // allow the high LOD to arrive
const single = await fps(5000);
await page.getByRole("button", { name: "Compare patients" }).click();
for (const n of ["Synthetic 03", "Synthetic 04"]) await page.getByRole("checkbox", { name: new RegExp(`Compare ${n}`) }).check();
await page.waitForTimeout(2500);
const compare4 = await fps(5000);
const mem = await page.evaluate(() => (performance).memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null);
const gpu = await page.evaluate(() => { const c = document.createElement("canvas").getContext("webgl2"); const e = c?.getExtension("WEBGL_debug_renderer_info"); return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : "unknown"; });
console.log(JSON.stringify({ url, gpu, firstUsableMs, fpsSingleView: single, fpsCompareFourViews: compare4, jsHeapMB: mem, transfers }, null, 2));
await browser.close();
