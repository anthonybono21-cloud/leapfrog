// ─── Stealth Self-Test CLI ─────────────────────────────────────────────────
//
// Usage: npx leapfrog --stealth-audit [--local-only] [--full] [--json] [--headed]
//
// Launches a real stealth-patched browser (same as session_create) and runs
// automated checks against all 19 stealth patches. Returns pass/fail/warn
// for each check with exit code 0 (all pass) or 1 (any fail).
//
// Tiers:
//   Tier 1 — Local checks on about:blank (~2s, always run)
//   Tier 2 — External bot-detection sites (~12s, default)
//   Tier 3 — Extended checks (~45s, --full flag)
//

import { chromium } from "playwright-core";
import type { Browser, BrowserContext, Page } from "playwright-core";
import { stealth } from "./stealth.js";
import { generateFingerprint } from "./humanize-fingerprint.js";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuditResult {
  label: string;
  status: "pass" | "fail" | "warn";
  detail?: string;
  tier: 1 | 2 | 3;
  priority?: string;
}

export interface AuditOptions {
  localOnly?: boolean;
  full?: boolean;
  json?: boolean;
  headed?: boolean;
}

// ── Tier 1: Local Checks ──────────────────────────────────────────────────

async function runLocalChecks(page: Page): Promise<AuditResult[]> {
  // Run one big evaluate to avoid round-trip overhead
  const raw = await page.evaluate(() => {
    const results: Array<{ label: string; pass: boolean; detail?: string; priority?: string }> = [];

    // Helper
    function check(label: string, pass: boolean, detail?: string, priority?: string) {
      results.push({ label, pass, detail, priority });
    }

    // 1. P0 navigator.webdriver hidden (typeof)
    check(
      "P0 navigator.webdriver typeof",
      typeof (navigator as any).webdriver === "undefined",
      `typeof = "${typeof (navigator as any).webdriver}"`,
      "P0",
    );

    // 2. P0 navigator.webdriver hidden (in operator)
    check(
      "P0 navigator.webdriver 'in' check",
      !("webdriver" in navigator),
      `'webdriver' in navigator = ${("webdriver" in navigator)}`,
      "P0",
    );

    // 3. P0 Client Hints — no HeadlessChrome
    let clientHintsClean = true;
    let clientHintsDetail = "N/A";
    if ((navigator as any).userAgentData) {
      const brands = (navigator as any).userAgentData.brands || [];
      const brandNames = brands.map((b: any) => b.brand).join(", ");
      clientHintsClean = !brandNames.includes("HeadlessChrome");
      clientHintsDetail = brandNames;
    }
    check("P0 Client Hints clean", clientHintsClean, clientHintsDetail, "P0");

    // 4. P0 UA string — no HeadlessChrome
    check(
      "P0 UA string clean",
      !navigator.userAgent.includes("HeadlessChrome"),
      navigator.userAgent.substring(0, 60) + "...",
      "P0",
    );

    // 5. Plugins count >= 5
    check(
      "P2 navigator.plugins count",
      navigator.plugins.length >= 5,
      `${navigator.plugins.length} plugins`,
      "P2",
    );

    // 6. MimeTypes count >= 2
    check(
      "P2 navigator.mimeTypes count",
      navigator.mimeTypes.length >= 2,
      `${navigator.mimeTypes.length} mimeTypes`,
      "P2",
    );

    // 7. navigator.languages non-empty
    check(
      "navigator.languages",
      Array.isArray(navigator.languages) && navigator.languages.length > 0,
      JSON.stringify(navigator.languages),
    );

    // 8. navigator.platform matches UA
    const uaHasWin = /Windows/i.test(navigator.userAgent);
    const uaHasMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
    const uaHasLinux = /Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent);
    let platformMatch = true;
    if (uaHasWin && navigator.platform !== "Win32") platformMatch = false;
    if (uaHasMac && navigator.platform !== "MacIntel") platformMatch = false;
    if (uaHasLinux && !navigator.platform.startsWith("Linux")) platformMatch = false;
    check(
      "P2 platform matches UA",
      platformMatch,
      `platform="${navigator.platform}" UA=${uaHasWin ? "Win" : uaHasMac ? "Mac" : uaHasLinux ? "Linux" : "other"}`,
      "P2",
    );

    // 9. navigator.connection.rtt > 0
    const conn = (navigator as any).connection;
    check(
      "P1 connection.rtt > 0",
      conn ? conn.rtt > 0 : false,
      conn ? `rtt=${conn.rtt}` : "no connection API",
      "P1",
    );

    // 10. window.chrome exists
    check(
      "window.chrome exists",
      !!(window as any).chrome,
      (window as any).chrome ? "present" : "missing",
    );

    // 11. window.chrome.app exists
    check(
      "chrome.app emulation",
      !!(window as any).chrome?.app,
      (window as any).chrome?.app ? "present" : "missing",
    );

    // 12. outerHeight - innerHeight > 0
    const heightOffset = window.outerHeight - window.innerHeight;
    check(
      "P2 outerHeight offset",
      heightOffset > 0,
      `expected > 0, got ${heightOffset}`,
      "P2",
    );

    // 13. document.hasFocus() === true
    check(
      "document.hasFocus()",
      document.hasFocus() === true,
      `${document.hasFocus()}`,
    );

    // 14. WebGL UNMASKED_VENDOR — no SwiftShader
    let webglVendor = "N/A";
    let webglRenderer = "N/A";
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          webglVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || "";
          webglRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
        }
      }
    } catch { /* no WebGL */ }
    check(
      "P1 WebGL vendor clean",
      !webglVendor.includes("SwiftShader"),
      webglVendor,
      "P1",
    );

    // 15. WebGL UNMASKED_RENDERER — no SwiftShader
    check(
      "P1 WebGL renderer clean",
      !webglRenderer.includes("SwiftShader"),
      webglRenderer,
      "P1",
    );

    // 16. Permissions.query resolves
    // (can't await in sync evaluate — checked separately)
    // We'll set a flag and handle it outside
    results.push({
      label: "P2 permissions.query",
      pass: typeof navigator.permissions?.query === "function",
      detail: typeof navigator.permissions?.query === "function" ? "function present" : "missing",
      priority: "P2",
    });

    // 17. navigator.hardwareConcurrency > 0
    check(
      "hardwareConcurrency",
      navigator.hardwareConcurrency > 0,
      `${navigator.hardwareConcurrency}`,
    );

    // 18. navigator.deviceMemory > 0
    check(
      "deviceMemory",
      ((navigator as any).deviceMemory ?? 0) > 0,
      `${(navigator as any).deviceMemory ?? "undefined"}`,
    );

    // 19. No __pwInitScripts global
    check(
      "Playwright global __pwInitScripts",
      typeof (window as any).__pwInitScripts === "undefined",
      `typeof = "${typeof (window as any).__pwInitScripts}"`,
    );

    // 20. No __playwright global
    check(
      "Playwright global __playwright",
      typeof (window as any).__playwright === "undefined",
      `typeof = "${typeof (window as any).__playwright}"`,
    );

    // 21. Audio canPlayType('audio/mpeg')
    let audioResult = "";
    try {
      audioResult = new Audio().canPlayType("audio/mpeg");
    } catch { /* */ }
    check(
      "Media codecs (audio/mpeg)",
      audioResult === "probably",
      `canPlayType = "${audioResult}"`,
    );

    // 22. document.fonts.check('12px Arial')
    let fontCheck = false;
    try {
      fontCheck = document.fonts.check("12px Arial");
    } catch { /* */ }
    check(
      "P3 font enumeration (Arial)",
      fontCheck === true,
      `fonts.check = ${fontCheck}`,
      "P3",
    );

    // 23. Error stack — no __playwright or pptr:
    let stackClean = true;
    let stackDetail = "clean";
    try {
      const err = new Error("stealth-audit-probe");
      const stack = err.stack || "";
      if (stack.includes("__playwright") || stack.includes("pptr:")) {
        stackClean = false;
        stackDetail = "contains automation frames";
      }
    } catch { /* */ }
    check("Error stack clean", stackClean, stackDetail);

    // 24. No Selenium markers
    check(
      "Selenium markers absent",
      !(window as any).cdc_adoQpoasnfa76pfcZLmcfl_ &&
        !(document as any).__selenium_unwrapped &&
        !(document as any).__fxdriver_unwrapped &&
        !(window as any).__webdriver_evaluate &&
        !(window as any).__driver_evaluate,
      "no markers found",
    );

    // 25. Notification.permission === 'default'
    let notifPerm = "unknown";
    try {
      notifPerm = Notification.permission;
    } catch { /* */ }
    check(
      "Notification.permission",
      notifPerm === "default",
      notifPerm,
    );

    // 26. chrome.runtime present
    check(
      "chrome.runtime",
      !!(window as any).chrome?.runtime,
      (window as any).chrome?.runtime ? "present" : "missing",
    );

    // 27. chrome.loadTimes present
    check(
      "chrome.loadTimes",
      typeof (window as any).chrome?.loadTimes === "function",
      typeof (window as any).chrome?.loadTimes,
    );

    return results;
  });

  // Also run async permissions check
  let permissionQueryWorks = false;
  let permissionDetail = "query failed";
  try {
    const result = await page.evaluate(async () => {
      const perm = await navigator.permissions.query({ name: "notifications" as PermissionName });
      return perm.state;
    });
    permissionQueryWorks = result === "prompt" || result === "granted" || result === "denied";
    permissionDetail = `state="${result}"`;
  } catch (e: any) {
    permissionDetail = e.message?.substring(0, 60) || "error";
  }

  const results: AuditResult[] = raw.map((r) => ({
    label: r.label,
    status: r.pass ? ("pass" as const) : ("fail" as const),
    detail: r.detail,
    tier: 1 as const,
    priority: r.priority,
  }));

  // Replace the placeholder permissions check with async result
  const permIdx = results.findIndex((r) => r.label === "P2 permissions.query");
  if (permIdx >= 0) {
    results[permIdx] = {
      label: "P2 permissions.query resolves",
      status: permissionQueryWorks ? "pass" : "fail",
      detail: permissionDetail,
      tier: 1,
      priority: "P2",
    };
  }

  return results;
}

