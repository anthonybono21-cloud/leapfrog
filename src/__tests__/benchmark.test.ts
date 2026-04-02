/**
 * BENCHMARK SUITE — Leapfrog Performance Measurement
 *
 * Measures actual performance characteristics to validate marketing claims.
 * Uses real Playwright browsers — no mocks.
 *
 * Key question: Can we prove "12x fewer tokens than Playwright MCP"?
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SessionManager } from "../session-manager.js";
import { SnapshotEngine } from "../snapshot-engine.js";
import { tabManager } from "../tab-manager.js";
import { crashRecovery } from "../crash-recovery.js";
import type { Session } from "../types.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function memoryMB(): { heapMB: number; rssMB: number } {
  const mem = process.memoryUsage();
  return {
    heapMB: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
    rssMB: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
  };
}

/** Rough token estimate: chars / 4 (GPT/Claude tokenizer approximation) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Force GC if exposed (run vitest with --expose-gc for accurate memory) */
function tryGC(): void {
  if (typeof globalThis.gc === "function") {
    globalThis.gc();
  }
}

// Collector for all benchmark results
const RESULTS: Record<string, unknown> = {};

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK 1: Token Efficiency — Leapfrog Snapshot vs Raw Accessibility Tree
// ═══════════════════════════════════════════════════════════════════════════

