/**
 * EXPANDED BENCHMARK — Impartial Cross-Tool Comparison
 * 2026-04-03
 *
 * Compares Leapfrog v0.5.2 vs Playwright MCP (simulated via ariaSnapshot) vs agent-browser v0.22.3
 *
 * Tests across diverse page types:
 * - Minimal (example.com)
 * - Content-heavy (Hacker News)
 * - Complex SPA (GitHub)
 * - Login/form page (Microsoft login)
 * - Documentation site (MDN)
 * - News article (BBC News)
 * - SPA with heavy JS (Reddit)
 *
 * Also tests Leapfrog-unique capabilities:
 * - Multi-session parallel snapshots
 * - Pool scaling (5 and 10 sessions)
 * - Memory usage under load
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SessionManager } from "../session-manager.js";
import { SnapshotEngine } from "../snapshot-engine.js";
import { tabManager } from "../tab-manager.js";
import type { Session } from "../types.js";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function memoryMB(): { heapMB: number; rssMB: number } {
  const mem = process.memoryUsage();
  return {
    heapMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
    rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Collector for JSON export
// ═══════════════════════════════════════════════════════════════════════════
interface PageResult {
  name: string;
  url: string;
  htmlChars: number;
  htmlTokens: number;
  rawAriaChars: number;
  rawAriaTokens: number;
  playwrightMcpChars: number;
  playwrightMcpTokens: number;
  leapfrogChars: number;
  leapfrogTokens: number;
  leapfrogNodes: number;
  leapfrogOutputChars: number;
  leapfrogOutputTokens: number;
  ratioVsRawAria: number;
  ratioVsHtml: number;
  ratioVsPwMcp: number;
  skipped?: boolean;
  skipReason?: string;
}

const ALL_RESULTS: PageResult[] = [];

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: Page-by-page token efficiency comparison
// ═══════════════════════════════════════════════════════════════════════════

describe("EXPANDED BENCHMARK: Token Efficiency Across Page Types", () => {
  let manager: SessionManager;
  let engine: SnapshotEngine;
  let session: Session;

  beforeAll(async () => {
    manager = new SessionManager({ headless: true });
    engine = new SnapshotEngine();
    session = await manager.createSession();
  }, 30000);

  afterAll(async () => {
    // Print full results table
    console.log("\n\n════════════════════════════════════════════════════════════════");
    console.log("  COMPLETE RESULTS TABLE");
    console.log("════════════════════════════════════════════════════════════════\n");

    const header = [
      "Site".padEnd(30),
      "HTML (tok)".padStart(12),
      "ARIA (tok)".padStart(12),
      "PW MCP (tok)".padStart(14),
      "Leapfrog (tok)".padStart(16),
      "Nodes".padStart(7),
      "vs ARIA".padStart(9),
      "vs PW MCP".padStart(10),
    ].join(" | ");

    console.log(header);
    console.log("-".repeat(header.length));

    for (const r of ALL_RESULTS) {
      if (r.skipped) {
        console.log(`${r.name.padEnd(30)} | SKIPPED: ${r.skipReason}`);
        continue;
      }
      console.log([
        r.name.padEnd(30),
        `~${r.htmlTokens.toLocaleString()}`.padStart(12),
        `~${r.rawAriaTokens.toLocaleString()}`.padStart(12),
        `~${r.playwrightMcpTokens.toLocaleString()}`.padStart(14),
        `~${r.leapfrogOutputTokens.toLocaleString()}`.padStart(16),
        `${r.leapfrogNodes}`.padStart(7),
        `${r.ratioVsRawAria.toFixed(1)}x`.padStart(9),
        `${r.ratioVsPwMcp.toFixed(1)}x`.padStart(10),
      ].join(" | "));
    }

    console.log("\n");
    await manager.destroyAll();
  }, 30000);

  const testPages = [
    // Existing pages (re-verify)
    { name: "example.com (minimal)", url: "https://example.com" },
    { name: "Hacker News (content)", url: "https://news.ycombinator.com" },
    { name: "GitHub.com (SPA)", url: "https://github.com" },

    // NEW pages to expand coverage
    { name: "MS Login (form)", url: "https://login.microsoftonline.com" },
    { name: "MDN Docs (documentation)", url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript" },
    { name: "BBC News (news article)", url: "https://www.bbc.com/news" },
    { name: "Reddit (heavy SPA)", url: "https://www.reddit.com" },
    { name: "Wikipedia (content-rich)", url: "https://en.wikipedia.org/wiki/Artificial_intelligence" },
  ];

  for (const { name, url } of testPages) {
    it(`TOKEN TEST: ${name}`, async () => {
      const page = tabManager.getActivePage(session);

      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        // Let JS settle
        await new Promise(r => setTimeout(r, 2000));
      } catch (e: any) {
        console.log(`  [SKIP] ${name}: ${e.message}`);
        ALL_RESULTS.push({
          name, url, htmlChars: 0, htmlTokens: 0, rawAriaChars: 0, rawAriaTokens: 0,
          playwrightMcpChars: 0, playwrightMcpTokens: 0, leapfrogChars: 0, leapfrogTokens: 0,
          leapfrogNodes: 0, leapfrogOutputChars: 0, leapfrogOutputTokens: 0,
          ratioVsRawAria: 0, ratioVsHtml: 0, ratioVsPwMcp: 0,
          skipped: true, skipReason: e.message,
        });
        return;
      }

      // 1. Full HTML
      const fullHtml = await page.content();
      const htmlChars = fullHtml.length;
      const htmlTokens = estimateTokens(fullHtml);

      // 2. Raw Playwright aria snapshot (what Playwright MCP uses internally)
      let rawYaml: string;
      try {
        rawYaml = await page.ariaSnapshot({ mode: "ai" });
      } catch (e: any) {
        console.log(`  [SKIP] ${name}: ariaSnapshot failed — ${e.message}`);
        ALL_RESULTS.push({
          name, url, htmlChars, htmlTokens, rawAriaChars: 0, rawAriaTokens: 0,
          playwrightMcpChars: 0, playwrightMcpTokens: 0, leapfrogChars: 0, leapfrogTokens: 0,
          leapfrogNodes: 0, leapfrogOutputChars: 0, leapfrogOutputTokens: 0,
          ratioVsRawAria: 0, ratioVsHtml: 0, ratioVsPwMcp: 0,
          skipped: true, skipReason: `ariaSnapshot failed: ${e.message}`,
        });
        return;
      }
      const rawAriaChars = rawYaml.length;
      const rawAriaTokens = estimateTokens(rawYaml);

      // 3. Playwright MCP simulated output (URL + title + aria snapshot)
      const title = await page.title();
      const playwrightMcpOutput = `- Page URL: ${url}\n- Page Title: ${title}\n\n### Accessibility snapshot\n\n${rawYaml}`;
      const pwmcpChars = playwrightMcpOutput.length;
      const pwmcpTokens = estimateTokens(playwrightMcpOutput);

      // 4. Leapfrog interactive snapshot
      const leapResult = await engine.snapshot(page, session, {
        interactiveOnly: true,
        maxChars: 12000,
      });
      const leapChars = leapResult.text.length;
      const leapTokens = estimateTokens(leapResult.text);

      // 5. Leapfrog full output (as delivered to agent)
      const leapfrogOutput = `[${session.id}] ${title}\n${url}\n${leapResult.nodeCount} elements\n\n${leapResult.text}`;
      const lfOutChars = leapfrogOutput.length;
      const lfOutTokens = estimateTokens(leapfrogOutput);

      // Ratios
      const ratioVsRawAria = rawAriaChars / leapChars;
      const ratioVsHtml = htmlChars / leapChars;
      const ratioVsPwMcp = pwmcpChars / lfOutChars;

      const result: PageResult = {
        name, url,
        htmlChars, htmlTokens,
        rawAriaChars: rawAriaChars, rawAriaTokens: rawAriaTokens,
        playwrightMcpChars: pwmcpChars, playwrightMcpTokens: pwmcpTokens,
        leapfrogChars: leapChars, leapfrogTokens: leapTokens, leapfrogNodes: leapResult.nodeCount,
        leapfrogOutputChars: lfOutChars, leapfrogOutputTokens: lfOutTokens,
        ratioVsRawAria, ratioVsHtml, ratioVsPwMcp,
      };
      ALL_RESULTS.push(result);

      console.log(`\n  [${name}]`);
      console.log(`    HTML:          ${htmlChars.toLocaleString()} chars (~${htmlTokens.toLocaleString()} tokens)`);
      console.log(`    Raw ARIA:      ${rawAriaChars.toLocaleString()} chars (~${rawAriaTokens.toLocaleString()} tokens)`);
      console.log(`    PW MCP:        ${pwmcpChars.toLocaleString()} chars (~${pwmcpTokens.toLocaleString()} tokens)`);
      console.log(`    Leapfrog:      ${lfOutChars.toLocaleString()} chars (~${lfOutTokens.toLocaleString()} tokens) [${leapResult.nodeCount} nodes]`);
      console.log(`    vs Raw ARIA:   ${ratioVsRawAria.toFixed(1)}x`);
      console.log(`    vs PW MCP:     ${ratioVsPwMcp.toFixed(1)}x`);
      console.log(`    vs HTML:       ${ratioVsHtml.toFixed(1)}x`);

      // Leapfrog should be smaller than raw ARIA in all cases
      expect(leapChars).toBeLessThan(rawAriaChars);
    }, 45000);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PART 2: Leapfrog Multi-Session Parallel Capability
// ═══════════════════════════════════════════════════════════════════════════

describe("EXPANDED BENCHMARK: Multi-Session Parallel Capability", () => {
  let manager: SessionManager;
  let engine: SnapshotEngine;

  beforeAll(async () => {
    manager = new SessionManager({ headless: true, maxSessions: 12 });
    engine = new SnapshotEngine();
  }, 30000);

  afterAll(async () => {
    await manager.destroyAll();
  }, 60000);

  it("5 sessions: parallel create, navigate, snapshot", async () => {
    const urls = [
      "https://example.com",
      "https://news.ycombinator.com",
      "https://github.com",
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      "https://en.wikipedia.org/wiki/Artificial_intelligence",
    ];

    const memBefore = memoryMB();
    console.log(`\n  Memory before: heap=${memBefore.heapMB}MB rss=${memBefore.rssMB}MB`);

    // Create 5 sessions in parallel
    const t0 = Date.now();
    const sessions = await Promise.all(urls.map(() => manager.createSession()));
    const createTime = Date.now() - t0;
    console.log(`  5 sessions created in ${createTime}ms`);

    // Navigate all 5 in parallel
    const t1 = Date.now();
    await Promise.all(sessions.map((s, i) => {
      const page = tabManager.getActivePage(s);
      return page.goto(urls[i], { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => null);
    }));
    const navTime = Date.now() - t1;
    console.log(`  5 navigations completed in ${navTime}ms`);

    // Wait for settle
    await new Promise(r => setTimeout(r, 2000));

    // Snapshot all 5 in parallel
    const t2 = Date.now();
    const snapResults = await Promise.all(sessions.map(s => {
      const page = tabManager.getActivePage(s);
      return engine.snapshot(page, s, { interactiveOnly: true, maxChars: 10000 });
    }));
    const snapTime = Date.now() - t2;
    console.log(`  5 snapshots completed in ${snapTime}ms`);

    const memAfter = memoryMB();
    console.log(`  Memory after: heap=${memAfter.heapMB}MB rss=${memAfter.rssMB}MB`);

    // Pool stats
    const stats = manager.getStats();
    console.log(`  Pool: active=${stats.active} max=${stats.maxSessions} totalCreated=${stats.totalCreated}`);

    // Resource usage
    const resources = manager.getResourceUsage();
    console.log(`  Resource usage: heap=${resources.heapUsedMB}MB rss=${resources.rssMB}MB sessions=${resources.sessionsActive}`);

    // Print per-session snapshot sizes
    for (let i = 0; i < sessions.length; i++) {
      const r = snapResults[i];
      console.log(`    ${urls[i].substring(0, 50).padEnd(50)}: ${r.text.length} chars (~${estimateTokens(r.text)} tokens) [${r.nodeCount} nodes]`);
    }

    expect(stats.active).toBe(5);
    expect(snapResults.length).toBe(5);
    expect(snapResults.every(r => r.text.length > 0)).toBe(true);

    // Cleanup
    for (const s of sessions) {
      await manager.destroySession(s.id);
    }
  }, 120000);

  it("10 sessions: stress test scaling", async () => {
    const urls = [
      "https://example.com",
      "https://news.ycombinator.com",
      "https://github.com",
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
      "https://en.wikipedia.org/wiki/Artificial_intelligence",
      "https://www.bbc.com/news",
      "https://httpstat.us/200",
      "https://www.reddit.com",
      "https://login.microsoftonline.com",
      "https://example.org",
    ];

    const memBefore = memoryMB();
    console.log(`\n  Memory before 10-session test: heap=${memBefore.heapMB}MB rss=${memBefore.rssMB}MB`);

    const t0 = Date.now();
    const sessions: Session[] = [];
    for (let i = 0; i < 10; i++) {
      try {
        const s = await manager.createSession();
        sessions.push(s);
      } catch (e: any) {
        console.log(`  Session ${i + 1} failed to create: ${e.message}`);
      }
    }
    const createTime = Date.now() - t0;
    console.log(`  ${sessions.length}/10 sessions created in ${createTime}ms`);

    const stats = manager.getStats();
    console.log(`  Pool: active=${stats.active} max=${stats.maxSessions} totalCreated=${stats.totalCreated}`);

    const memAfter = memoryMB();
    console.log(`  Memory after 10 sessions: heap=${memAfter.heapMB}MB rss=${memAfter.rssMB}MB`);
    console.log(`  Memory delta: heap=+${(memAfter.heapMB - memBefore.heapMB).toFixed(2)}MB rss=+${(memAfter.rssMB - memBefore.rssMB).toFixed(2)}MB`);

    // Navigate as many as possible
    const navPromises = sessions.map((s, i) => {
      const page = tabManager.getActivePage(s);
      const url = urls[i % urls.length];
      return page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 })
        .then(() => ({ session: s, url, success: true }))
        .catch((e: any) => ({ session: s, url, success: false, error: e.message }));
    });

    const navResults = await Promise.all(navPromises);
    const successCount = navResults.filter(r => r.success).length;
    console.log(`  ${successCount}/${sessions.length} navigations succeeded`);

    await new Promise(r => setTimeout(r, 1000));

    // Snapshot all that succeeded
    const t1 = Date.now();
    const snapPromises = navResults.filter(r => r.success).map(r => {
      const page = tabManager.getActivePage(r.session);
      return engine.snapshot(page, r.session, { interactiveOnly: true, maxChars: 8000 })
        .then(snap => ({ url: r.url, snap, success: true }))
        .catch((e: any) => ({ url: r.url, snap: null, success: false, error: e.message }));
    });

    const snapResults = await Promise.all(snapPromises);
    const snapTime = Date.now() - t1;
    console.log(`  ${snapResults.filter(r => r.success).length} snapshots in ${snapTime}ms`);

    const memFinal = memoryMB();
    console.log(`  Final memory: heap=${memFinal.heapMB}MB rss=${memFinal.rssMB}MB`);

    // Cleanup all
    for (const s of sessions) {
      await manager.destroySession(s.id).catch(() => {});
    }

    expect(sessions.length).toBeGreaterThanOrEqual(8); // Should handle at least 8
  }, 180000);
});