// ── Tier 2: External Sites ────────────────────────────────────────────────

async function runSannysoft(page: Page): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  try {
    await page.goto("https://bot.sannysoft.com", { waitUntil: "networkidle", timeout: 20000 });
    // Wait for results table to populate
    await page.waitForSelector("#fp2 td", { timeout: 10000 });

    const rows = await page.evaluate(() => {
      const table = document.getElementById("fp2");
      if (!table) return [];
      const trs = table.querySelectorAll("tr");
      const data: Array<{ label: string; value: string; passed: boolean }> = [];
      trs.forEach((tr) => {
        const tds = tr.querySelectorAll("td");
        if (tds.length >= 2) {
          const label = tds[0]?.textContent?.trim() ?? "";
          const cell = tds[1];
          const value = cell?.textContent?.trim() ?? "";
          // Green = pass, red = fail (sannysoft uses inline styles)
          const style = cell?.getAttribute("style") ?? "";
          const className = cell?.className ?? "";
          const passed =
            style.includes("green") ||
            className.includes("passed") ||
            (!style.includes("red") && !className.includes("failed"));
          if (label) data.push({ label, value, passed });
        }
      });
      return data;
    });

    for (const row of rows) {
      results.push({
        label: row.label,
        status: row.passed ? "pass" : "fail",
        detail: row.value.substring(0, 80),
        tier: 2,
      });
    }

    if (rows.length === 0) {
      results.push({
        label: "bot.sannysoft.com",
        status: "warn",
        detail: "Could not parse results table",
        tier: 2,
      });
    }
  } catch (e: any) {
    results.push({
      label: "bot.sannysoft.com",
      status: "warn",
      detail: `Navigation failed: ${e.message?.substring(0, 60)}`,
      tier: 2,
    });
  }

  return results;
}

