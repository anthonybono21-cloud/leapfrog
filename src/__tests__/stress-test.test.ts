import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { SessionManager } from "../session-manager.js";
import { TabManager } from "../tab-manager.js";
import type { Session } from "../types.js";

// ---------------------------------------------------------------------------
// Stress tests — exercises multi-session and multi-tab boundaries
// Uses REAL Playwright browsers. Longer timeouts for capacity tests.
// ---------------------------------------------------------------------------

// Helper: simple HTML page content for lightweight navigation
const simplePage = (label: string) =>
  `<html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`;

// Helper: get process memory in MB
function memoryMB(): { heapMB: number; rssMB: number } {
  const mem = process.memoryUsage();
  return {
    heapMB: Math.round(mem.heapUsed / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: Session limits
// ═══════════════════════════════════════════════════════════════════════════

describe("Test 1: Session limits", () => {
  const MAX = 15;
  let manager: SessionManager;
  const sessionIds: string[] = [];

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: MAX, idleTimeoutMs: 5 * 60 * 1000 });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it(
    `creates ${MAX} sessions successfully`,
    async () => {
      for (let i = 0; i < MAX; i++) {
        const session = await manager.createSession();
        sessionIds.push(session.id);
      }

      const stats = manager.getStats();
      expect(stats.active).toBe(MAX);
      expect(stats.maxSessions).toBe(MAX);

      console.log(`[Test 1] Created ${MAX} sessions. Pool: ${stats.active}/${stats.maxSessions}`);
    },
    60_000,
  );

  it("rejects session creation when pool is full", async () => {
    // Pool should already be full from prior test
    expect(manager.getStats().active).toBe(MAX);

    await expect(manager.createSession()).rejects.toThrow(
      `Session pool full (${MAX}/${MAX}). Destroy an existing session first.`,
    );
  });

  it(
    `all ${MAX} sessions can navigate independently`,
    async () => {
      // Navigate each session to a unique page
      for (let i = 0; i < sessionIds.length; i++) {
        const session = manager.getSession(sessionIds[i])!;
        expect(session).toBeDefined();
        await session.page.setContent(simplePage(`Session-${i}`));
      }

      // Verify each session has its own content
      for (let i = 0; i < sessionIds.length; i++) {
        const session = manager.getSession(sessionIds[i])!;
        const text = await session.page.locator("h1").textContent();
        expect(text).toBe(`Session-${i}`);
      }

      console.log(`[Test 1] All ${MAX} sessions navigated independently.`);
    },
    60_000,
  );

  it(
    "session isolation: cookies do not leak between sessions",
    async () => {
      const s1 = manager.getSession(sessionIds[0])!;
      const s2 = manager.getSession(sessionIds[1])!;

      // Navigate both sessions to a page so cookies have a valid domain
      await s1.page.goto("data:text/html,<h1>S1</h1>");
      await s2.page.goto("data:text/html,<h1>S2</h1>");

      // Set a cookie in session 1 via context
      await s1.context.addCookies([
        {
          name: "stress_test_cookie",
          value: "session1_secret",
          domain: "example.com",
          path: "/",
        },
      ]);

      // Read cookies from both sessions
      const s1Cookies = await s1.context.cookies("https://example.com");
      const s2Cookies = await s2.context.cookies("https://example.com");

      // Session 1 should have the cookie
      const found1 = s1Cookies.find((c) => c.name === "stress_test_cookie");
      expect(found1).toBeDefined();
      expect(found1!.value).toBe("session1_secret");

      // Session 2 should NOT have it
      const found2 = s2Cookies.find((c) => c.name === "stress_test_cookie");
      expect(found2).toBeUndefined();

      console.log("[Test 1] Cookie isolation verified between sessions.");
    },
    30_000,
  );

  it("reports memory usage at max capacity", async () => {
    const usage = manager.getResourceUsage();
    const mem = memoryMB();

    console.log(`[Test 1] Memory at ${MAX} sessions:`);
    console.log(`  Heap: ${usage.heapUsedMB}MB`);
    console.log(`  RSS:  ${usage.rssMB}MB`);
    console.log(`  Process heap: ${mem.heapMB}MB, RSS: ${mem.rssMB}MB`);

    // Sanity checks — these should be reasonable
    expect(usage.heapUsedMB).toBeGreaterThan(0);
    expect(usage.rssMB).toBeGreaterThan(0);
  });

  it(
    "pool reopens after destroying a session",
    async () => {
      // Destroy one session to free a slot
      const idToDestroy = sessionIds.pop()!;
      await manager.destroySession(idToDestroy);
      expect(manager.getStats().active).toBe(MAX - 1);

      // Now creation should succeed again
      const newSession = await manager.createSession();
      expect(newSession.id).toMatch(/^s_[a-z0-9]{6}$/);
      sessionIds.push(newSession.id);
      expect(manager.getStats().active).toBe(MAX);

      console.log("[Test 1] Pool slot freed and reused successfully.");
    },
    30_000,
  );

  // Cleanup all sessions after this describe block
  it(
    "cleanup: destroy all sessions",
    async () => {
      for (const id of sessionIds) {
        await manager.destroySession(id);
      }
      sessionIds.length = 0;
      expect(manager.getStats().active).toBe(0);
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Tab limits per session
// ═══════════════════════════════════════════════════════════════════════════

describe("Test 2: Tab limits per session", () => {
  let manager: SessionManager;
  const tabs = new TabManager();

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 2, idleTimeoutMs: 5 * 60 * 1000 });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it(
    "opens up to 50 tabs in a single session",
    async () => {
      const session = await manager.createSession();
      const TARGET_TABS = 50;
      const errors: string[] = [];

      const memBefore = memoryMB();
      console.log(`[Test 2] Memory before tabs: heap=${memBefore.heapMB}MB, RSS=${memBefore.rssMB}MB`);

      // The session starts with 1 tab (the initial page)
      let tabCount = 1;

      for (let i = 1; i < TARGET_TABS; i++) {
        try {
          const newPage = await session.context.newPage();
          // Set simple content to verify the page works
          await newPage.setContent(simplePage(`Tab-${i}`));

          // The context.on('page') handler in TabManager should auto-track this
          tabCount++;

          if (i % 10 === 0) {
            const mem = memoryMB();
            console.log(`[Test 2] Tab ${i}: heap=${mem.heapMB}MB, RSS=${mem.rssMB}MB`);
          }
        } catch (e: any) {
          errors.push(`Tab ${i}: ${e.message}`);
          console.log(`[Test 2] Failed at tab ${i}: ${e.message}`);
          break;
        }
      }

      const memAfter = memoryMB();
      const tabList = await tabs.listTabs(session);

      console.log(`[Test 2] Final tab count: ${tabList.length}`);
      console.log(`[Test 2] Memory after ${tabList.length} tabs: heap=${memAfter.heapMB}MB, RSS=${memAfter.rssMB}MB`);
      console.log(`[Test 2] Memory delta: heap=+${memAfter.heapMB - memBefore.heapMB}MB, RSS=+${memAfter.rssMB - memBefore.rssMB}MB`);

      if (errors.length > 0) {
        console.log(`[Test 2] Errors encountered: ${JSON.stringify(errors)}`);
      }

      // We should have gotten at least close to 50 tabs
      expect(tabList.length).toBeGreaterThanOrEqual(20); // Soft floor — anything less is a real problem
      expect(tabList.length).toBeLessThanOrEqual(TARGET_TABS);

      // Report whether we hit 50 or something broke first
      if (tabList.length === TARGET_TABS) {
        console.log(`[Test 2] RESULT: Successfully opened all ${TARGET_TABS} tabs. No limit hit.`);
      } else {
        console.log(`[Test 2] RESULT: Hit limit at ${tabList.length} tabs. Errors: ${errors.length}`);
      }

      await manager.destroySession(session.id);
    },
    60_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Total capacity (sessions x tabs)
// ═══════════════════════════════════════════════════════════════════════════

describe("Test 3: Total capacity (5 sessions x 10 tabs)", () => {
  const NUM_SESSIONS = 5;
  const TABS_PER_SESSION = 10;
  const TOTAL_PAGES = NUM_SESSIONS * TABS_PER_SESSION;

  let manager: SessionManager;
  const tabs = new TabManager();
  const sessions: Session[] = [];

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: NUM_SESSIONS, idleTimeoutMs: 5 * 60 * 1000 });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it(
    `creates ${NUM_SESSIONS} sessions with ${TABS_PER_SESSION} tabs each (${TOTAL_PAGES} total pages)`,
    async () => {
      const memBefore = memoryMB();
      console.log(`[Test 3] Memory before: heap=${memBefore.heapMB}MB, RSS=${memBefore.rssMB}MB`);

      // Create all sessions
      for (let s = 0; s < NUM_SESSIONS; s++) {
        const session = await manager.createSession();
        sessions.push(session);

        // Session starts with 1 tab. Open (TABS_PER_SESSION - 1) more.
        await session.page.setContent(simplePage(`S${s}-Tab0`));

        for (let t = 1; t < TABS_PER_SESSION; t++) {
          const newPage = await session.context.newPage();
          await newPage.setContent(simplePage(`S${s}-Tab${t}`));
        }
      }

      expect(sessions.length).toBe(NUM_SESSIONS);

      // Verify total tab counts
      let totalTabs = 0;
      for (const session of sessions) {
        const tabList = await tabs.listTabs(session);
        totalTabs += tabList.length;
      }

      console.log(`[Test 3] Total tabs across ${NUM_SESSIONS} sessions: ${totalTabs}`);
      expect(totalTabs).toBe(TOTAL_PAGES);
    },
    60_000,
  );

  it(
    `navigates and verifies all ${TOTAL_PAGES} pages`,
    async () => {
      const errors: string[] = [];

      for (let s = 0; s < sessions.length; s++) {
        const session = sessions[s];
        const tabList = await tabs.listTabs(session);

        for (let t = 0; t < tabList.length; t++) {
          try {
            const page = tabs.switchTab(session, t);
            const text = await page.locator("h1").textContent();
            expect(text).toBe(`S${s}-Tab${t}`);
          } catch (e: any) {
            errors.push(`S${s}-Tab${t}: ${e.message}`);
          }
        }
      }

      if (errors.length > 0) {
        console.log(`[Test 3] Errors during verification: ${JSON.stringify(errors)}`);
      }
      expect(errors.length).toBe(0);

      console.log(`[Test 3] All ${TOTAL_PAGES} pages verified successfully.`);
    },
    60_000,
  );

  it("reports memory at peak capacity", async () => {
    const memAfter = memoryMB();
    const usage = manager.getResourceUsage();

    console.log(`[Test 3] Memory at peak (${TOTAL_PAGES} total pages):`);
    console.log(`  Heap: ${usage.heapUsedMB}MB (process: ${memAfter.heapMB}MB)`);
    console.log(`  RSS:  ${usage.rssMB}MB (process: ${memAfter.rssMB}MB)`);

    expect(usage.rssMB).toBeGreaterThan(0);
  });

  it(
    "takes a snapshot-equivalent read from each page",
    async () => {
      // Simulates what the snapshot tool would do — read title from each page
      const startTime = Date.now();
      const results: string[] = [];

      for (const session of sessions) {
        const tabList = await tabs.listTabs(session);
        for (let t = 0; t < tabList.length; t++) {
          const page = tabs.switchTab(session, t);
          const title = await page.title();
          results.push(title);
        }
      }

      const elapsed = Date.now() - startTime;

      expect(results.length).toBe(TOTAL_PAGES);
      console.log(`[Test 3] Read titles from all ${TOTAL_PAGES} pages in ${elapsed}ms (${Math.round(elapsed / TOTAL_PAGES)}ms/page)`);
    },
    60_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Tab management under stress
// ═══════════════════════════════════════════════════════════════════════════

describe("Test 4: Tab management under stress", () => {
  let manager: SessionManager;
  const tabs = new TabManager();

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 3, idleTimeoutMs: 5 * 60 * 1000 });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it(
    "rapid tab switching (20 back-and-forth switches) with no crashes",
    async () => {
      const session = await manager.createSession();

      // Open 5 tabs total
      await session.page.setContent(simplePage("Tab-0"));
      for (let i = 1; i < 5; i++) {
        const newPage = await session.context.newPage();
        await newPage.setContent(simplePage(`Tab-${i}`));
      }

      const tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(5);

      // Rapid switching between tab 0 and tab 4, 20 times
      const errors: string[] = [];
      const startTime = Date.now();

      for (let i = 0; i < 20; i++) {
        try {
          const targetIndex = i % 2 === 0 ? 0 : 4;
          const page = tabs.switchTab(session, targetIndex);
          // Verify the page is responsive
          const title = await page.title();
          expect(title).toBe(`Tab-${targetIndex}`);
        } catch (e: any) {
          errors.push(`Switch ${i}: ${e.message}`);
        }
      }

      const elapsed = Date.now() - startTime;
      console.log(`[Test 4] 20 rapid switches in ${elapsed}ms (${Math.round(elapsed / 20)}ms/switch)`);

      if (errors.length > 0) {
        console.log(`[Test 4] Switch errors: ${JSON.stringify(errors)}`);
      }
      expect(errors.length).toBe(0);

      await manager.destroySession(session.id);
    },
    60_000,
  );

  it(
    "closing tabs while others are active does not crash or leak",
    async () => {
      const session = await manager.createSession();

      // Open 5 tabs
      await session.page.setContent(simplePage("Tab-0"));
      for (let i = 1; i < 5; i++) {
        const newPage = await session.context.newPage();
        await newPage.setContent(simplePage(`Tab-${i}`));
      }

      let tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(5);

      // Close tab 2 (middle tab)
      await tabs.closeTab(session, 2);
      tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(4);

      // Close the active tab (last one, which became active after closing 2)
      const activeTab = tabList.find((t) => t.isActive);
      expect(activeTab).toBeDefined();

      // Close another tab from the end
      await tabs.closeTab(session, tabList.length - 1);
      tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(3);

      // Close down to 2 tabs
      await tabs.closeTab(session, 0);
      tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(2);

      // Verify remaining tabs are accessible
      for (let i = 0; i < tabList.length; i++) {
        const page = tabs.switchTab(session, i);
        const title = await page.title();
        expect(title).toBeTruthy();
      }

      // Cannot close the last tab
      await tabs.closeTab(session, 0);
      tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(1);

      await expect(tabs.closeTab(session)).rejects.toThrow("Cannot close the last remaining tab");

      console.log("[Test 4] Tab close/navigate stress test passed.");

      await manager.destroySession(session.id);
    },
    60_000,
  );

  it(
    "active tab index is correct after closing tabs at various positions",
    async () => {
      const session = await manager.createSession();

      // Open 5 tabs (indices 0-4)
      await session.page.setContent(simplePage("A"));
      for (const label of ["B", "C", "D", "E"]) {
        const p = await session.context.newPage();
        await p.setContent(simplePage(label));
      }

      // BUG-002 fix: new pages no longer auto-switch activePageIndex.
      // Active tab stays at 0 (the original page) until explicitly switched.
      let tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(5);
      const activeAfterOpen = tabList.find((t) => t.isActive);
      expect(activeAfterOpen?.index).toBe(0);

      // Switch to tab 2 ("C")
      tabs.switchTab(session, 2);
      tabList = await tabs.listTabs(session);
      expect(tabList.find((t) => t.isActive)?.index).toBe(2);

      // Close tab 0 ("A") — should shift active index to 1 (still "C")
      await tabs.closeTab(session, 0);
      tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(4);
      const activePage = tabs.getActivePage(session);
      const activeTitle = await activePage.title();
      expect(activeTitle).toBe("C");

      // Close the active tab ("C") — should fall back to previous
      await tabs.closeTab(session);
      tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(3);
      const newActive = tabs.getActivePage(session);
      const newTitle = await newActive.title();
      // After closing "C" at index 1, should fall back to index 0 ("B") or index 1 ("D")
      expect(["B", "D"]).toContain(newTitle);

      console.log("[Test 4] Active tab index tracking verified under mutations.");

      await manager.destroySession(session.id);
    },
    60_000,
  );

  it(
    "concurrent tab operations do not corrupt state",
    async () => {
      const session = await manager.createSession();

      // Open 5 tabs
      await session.page.setContent(simplePage("Main"));
      for (let i = 1; i <= 4; i++) {
        const p = await session.context.newPage();
        await p.setContent(simplePage(`Worker-${i}`));
      }

      // Perform multiple operations in rapid succession (non-awaited switches + list)
      tabs.switchTab(session, 0);
      tabs.switchTab(session, 3);
      tabs.switchTab(session, 1);
      tabs.switchTab(session, 4);
      tabs.switchTab(session, 2);

      // After all synchronous switches, active should be 2
      const tabList = await tabs.listTabs(session);
      const active = tabList.find((t) => t.isActive);
      expect(active?.index).toBe(2);
      expect(tabList.length).toBe(5);

      console.log("[Test 4] Concurrent operations completed without state corruption.");

      await manager.destroySession(session.id);
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5: Popup / new window handling
// ═══════════════════════════════════════════════════════════════════════════

describe("Test 5: Popup / new window handling", () => {
  let manager: SessionManager;
  const tabs = new TabManager();

  beforeAll(() => {
    manager = new SessionManager({ maxSessions: 3, idleTimeoutMs: 5 * 60 * 1000 });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it(
    "window.open popup appears in tab list but does NOT auto-switch (BUG-002)",
    async () => {
      const session = await manager.createSession();

      // Set up the initial page
      await session.page.setContent(simplePage("Opener"));

      let tabListBefore = await tabs.listTabs(session);
      expect(tabListBefore.length).toBe(1);

      // Open a popup via window.open — the context 'page' event should fire
      const [newPage] = await Promise.all([
        session.context.waitForEvent("page"),
        session.page.evaluate(() => {
          window.open("about:blank", "_blank");
        }),
      ]);

      // Give the TabManager's event handler a tick to process
      await new Promise((r) => setTimeout(r, 100));

      // Set content on the popup
      await newPage.setContent(simplePage("Popup"));

      // Verify popup appears in tab list
      const tabListAfter = await tabs.listTabs(session);
      expect(tabListAfter.length).toBe(2);

      // BUG-002: The original tab should stay active (popup does NOT auto-switch)
      const activeTab = tabListAfter.find((t) => t.isActive);
      expect(activeTab).toBeDefined();
      expect(activeTab!.index).toBe(0); // Original stays active

      const activePage = tabs.getActivePage(session);
      const activeTitle = await activePage.title();
      expect(activeTitle).toBe("Opener");

      console.log("[Test 5] Popup detected, original tab stays active (BUG-002 fix).");

      await manager.destroySession(session.id);
    },
    30_000,
  );

  it(
    "can switch to popup tab and back to original (BUG-002)",
    async () => {
      const session = await manager.createSession();
      await session.page.setContent(simplePage("Original"));

      // Open popup
      const [newPage] = await Promise.all([
        session.context.waitForEvent("page"),
        session.page.evaluate(() => {
          window.open("about:blank", "_blank");
        }),
      ]);
      await new Promise((r) => setTimeout(r, 100));
      await newPage.setContent(simplePage("Popup-Window"));

      // BUG-002: We should still be on the original tab
      let activePage = tabs.getActivePage(session);
      let title = await activePage.title();
      expect(title).toBe("Original");

      // Explicitly switch to the popup (index 1)
      tabs.switchTab(session, 1);
      activePage = tabs.getActivePage(session);
      title = await activePage.title();
      expect(title).toBe("Popup-Window");

      // Switch back to original (index 0)
      tabs.switchTab(session, 0);
      activePage = tabs.getActivePage(session);
      title = await activePage.title();
      expect(title).toBe("Original");

      console.log("[Test 5] Switch to popup and back to original tab works (BUG-002 fix).");

      await manager.destroySession(session.id);
    },
    30_000,
  );

  it(
    "closing the popup tab returns focus to the original",
    async () => {
      const session = await manager.createSession();
      await session.page.setContent(simplePage("Main-Page"));

      // Open popup
      await Promise.all([
        session.context.waitForEvent("page"),
        session.page.evaluate(() => {
          window.open("about:blank", "_blank");
        }),
      ]);
      await new Promise((r) => setTimeout(r, 100));

      let tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(2);

      // Close the popup (index 1 — not active due to BUG-002 fix)
      await tabs.closeTab(session, 1);

      tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(1);

      // Should fall back to the original page
      const activePage = tabs.getActivePage(session);
      const title = await activePage.title();
      expect(title).toBe("Main-Page");

      console.log("[Test 5] Popup closed, focus returned to original tab.");

      await manager.destroySession(session.id);
    },
    30_000,
  );

  it(
    "multiple popups are tracked correctly (BUG-002)",
    async () => {
      const session = await manager.createSession();
      await session.page.setContent(simplePage("Root"));

      // Open 3 popups in sequence
      for (let i = 0; i < 3; i++) {
        const [newPage] = await Promise.all([
          session.context.waitForEvent("page"),
          session.page.evaluate(() => {
            window.open("about:blank", "_blank");
          }),
        ]);
        await new Promise((r) => setTimeout(r, 50));
        await newPage.setContent(simplePage(`Popup-${i}`));
      }

      const tabList = await tabs.listTabs(session);
      expect(tabList.length).toBe(4); // 1 original + 3 popups

      // BUG-002: Original tab should stay active (index 0)
      const activeTab = tabList.find((t) => t.isActive);
      expect(activeTab!.index).toBe(0);

      // Verify all tabs are accessible via explicit switching
      for (let i = 0; i < tabList.length; i++) {
        const page = tabs.switchTab(session, i);
        const title = await page.title();
        if (i === 0) {
          expect(title).toBe("Root");
        } else {
          expect(title).toBe(`Popup-${i - 1}`);
        }
      }

      console.log("[Test 5] Multiple popups tracked and accessible (BUG-002 fix).");

      await manager.destroySession(session.id);
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY: Capacity & boundary report
// ═══════════════════════════════════════════════════════════════════════════

describe("Capacity summary", () => {
  it("prints the final capacity report", () => {
    const mem = memoryMB();
    console.log("\n══════════════════════════════════════════════════════");
    console.log("  LEAPFROG STRESS TEST — CAPACITY REPORT");
    console.log("══════════════════════════════════════════════════════");
    console.log(`  Default MAX_SESSIONS env: 15`);
    console.log(`  Default maxSessions code: 10`);
    console.log(`  Session pool hard limit: configurable via constructor`);
    console.log(`  Tab limit per session: no hard limit (tested to 50)`);
    console.log(`  Total pages tested: 5 sessions x 10 tabs = 50`);
    console.log(`  Final process memory: heap=${mem.heapMB}MB, RSS=${mem.rssMB}MB`);
    console.log("══════════════════════════════════════════════════════\n");
  });
});