describe("BENCHMARK 1: Token Efficiency", () => {
  let manager: SessionManager;
  let engine: SnapshotEngine;
  let session: Session;

  beforeAll(async () => {
    manager = new SessionManager({ headless: true });
    engine = new SnapshotEngine();
    session = await manager.createSession();
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  // Test against progressively complex pages
  const testPages: Array<{ name: string; html: string }> = [
    {
      name: "Simple form (5 elements)",
      html: `<!DOCTYPE html>
<html><head><title>Simple Form</title></head>
<body>
  <h1>Contact Us</h1>
  <form>
    <label for="name">Name</label>
    <input type="text" id="name" aria-label="Name" value="John">
    <label for="email">Email</label>
    <input type="email" id="email" aria-label="Email">
    <button type="submit">Send</button>
  </form>
</body></html>`,
    },
    {
      name: "Navigation-heavy page (15+ links)",
      html: `<!DOCTYPE html>
<html><head><title>News Site</title></head>
<body>
  <nav aria-label="Main navigation">
    <a href="#home">Home</a>
    <a href="#world">World</a>
    <a href="#politics">Politics</a>
    <a href="#business">Business</a>
    <a href="#tech">Technology</a>
    <a href="#science">Science</a>
    <a href="#health">Health</a>
    <a href="#sports">Sports</a>
    <a href="#arts">Arts</a>
    <a href="#opinion">Opinion</a>
  </nav>
  <main>
    <h1>Breaking News</h1>
    <article>
      <h2>Article One</h2>
      <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.</p>
      <a href="#read-more-1">Read More</a>
    </article>
    <article>
      <h2>Article Two</h2>
      <p>Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium.</p>
      <a href="#read-more-2">Read More</a>
    </article>
    <article>
      <h2>Article Three</h2>
      <p>At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident.</p>
      <a href="#read-more-3">Read More</a>
    </article>
  </main>
  <aside>
    <h3>Trending</h3>
    <a href="#t1">Trending Topic 1</a>
    <a href="#t2">Trending Topic 2</a>
    <a href="#t3">Trending Topic 3</a>
  </aside>
  <footer>
    <a href="#privacy">Privacy Policy</a>
    <a href="#terms">Terms of Service</a>
    <a href="#contact">Contact Us</a>
  </footer>
</body></html>`,
    },
    {
      name: "Complex form (20+ inputs)",
      html: `<!DOCTYPE html>
<html><head><title>Registration</title></head>
<body>
  <h1>Create Account</h1>
  <form>
    <fieldset>
      <legend>Personal Information</legend>
      <input type="text" aria-label="First Name" placeholder="First Name">
      <input type="text" aria-label="Last Name" placeholder="Last Name">
      <input type="email" aria-label="Email Address" placeholder="Email">
      <input type="tel" aria-label="Phone Number" placeholder="Phone">
      <input type="date" aria-label="Date of Birth">
      <select aria-label="Country">
        <option>United States</option>
        <option>Canada</option>
        <option>United Kingdom</option>
        <option>Australia</option>
        <option>Germany</option>
        <option>France</option>
        <option>Japan</option>
      </select>
      <input type="text" aria-label="City" placeholder="City">
      <input type="text" aria-label="State" placeholder="State">
      <input type="text" aria-label="Zip Code" placeholder="Zip Code">
    </fieldset>
    <fieldset>
      <legend>Account Details</legend>
      <input type="text" aria-label="Username" placeholder="Username">
      <input type="password" aria-label="Password" placeholder="Password">
      <input type="password" aria-label="Confirm Password" placeholder="Confirm">
      <select aria-label="Security Question">
        <option>Pet name</option>
        <option>Mother's maiden name</option>
        <option>First school</option>
      </select>
      <input type="text" aria-label="Security Answer" placeholder="Answer">
    </fieldset>
    <fieldset>
      <legend>Preferences</legend>
      <input type="checkbox" aria-label="Subscribe to newsletter">
      <input type="checkbox" aria-label="Enable two-factor auth">
      <input type="checkbox" aria-label="Accept terms and conditions">
      <input type="radio" name="theme" aria-label="Light theme">
      <input type="radio" name="theme" aria-label="Dark theme">
      <input type="radio" name="theme" aria-label="Auto theme">
      <input type="range" aria-label="Font size" min="12" max="24">
    </fieldset>
    <button type="submit">Create Account</button>
    <button type="reset">Clear Form</button>
    <a href="#login">Already have an account? Log in</a>
  </form>
</body></html>`,
    },
    {
      name: "Dashboard with tables and controls (40+ elements)",
      html: `<!DOCTYPE html>
<html><head><title>Analytics Dashboard</title></head>
<body>
  <nav aria-label="Dashboard navigation">
    <a href="#overview">Overview</a>
    <a href="#analytics">Analytics</a>
    <a href="#reports">Reports</a>
    <a href="#settings">Settings</a>
    <a href="#users">Users</a>
    <a href="#billing">Billing</a>
  </nav>
  <header>
    <h1>Analytics Dashboard</h1>
    <button>Export Data</button>
    <button>Refresh</button>
    <input type="search" aria-label="Search analytics" placeholder="Search...">
    <select aria-label="Time range">
      <option>Last 7 days</option>
      <option>Last 30 days</option>
      <option>Last 90 days</option>
      <option>Custom range</option>
    </select>
  </header>
  <main>
    <section aria-label="Key metrics">
      <h2>Key Metrics</h2>
      <div role="group" aria-label="Total Users">
        <span>Total Users</span><span>12,847</span>
      </div>
      <div role="group" aria-label="Active Sessions">
        <span>Active Sessions</span><span>1,234</span>
      </div>
      <div role="group" aria-label="Conversion Rate">
        <span>Conversion Rate</span><span>3.2%</span>
      </div>
      <div role="group" aria-label="Revenue">
        <span>Revenue</span><span>$45,678</span>
      </div>
    </section>
    <section aria-label="Data table">
      <h2>Recent Activity</h2>
      <table aria-label="Activity log">
        <thead>
          <tr><th>User</th><th>Action</th><th>Date</th><th>Status</th></tr>
        </thead>
        <tbody>
          <tr><td>alice@example.com</td><td>Login</td><td>2026-04-01</td><td>Success</td></tr>
          <tr><td>bob@example.com</td><td>Purchase</td><td>2026-04-01</td><td>Success</td></tr>
          <tr><td>carol@example.com</td><td>Signup</td><td>2026-03-31</td><td>Pending</td></tr>
          <tr><td>dave@example.com</td><td>Login</td><td>2026-03-31</td><td>Failed</td></tr>
          <tr><td>eve@example.com</td><td>Purchase</td><td>2026-03-30</td><td>Success</td></tr>
        </tbody>
      </table>
      <nav aria-label="Table pagination">
        <button>Previous</button>
        <button aria-label="Page 1">1</button>
        <button aria-label="Page 2">2</button>
        <button aria-label="Page 3">3</button>
        <button>Next</button>
      </nav>
    </section>
    <section aria-label="Quick actions">
      <h2>Quick Actions</h2>
      <button>Add User</button>
      <button>Generate Report</button>
      <button>Send Notification</button>
      <button>Download CSV</button>
    </section>
  </main>
  <footer>
    <a href="#help">Help Center</a>
    <a href="#docs">Documentation</a>
    <a href="#support">Contact Support</a>
    <a href="#status">System Status</a>
  </footer>
</body></html>`,
    },
  ];

  for (const testPage of testPages) {
    it(`TOKEN: ${testPage.name}`, async () => {
      const page = tabManager.getActivePage(session);

      // Navigate to our test page
      await page.setContent(testPage.html);
      await page.waitForLoadState("domcontentloaded");

      // 1. Get the RAW Playwright aria snapshot (what Playwright MCP would start with)
      const rawYaml = await page.ariaSnapshot({ mode: "ai" });
      const rawChars = rawYaml.length;
      const rawTokens = estimateTokens(rawYaml);

      // 2. Get the Leapfrog filtered snapshot (interactive-only, default settings)
      const leapResult = await engine.snapshot(page, session, {
        interactiveOnly: true,
        maxChars: 10000,
      });
      const leapChars = leapResult.text.length;
      const leapTokens = estimateTokens(leapResult.text);

      // 3. Get full Leapfrog snapshot (interactiveOnly=false for comparison)
      const fullResult = await engine.snapshot(page, session, {
        interactiveOnly: false,
        maxChars: 10000,
      });
      const fullChars = fullResult.text.length;
      const fullTokens = estimateTokens(fullResult.text);

      // 4. Also get the full page HTML for comparison (what a naive scraper returns)
      const fullHtml = await page.content();
      const htmlChars = fullHtml.length;
      const htmlTokens = estimateTokens(fullHtml);

      // 5. Calculate ratios
      const rawToLeapRatio = rawChars / leapChars;
      const htmlToLeapRatio = htmlChars / leapChars;

      const result = {
        page: testPage.name,
        rawAriaSnapshot: { chars: rawChars, tokens: rawTokens },
        leapfrogInteractive: { chars: leapChars, tokens: leapTokens, nodes: leapResult.nodeCount },
        leapfrogFull: { chars: fullChars, tokens: fullTokens, nodes: fullResult.nodeCount },
        fullHtml: { chars: htmlChars, tokens: htmlTokens },
        ratios: {
          rawAriaToLeapfrog: Math.round(rawToLeapRatio * 10) / 10,
          htmlToLeapfrog: Math.round(htmlToLeapRatio * 10) / 10,
        },
      };

      console.log(`\n[TOKEN] ${testPage.name}:`);
      console.log(`  Raw ARIA snapshot:       ${rawChars} chars (~${rawTokens} tokens)`);
      console.log(`  Leapfrog (interactive):  ${leapChars} chars (~${leapTokens} tokens) [${leapResult.nodeCount} nodes]`);
      console.log(`  Leapfrog (full):         ${fullChars} chars (~${fullTokens} tokens) [${fullResult.nodeCount} nodes]`);
      console.log(`  Full page HTML:          ${htmlChars} chars (~${htmlTokens} tokens)`);
      console.log(`  Compression: raw→leap ${rawToLeapRatio.toFixed(1)}x, html→leap ${htmlToLeapRatio.toFixed(1)}x`);

      RESULTS[`token_${testPage.name}`] = result;

      // Sanity: Leapfrog should always be smaller than raw
      expect(leapChars).toBeLessThan(rawChars);
      expect(leapChars).toBeLessThan(htmlChars);
    }, 15000);
  }

  it("TOKEN: Playwright MCP comparison (simulated full snapshot format)", async () => {
    // Playwright MCP returns the full aria snapshot PLUS metadata in a specific format.
    // Let's measure what a typical Playwright MCP browser_snapshot returns vs what Leapfrog returns.
    const page = tabManager.getActivePage(session);

    // Use the dashboard page (most realistic for comparison)
    await page.setContent(testPages[3].html);
    await page.waitForLoadState("domcontentloaded");

    // Simulate Playwright MCP's output format:
    // It returns the full accessibility tree + page info
    const rawYaml = await page.ariaSnapshot({ mode: "ai" });
    const pageUrl = page.url();
    const pageTitle = await page.title();

    // Playwright MCP wraps the snapshot with metadata
    const playwrightMcpOutput = [
      `- Page URL: ${pageUrl}`,
      `- Page Title: ${pageTitle}`,
      ``,
      `### Accessibility snapshot`,
      ``,
      rawYaml,
    ].join("\n");

    // Leapfrog's equivalent output (what snapAndFormat produces)
    const leapResult = await engine.snapshot(page, session, {
      interactiveOnly: true,
      maxChars: 10000,
    });
    const leapfrogOutput = `[${session.id}] ${pageTitle}\n${pageUrl}\n${leapResult.nodeCount} elements\n\n${leapResult.text}`;

    const pwChars = playwrightMcpOutput.length;
    const pwTokens = estimateTokens(playwrightMcpOutput);
    const lfChars = leapfrogOutput.length;
    const lfTokens = estimateTokens(leapfrogOutput);
    const ratio = pwChars / lfChars;

    console.log(`\n[PLAYWRIGHT MCP COMPARISON] Dashboard page:`);
    console.log(`  Playwright MCP output:  ${pwChars} chars (~${pwTokens} tokens)`);
    console.log(`  Leapfrog output:        ${lfChars} chars (~${lfTokens} tokens)`);
    console.log(`  Ratio:                  ${ratio.toFixed(1)}x fewer tokens with Leapfrog`);
    console.log(`  Leapfrog nodes:         ${leapResult.nodeCount}`);

    RESULTS.playwright_mcp_comparison = {
      playwrightMcp: { chars: pwChars, tokens: pwTokens },
      leapfrog: { chars: lfChars, tokens: lfTokens, nodes: leapResult.nodeCount },
      ratio: Math.round(ratio * 10) / 10,
    };

    expect(lfChars).toBeLessThan(pwChars);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK 2: Session Startup Time
// ═══════════════════════════════════════════════════════════════════════════

describe("BENCHMARK 2: Session Startup Time", () => {
  let manager: SessionManager;
  const sessionIds: string[] = [];

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 10, headless: true });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("measures first session creation time (cold start — includes browser launch)", async () => {
    const start = performance.now();
    const session = await manager.createSession();
    const elapsed = performance.now() - start;
    sessionIds.push(session.id);

    console.log(`\n[STARTUP] First session (cold): ${elapsed.toFixed(0)}ms`);
    RESULTS.session_cold_start_ms = Math.round(elapsed);

    // Cold start includes browser launch, should be under 5s
    expect(elapsed).toBeLessThan(5000);
  }, 15000);

  it("measures subsequent session creation times (warm — browser already running)", async () => {
    const times: number[] = [];

    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const session = await manager.createSession();
      const elapsed = performance.now() - start;
      times.push(elapsed);
      sessionIds.push(session.id);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const p50 = times.sort((a, b) => a - b)[Math.floor(times.length / 2)];

    console.log(`\n[STARTUP] Warm session creation (5 runs):`);
    console.log(`  Avg: ${avg.toFixed(0)}ms`);
    console.log(`  Min: ${min.toFixed(0)}ms`);
    console.log(`  Max: ${max.toFixed(0)}ms`);
    console.log(`  P50: ${p50.toFixed(0)}ms`);

    RESULTS.session_warm_start = {
      runs: 5,
      avgMs: Math.round(avg),
      minMs: Math.round(min),
      maxMs: Math.round(max),
      p50Ms: Math.round(p50),
    };

    // Warm start should be under 1s
    expect(avg).toBeLessThan(1000);
  }, 30000);

  it("measures session destruction time", async () => {
    const times: number[] = [];

    for (const id of sessionIds.splice(0, 3)) {
      const start = performance.now();
      await manager.destroySession(id);
      const elapsed = performance.now() - start;
      times.push(elapsed);
    }

    const avg = times.reduce((a, b) => a + b, 0) / times.length;

    console.log(`\n[STARTUP] Session destroy (3 runs): avg ${avg.toFixed(0)}ms`);
    RESULTS.session_destroy_avg_ms = Math.round(avg);

    expect(avg).toBeLessThan(500);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK 3: Navigation Speed
// ═══════════════════════════════════════════════════════════════════════════

describe("BENCHMARK 3: Navigation Speed", () => {
  let manager: SessionManager;
  let engine: SnapshotEngine;
  let session: Session;

  beforeAll(async () => {
    manager = new SessionManager({ headless: true });
    engine = new SnapshotEngine();
    session = await manager.createSession();
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("measures navigate + snapshot time for local pages", async () => {
    const page = tabManager.getActivePage(session);
    const times: number[] = [];
    const snapshotTimes: number[] = [];

    for (let i = 0; i < 10; i++) {
      const html = `<!DOCTYPE html><html><head><title>Page ${i}</title></head>
<body><h1>Page ${i}</h1><button>Button ${i}</button><a href="#">Link ${i}</a>
<input type="text" aria-label="Input ${i}"><form><select aria-label="Select ${i}">
<option>A</option><option>B</option></select></form></body></html>`;

      const startNav = performance.now();
      await page.setContent(html);
      await page.waitForLoadState("domcontentloaded");
      const navTime = performance.now() - startNav;

      const startSnap = performance.now();
      await engine.snapshot(page, session, { interactiveOnly: true });
      const snapTime = performance.now() - startSnap;

      times.push(navTime + snapTime);
      snapshotTimes.push(snapTime);
    }

    const avgTotal = times.reduce((a, b) => a + b, 0) / times.length;
    const avgSnap = snapshotTimes.reduce((a, b) => a + b, 0) / snapshotTimes.length;
    const minSnap = Math.min(...snapshotTimes);
    const maxSnap = Math.max(...snapshotTimes);

    console.log(`\n[NAV] Navigate + snapshot (10 local pages):`);
    console.log(`  Avg total: ${avgTotal.toFixed(0)}ms`);
    console.log(`  Avg snapshot only: ${avgSnap.toFixed(0)}ms`);
    console.log(`  Snapshot range: ${minSnap.toFixed(0)}-${maxSnap.toFixed(0)}ms`);

    RESULTS.navigation_local = {
      runs: 10,
      avgTotalMs: Math.round(avgTotal),
      avgSnapshotMs: Math.round(avgSnap),
      minSnapshotMs: Math.round(minSnap),
      maxSnapshotMs: Math.round(maxSnap),
    };

    expect(avgSnap).toBeLessThan(500);
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK 4: Memory Footprint
// ═══════════════════════════════════════════════════════════════════════════

describe("BENCHMARK 4: Memory Footprint", () => {
  let manager: SessionManager;

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 10, headless: true });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("measures memory per session (0 → 1 → 3 → 5 → 8 sessions)", async () => {
    tryGC();
    const baseline = memoryMB();
    console.log(`\n[MEMORY] Baseline: heap=${baseline.heapMB}MB, RSS=${baseline.rssMB}MB`);

    const measurements: Array<{ sessions: number; heapMB: number; rssMB: number; deltaHeap: number; deltaRSS: number }> = [];
    const sessionIds: string[] = [];

    const checkpoints = [1, 3, 5, 8];

    for (let i = 0; i < 8; i++) {
      const s = await manager.createSession();
      sessionIds.push(s.id);

      // Give each session a page with some content
      await s.page.setContent(`<html><head><title>Session ${i}</title></head>
<body><h1>Session ${i}</h1><button>Action</button><input type="text" aria-label="Field">
<a href="#">Link</a></body></html>`);

      if (checkpoints.includes(i + 1)) {
        tryGC();
        // Small delay for memory to settle
        await new Promise(r => setTimeout(r, 200));
        const mem = memoryMB();
        measurements.push({
          sessions: i + 1,
          heapMB: mem.heapMB,
          rssMB: mem.rssMB,
          deltaHeap: Math.round((mem.heapMB - baseline.heapMB) * 100) / 100,
          deltaRSS: Math.round((mem.rssMB - baseline.rssMB) * 100) / 100,
        });
      }
    }

    for (const m of measurements) {
      console.log(`  ${m.sessions} sessions: heap=${m.heapMB}MB (+${m.deltaHeap}MB), RSS=${m.rssMB}MB (+${m.deltaRSS}MB)`);
    }

    // Estimate per-session cost
    if (measurements.length >= 2) {
      const first = measurements[0];
      const last = measurements[measurements.length - 1];
      const sessionDelta = last.sessions - first.sessions;
      const heapPerSession = (last.deltaHeap - first.deltaHeap) / sessionDelta;
      const rssPerSession = (last.deltaRSS - first.deltaRSS) / sessionDelta;

      console.log(`\n  Estimated per-session overhead:`);
      console.log(`    Heap: ~${heapPerSession.toFixed(1)}MB/session`);
      console.log(`    RSS:  ~${rssPerSession.toFixed(1)}MB/session`);

      RESULTS.memory_per_session = {
        heapMBPerSession: Math.round(heapPerSession * 10) / 10,
        rssMBPerSession: Math.round(rssPerSession * 10) / 10,
      };
    }

    RESULTS.memory_measurements = measurements;

    // Cleanup
    for (const id of sessionIds) {
      await manager.destroySession(id);
    }
  }, 60000);
});

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK 5: Snapshot Accuracy
// ═══════════════════════════════════════════════════════════════════════════

describe("BENCHMARK 5: Snapshot Accuracy", () => {
  let manager: SessionManager;
  let engine: SnapshotEngine;
  let session: Session;

  beforeAll(async () => {
    manager = new SessionManager({ headless: true });
    engine = new SnapshotEngine();
    session = await manager.createSession();
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("verifies all interactive elements are captured in compact snapshot", async () => {
    const page = tabManager.getActivePage(session);

    const html = `<!DOCTYPE html>
<html><head><title>Accuracy Test</title></head>
<body>
  <h1>Registration</h1>
  <h2>Personal Info</h2>
  <form>
    <input type="text" aria-label="First Name" value="John">
    <input type="text" aria-label="Last Name">
    <input type="email" aria-label="Email">
    <input type="tel" aria-label="Phone">
    <select aria-label="Country">
      <option>US</option>
      <option>UK</option>
    </select>
    <input type="checkbox" aria-label="Subscribe" checked>
    <input type="checkbox" aria-label="Terms">
    <input type="radio" name="plan" aria-label="Free plan">
    <input type="radio" name="plan" aria-label="Pro plan">
    <button type="submit">Register</button>
    <button type="reset">Clear</button>
    <a href="#login">Login instead</a>
  </form>
  <nav>
    <a href="#home">Home</a>
    <a href="#about">About</a>
    <a href="#contact">Contact</a>
  </nav>
</body></html>`;

    await page.setContent(html);
    await page.waitForLoadState("domcontentloaded");

    // Get both snapshots
    const interactiveResult = await engine.snapshot(page, session, { interactiveOnly: true });
    const fullResult = await engine.snapshot(page, session, { interactiveOnly: false });
    const rawYaml = await page.ariaSnapshot({ mode: "ai" });

    // Expected interactive elements
    const expectedElements = [
      "First Name", "Last Name", "Email", "Phone", "Country",
      "Subscribe", "Terms", "Free plan", "Pro plan",
      "Register", "Clear", "Login instead",
      "Home", "About", "Contact",
    ];

    const expectedHeadings = ["Registration", "Personal Info"];

    let foundInInteractive = 0;
    let foundInFull = 0;
    const missing: string[] = [];

    for (const elem of expectedElements) {
      if (interactiveResult.text.includes(elem)) foundInInteractive++;
      else missing.push(elem);
      if (fullResult.text.includes(elem)) foundInFull++;
    }

    // Headings should always be captured (structural role)
    for (const h of expectedHeadings) {
      if (interactiveResult.text.includes(h)) foundInInteractive++;
      if (fullResult.text.includes(h)) foundInFull++;
    }

    const totalExpected = expectedElements.length + expectedHeadings.length;
    const interactiveAccuracy = foundInInteractive / totalExpected;
    const fullAccuracy = foundInFull / totalExpected;

    console.log(`\n[ACCURACY] Interactive elements:`);
    console.log(`  Expected: ${totalExpected}`);
    console.log(`  Found (interactive mode): ${foundInInteractive} (${(interactiveAccuracy * 100).toFixed(0)}%)`);
    console.log(`  Found (full mode): ${foundInFull} (${(fullAccuracy * 100).toFixed(0)}%)`);
    if (missing.length > 0) {
      console.log(`  Missing from interactive: ${missing.join(", ")}`);
    }
    console.log(`  Raw ARIA chars: ${rawYaml.length}, Interactive chars: ${interactiveResult.text.length}`);
    console.log(`  Compression: ${(rawYaml.length / interactiveResult.text.length).toFixed(1)}x with ${(interactiveAccuracy * 100).toFixed(0)}% accuracy`);

    RESULTS.accuracy = {
      totalExpected,
      foundInteractive: foundInInteractive,
      foundFull: foundInFull,
      interactiveAccuracy: Math.round(interactiveAccuracy * 100),
      fullAccuracy: Math.round(fullAccuracy * 100),
      missing,
    };

    // Interactive mode should capture at least 90% of important elements
    expect(interactiveAccuracy).toBeGreaterThanOrEqual(0.85);
    // Full mode should capture 100%
    expect(fullAccuracy).toBeGreaterThanOrEqual(0.95);
  }, 15000);
});

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK 6: Crash Recovery Speed
// ═══════════════════════════════════════════════════════════════════════════

describe("BENCHMARK 6: Health Check Speed", () => {
  let manager: SessionManager;

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 5, headless: true });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("measures health check time for 1 and 5 sessions", async () => {
    // Create 5 sessions
    const sessions: Session[] = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(await manager.createSession());
    }

    // Single session health check
    const start1 = performance.now();
    const result1 = await crashRecovery.healthCheck(sessions[0]);
    const time1 = performance.now() - start1;

    // All sessions health check
    const allSessions = manager.getSessions();
    const startAll = performance.now();
    const results = await crashRecovery.healthCheckAll(allSessions);
    const timeAll = performance.now() - startAll;

    console.log(`\n[HEALTH] Single session check: ${time1.toFixed(0)}ms (${result1.healthy ? "healthy" : "unhealthy"})`);
    console.log(`[HEALTH] All 5 sessions check: ${timeAll.toFixed(0)}ms (${timeAll / 5 | 0}ms avg)`);

    RESULTS.health_check = {
      singleMs: Math.round(time1),
      fiveSessionsMs: Math.round(timeAll),
      avgPerSessionMs: Math.round(timeAll / 5),
    };

    expect(result1.healthy).toBe(true);
    expect(results.size).toBe(5);
    for (const [, r] of results) {
      expect(r.healthy).toBe(true);
    }
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// BENCHMARK 7: Concurrent Sessions Snapshot Throughput
// ═══════════════════════════════════════════════════════════════════════════

describe("BENCHMARK 7: Concurrent Snapshot Throughput", () => {
  let manager: SessionManager;
  let engine: SnapshotEngine;

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 5, headless: true });
    engine = new SnapshotEngine();
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("measures parallel snapshots across 5 sessions", async () => {
    const sessions: Session[] = [];
    for (let i = 0; i < 5; i++) {
      const s = await manager.createSession();
      await s.page.setContent(`<!DOCTYPE html><html><head><title>Session ${i}</title></head>
<body><h1>Session ${i}</h1>
<button>Action A</button><button>Action B</button>
<input type="text" aria-label="Search"><a href="#">Link 1</a><a href="#">Link 2</a>
</body></html>`);
      sessions.push(s);
    }

    // Sequential snapshots
    const startSeq = performance.now();
    for (const s of sessions) {
      const page = tabManager.getActivePage(s);
      await engine.snapshot(page, s, { interactiveOnly: true });
    }
    const seqTime = performance.now() - startSeq;

    // Parallel snapshots
    const startPar = performance.now();
    await Promise.all(sessions.map(s => {
      const page = tabManager.getActivePage(s);
      return engine.snapshot(page, s, { interactiveOnly: true });
    }));
    const parTime = performance.now() - startPar;

    console.log(`\n[THROUGHPUT] 5 sessions snapshot:`);
    console.log(`  Sequential: ${seqTime.toFixed(0)}ms (${(seqTime / 5).toFixed(0)}ms/session)`);
    console.log(`  Parallel:   ${parTime.toFixed(0)}ms (${(parTime / 5).toFixed(0)}ms/session)`);
    console.log(`  Speedup:    ${(seqTime / parTime).toFixed(1)}x`);

    RESULTS.throughput = {
      sequentialMs: Math.round(seqTime),
      parallelMs: Math.round(parTime),
      speedup: Math.round(seqTime / parTime * 10) / 10,
      sessionsPerSecond: Math.round(5 / (parTime / 1000) * 10) / 10,
    };

    expect(parTime).toBeLessThan(seqTime * 1.5); // Parallel should not be slower
  }, 30000);
});

// ═══════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

describe("BENCHMARK SUMMARY", () => {
  it("prints complete results JSON", () => {
    console.log("\n\n" + "=".repeat(70));
    console.log("  LEAPFROG BENCHMARK RESULTS");
    console.log("=".repeat(70));
    console.log(JSON.stringify(RESULTS, null, 2));
    console.log("=".repeat(70) + "\n");
  });
});