async function runRebrowserDetector(page: Page): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  try {
    await page.goto("https://bot-detector.rebrowser.net", { waitUntil: "networkidle", timeout: 25000 });
    // Wait for test results — the page runs JS-heavy tests
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {
      const items: Array<{ label: string; passed: boolean; detail: string }> = [];

      // Look for result containers — rebrowser uses various selectors
      const resultElements = document.querySelectorAll('[class*="result"], [class*="test"], [data-test]');
      resultElements.forEach((el) => {
        const text = el.textContent?.trim() ?? "";
        if (text.length > 2 && text.length < 200) {
          const passed =
            el.className?.includes("pass") ||
            el.className?.includes("success") ||
            el.className?.includes("green") ||
            text.toLowerCase().includes("passed") ||
            text.toLowerCase().includes("not detected");
          items.push({ label: text.substring(0, 60), passed, detail: text.substring(0, 80) });
        }
      });

      // Fallback: try to get overall status text
      if (items.length === 0) {
        const bodyText = document.body?.innerText?.substring(0, 500) ?? "";
        const hasDetection =
          bodyText.toLowerCase().includes("detected") &&
          !bodyText.toLowerCase().includes("not detected");
        items.push({
          label: "CDP leak detection",
          passed: !hasDetection,
          detail: bodyText.substring(0, 80),
        });
      }

      return items;
    });

    for (const item of data) {
      results.push({
        label: item.label,
        status: item.passed ? "pass" : "fail",
        detail: item.detail,
        tier: 2,
      });
    }
  } catch (e: any) {
    results.push({
      label: "bot-detector.rebrowser.net",
      status: "warn",
      detail: `Navigation failed: ${e.message?.substring(0, 60)}`,
      tier: 2,
    });
  }

  return results;
}

// ── Tier 3: Extended Checks ───────────────────────────────────────────────

async function runBrowserLeaksWebRTC(page: Page): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  try {
    await page.goto("https://browserleaks.com/webrtc", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(5000);

    const data = await page.evaluate(() => {
      const bodyText = document.body?.innerText ?? "";

      // Check for local IP leaks (192.168.x, 10.x, 172.16-31.x)
      const localIpRegex = /(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/;
      const leaksLocalIP = localIpRegex.test(bodyText);

      return {
        leaksLocalIP,
        snippet: bodyText.substring(0, 120),
      };
    });

    results.push({
      label: "WebRTC local IP leak",
      status: data.leaksLocalIP ? "fail" : "pass",
      detail: data.leaksLocalIP ? "Local IP visible in WebRTC candidates" : "No local IP leak detected",
      tier: 3,
    });
  } catch (e: any) {
    results.push({
      label: "browserleaks.com/webrtc",
      status: "warn",
      detail: `Navigation failed: ${e.message?.substring(0, 60)}`,
      tier: 3,
    });
  }

  return results;
}

async function runCreepJS(page: Page): Promise<AuditResult[]> {
  const results: AuditResult[] = [];

  try {
    await page.goto("https://abrahamjuliot.github.io/creepjs/", { waitUntil: "networkidle", timeout: 45000 });
    // CreepJS takes a while to run all fingerprint tests
    await page.waitForTimeout(10000);

    const data = await page.evaluate(() => {
      const items: Array<{ label: string; passed: boolean; detail: string }> = [];

      // CreepJS shows a trust score and various detection results
      const bodyText = document.body?.innerText ?? "";

      // Look for the trust score
      const trustMatch = bodyText.match(/trust\s*score[:\s]*([0-9.]+%?)/i);
      if (trustMatch) {
        const score = parseFloat(trustMatch[1]);
        items.push({
          label: "CreepJS trust score",
          passed: score >= 50,
          detail: `${trustMatch[1]}`,
        });
      }

      // Check for lie/bot detection
      const liesDetected = bodyText.toLowerCase().includes("lies detected") ||
        bodyText.toLowerCase().includes("bot detected");
      items.push({
        label: "CreepJS bot detection",
        passed: !liesDetected,
        detail: liesDetected ? "Lies/bot detected" : "No bot signal",
      });

      if (items.length === 0) {
        items.push({
          label: "CreepJS",
          passed: true,
          detail: "Could not parse results",
        });
      }

      return items;
    });

    for (const item of data) {
      results.push({
        label: item.label,
        status: item.passed ? "pass" : item.passed === false ? "fail" : "warn",
        detail: item.detail,
        tier: 3,
      });
    }
  } catch (e: any) {
    results.push({
      label: "CreepJS",
      status: "warn",
      detail: `Navigation failed: ${e.message?.substring(0, 60)}`,
      tier: 3,
    });
  }

  return results;
}

// ── Output Formatting ─────────────────────────────────────────────────────

function printResults(results: AuditResult[], durationMs: number): void {
  console.log(`\nLeapfrog Stealth Audit v${pkg.version}\n`);

  // Group by tier
  const tier1 = results.filter((r) => r.tier === 1);
  const tier2 = results.filter((r) => r.tier === 2);
  const tier3 = results.filter((r) => r.tier === 3);

  if (tier1.length > 0) {
    console.log(`--- Local Checks (${tier1.length} tests) ---`);
    for (const r of tier1) {
      const tag = r.status === "pass" ? "[pass]" : r.status === "fail" ? "[FAIL]" : "[warn]";
      const priority = r.priority ? `${r.priority} ` : "";
      const detail = r.detail ? `  ${r.detail}` : "";
      console.log(`  ${tag}  ${priority}${r.label}${detail}`);
    }
    console.log();
  }

  if (tier2.length > 0) {
    console.log(`--- External Sites (${tier2.length} tests) ---`);
    for (const r of tier2) {
      const tag = r.status === "pass" ? "[pass]" : r.status === "fail" ? "[FAIL]" : "[warn]";
      const detail = r.detail ? `  ${r.detail}` : "";
      console.log(`  ${tag}  ${r.label}${detail}`);
    }
    console.log();
  }

  if (tier3.length > 0) {
    console.log(`--- Extended Checks (${tier3.length} tests) ---`);
    for (const r of tier3) {
      const tag = r.status === "pass" ? "[pass]" : r.status === "fail" ? "[FAIL]" : "[warn]";
      const detail = r.detail ? `  ${r.detail}` : "";
      console.log(`  ${tag}  ${r.label}${detail}`);
    }
    console.log();
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  const warned = results.filter((r) => r.status === "warn").length;
  const duration = (durationMs / 1000).toFixed(1);

  console.log(`Summary: ${passed}/${results.length} passed, ${failed} failed, ${warned} warning${warned !== 1 ? "s" : ""}`);
  console.log(`Duration: ${duration}s\n`);
}

function printJSON(results: AuditResult[], durationMs: number): void {
  const output = {
    version: pkg.version,
    timestamp: new Date().toISOString(),
    durationMs,
    summary: {
      total: results.length,
      passed: results.filter((r) => r.status === "pass").length,
      failed: results.filter((r) => r.status === "fail").length,
      warned: results.filter((r) => r.status === "warn").length,
    },
    results,
  };
  console.log(JSON.stringify(output, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────────────

export async function runStealthAudit(options: AuditOptions = {}): Promise<void> {
  const start = Date.now();
  const allResults: AuditResult[] = [];

  let browser: Browser | null = null;

  try {
    // Launch browser the SAME WAY as session-manager: stealth launch args,
    // stealth context options, stealth applyToPage — the real stack.
    const headless = !options.headed;
    const launchArgs = stealth.isEnabled() ? stealth.getLaunchArgs() : [];

    browser = await chromium.launch({
      headless,
      args: launchArgs.length > 0 ? launchArgs : undefined,
    });

    // Generate fingerprint (same as session-manager does)
    const fp = generateFingerprint();
    const contextOpts = stealth.isEnabled() ? stealth.getContextOptions(undefined, fp) : {};
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ...contextOpts,
    });

    const page = await context.newPage();

    // Apply stealth init scripts (same as session-manager)
    if (stealth.isEnabled()) {
      await stealth.applyToPage(page, undefined, fp);
    }

    // ── Tier 1: Local checks ────────────────────────────────────────
    await page.goto("about:blank");
    const localResults = await runLocalChecks(page);
    allResults.push(...localResults);

    // ── Tier 2: External sites ──────────────────────────────────────
    if (!options.localOnly) {
      const sannysoftResults = await runSannysoft(page);
      allResults.push(...sannysoftResults);

      const rebrowserResults = await runRebrowserDetector(page);
      allResults.push(...rebrowserResults);
    }

    // ── Tier 3: Full mode ───────────────────────────────────────────
    if (options.full) {
      const webrtcResults = await runBrowserLeaksWebRTC(page);
      allResults.push(...webrtcResults);

      const creepResults = await runCreepJS(page);
      allResults.push(...creepResults);
    }

    await context.close();
  } catch (e: any) {
    allResults.push({
      label: "Browser launch",
      status: "fail",
      detail: e.message?.substring(0, 100),
      tier: 1,
    });
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  const durationMs = Date.now() - start;

  // Output
  if (options.json) {
    printJSON(allResults, durationMs);
  } else {
    printResults(allResults, durationMs);
  }

  // Exit code
  const hasFail = allResults.some((r) => r.status === "fail");
  process.exit(hasFail ? 1 : 0);
}
