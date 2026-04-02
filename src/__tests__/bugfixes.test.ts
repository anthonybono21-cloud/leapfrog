/**
 * bugfixes.test.ts — Regression tests for all 9 QA bugs from the master feedback report.
 *
 * References: research/gdrive-qa/MASTER-FEEDBACK-REPORT.md
 *
 * BUG-001: Sessions should survive >5 min idle with increased timeout
 * BUG-002: window.open() should not kill session (zombie page recovery)
 * BUG-003: Client Hints should not contain HeadlessChrome
 * BUG-004: navigator.webdriver should be undefined
 * BUG-005: Custom UA should not disable other stealth options
 * BUG-007: Double-destroy should return error (or at least not succeed silently)
 * BUG-009: Page crash should not leave zombie session
 *
 * BUG-006 (network timing 0ms) and BUG-008 (browser crash wipes all) are tested
 * in their respective module test suites.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { SessionManager } from "../session-manager.js";
import { stealth, StealthMode } from "../stealth.js";
import { crashRecovery } from "../crash-recovery.js";
import { tabManager } from "../tab-manager.js";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

describe("QA Bug Regression Tests", () => {
  let manager: SessionManager;

  beforeAll(() => {
    manager = new SessionManager({
      maxSessions: 5,
      idleTimeoutMs: 60_000, // 60s for tests
      headless: true,
    });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  // ─── BUG-001: Session should survive >5 min idle ──────────────────
  // Root cause: Default idle timeout is 5 minutes, sweep runs every 30s.
  // Only requireSession() calls reset the timer.
  // Fix validation: Configurable idle timeout should be respected.

  describe("BUG-001: Idle timeout configuration", () => {
    it("session survives when idle timeout is set higher than idle duration", async () => {
      // Create a manager with a generous timeout
      const longTimeoutManager = new SessionManager({
        maxSessions: 2,
        idleTimeoutMs: 30 * 60 * 1000, // 30 minutes
        cleanupIntervalMs: 500, // fast sweep for testing
        headless: true,
      });

      const session = await longTimeoutManager.createSession();
      const id = session.id;

      // Wait a bit (simulating idle time, but well under 30 min)
      await new Promise((r) => setTimeout(r, 600));

      // Session should still be alive
      const retrieved = longTimeoutManager.getSession(id);
      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(id);

      await longTimeoutManager.destroyAll();
    });

    it("session is reaped when idle exceeds the configured timeout", async () => {
      // Create a manager with a very short timeout for testing
      const shortManager = new SessionManager({
        maxSessions: 2,
        idleTimeoutMs: 200, // 200ms
        cleanupIntervalMs: 100, // sweep every 100ms
        headless: true,
      });

      const session = await shortManager.createSession();
      const id = session.id;

      // Wait for idle sweep to run and reap the session
      await new Promise((r) => setTimeout(r, 600));

      // Session should have been cleaned up
      const retrieved = shortManager.getSession(id);
      expect(retrieved).toBeUndefined();

      await shortManager.destroyAll();
    });

    it("touchSession resets the idle timer and prevents reaping", async () => {
      const touchManager = new SessionManager({
        maxSessions: 2,
        idleTimeoutMs: 400,
        cleanupIntervalMs: 100,
        headless: true,
      });

      const session = await touchManager.createSession();
      const id = session.id;

      // Keep touching the session to prevent reaping
      const interval = setInterval(() => {
        touchManager.touchSession(id);
      }, 150);

      await new Promise((r) => setTimeout(r, 700));
      clearInterval(interval);

      // Session should still be alive because we kept touching it
      const retrieved = touchManager.getSession(id);
      expect(retrieved).toBeDefined();

      await touchManager.destroyAll();
    });
  });

  // ─── BUG-002: window.open() should not kill session ────────────────
  // Root cause: context.on("page") auto-switches activePageIndex to popup.
  // If popup closes immediately, session has 0 pages and getActivePage() breaks.

  describe("BUG-002: window.open() session survival", () => {
    it("session survives window.open() followed by popup close", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      // Set up a page that uses window.open()
      await page.setContent(`
        <html><body>
          <button id="opener" onclick="window.open('about:blank', '_blank')">Open</button>
          <h1>Main Page</h1>
        </body></html>
      `);

      // Open a popup via window.open
      const [popup] = await Promise.all([
        page.context().waitForEvent("page"),
        page.click("#opener"),
      ]);

      // The popup should be tracked
      expect(session.pages).toBeDefined();
      expect(session.pages!.length).toBeGreaterThanOrEqual(2);

      // Close the popup
      await popup.close();

      // Wait a tick for pruning
      await new Promise((r) => setTimeout(r, 100));

      // The original page should still be accessible
      const activePage = tabManager.getActivePage(session);
      expect(activePage).toBeDefined();
      expect(activePage.isClosed()).toBe(false);

      // Should be able to interact with the original page
      const heading = await activePage.locator("h1").textContent();
      expect(heading).toBe("Main Page");

      await manager.destroySession(session.id);
    });

    it("tab manager recovers active page after popup self-closes", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      await page.setContent(`
        <html><body>
          <button id="self-close" onclick="var w = window.open('about:blank'); setTimeout(function() { w.close(); }, 50);">
            Open & Auto-Close
          </button>
          <p>Still here</p>
        </body></html>
      `);

      await page.click("#self-close");

      // Wait for auto-close
      await new Promise((r) => setTimeout(r, 300));

      // getActivePage should still return a valid page
      const active = tabManager.getActivePage(session);
      expect(active).toBeDefined();
      expect(active.isClosed()).toBe(false);

      await manager.destroySession(session.id);
    });
  });

  // ─── BUG-003: Client Hints should not contain HeadlessChrome ───────
  // navigator.userAgentData.brands should NOT include "HeadlessChrome"

  describe("BUG-003: Client Hints brands", () => {
    it("navigator.userAgentData.brands should not contain HeadlessChrome", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      await page.goto("about:blank");

      const brands = await page.evaluate(() => {
        if (!(navigator as any).userAgentData) return null;
        return (navigator as any).userAgentData.brands.map(
          (b: { brand: string }) => b.brand
        );
      });

      // If userAgentData is available, HeadlessChrome should NOT be in brands
      if (brands !== null) {
        const hasHeadless = brands.some(
          (b: string) =>
            b.toLowerCase().includes("headlesschrome") ||
            b.toLowerCase().includes("headless")
        );
        // This test documents the current state. If stealth is not patching
        // Client Hints brands, this will fail — which is the expected behavior
        // to trigger the fix.
        expect(hasHeadless).toBe(false);
      }

      await manager.destroySession(session.id);
    });
  });

  // ─── BUG-004: navigator.webdriver should be false (not true) ───────
  // Standard bot detection signal. The stealth init script patches this
  // with defineProperty get: () => false after deleting the prototype prop.

  describe("BUG-004: navigator.webdriver", () => {
    it("navigator.webdriver should be false after stealth init script", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      await page.goto("about:blank");

      const webdriverValue = await page.evaluate(() => {
        return navigator.webdriver;
      });

      expect(webdriverValue).toBe(false);

      await manager.destroySession(session.id);
    });

    it("navigator.webdriver should remain false after navigation", async () => {
      const session = await manager.createSession();
      const page = tabManager.getActivePage(session);

      // Use goto (not setContent) so the stealth init script fires on navigation
      await page.goto(
        `data:text/html,${encodeURIComponent("<html><body>Test</body></html>")}`
      );

      const webdriverValue = await page.evaluate(() => {
        return navigator.webdriver;
      });

      expect(webdriverValue).toBe(false);

      await manager.destroySession(session.id);
    });
  });

  // ─── BUG-005: Custom UA should not disable other stealth options ───
  // Fixed: stealth.ts getContextOptions() now returns locale/timezone/headers
  // even when a custom userAgent is provided.

  describe("BUG-005: Custom UA + stealth coexistence", () => {
    it("getContextOptions returns stealth config (minus userAgent) when custom UA is provided", () => {
      const stealthInstance = new StealthMode();
      const opts = stealthInstance.getContextOptions("MyCustomUA/1.0");

      // Fixed behavior: returns locale/timezone/headers, just omits userAgent
      expect(opts).toHaveProperty("locale", "en-US");
      expect(opts).toHaveProperty("timezoneId", "America/New_York");
      expect(opts).toHaveProperty("extraHTTPHeaders");
      expect(opts).not.toHaveProperty("userAgent");
    });

    it("getContextOptions returns full stealth config when no custom UA", () => {
      const stealthInstance = new StealthMode();
      const opts = stealthInstance.getContextOptions();

      expect(opts).toHaveProperty("userAgent");
      expect(opts).toHaveProperty("locale", "en-US");
      expect(opts).toHaveProperty("timezoneId", "America/New_York");
      expect(opts).toHaveProperty("extraHTTPHeaders");
    });

    it("stealth init script should still apply even with custom UA", async () => {
      // The init script (navigator.webdriver override etc.) should work
      // regardless of custom UA
      const session = await manager.createSession({
        userAgent: "CustomBot/1.0",
      });
      const page = tabManager.getActivePage(session);

      await page.goto("about:blank");

      // navigator.webdriver should still be patched (false, not true)
      const webdriver = await page.evaluate(() => navigator.webdriver);
      expect(webdriver).toBe(false);

      // Plugins should still be faked
      const pluginCount = await page.evaluate(() => navigator.plugins.length);
      expect(pluginCount).toBeGreaterThan(0);

      await manager.destroySession(session.id);
    });
  });

  // ─── BUG-007: Double-destroy should return error ───────────────────
  // Current behavior: destroySession returns void/success for nonexistent ID.
  // Expected: Should indicate the session was already gone.

  describe("BUG-007: Double-destroy behavior", () => {
    it("first destroy succeeds and removes the session", async () => {
      const session = await manager.createSession();
      const id = session.id;

      expect(manager.getSession(id)).toBeDefined();
      await manager.destroySession(id);
      expect(manager.getSession(id)).toBeUndefined();
    });

    it("second destroy on same ID throws (session not found)", async () => {
      const session = await manager.createSession();
      const id = session.id;

      await manager.destroySession(id);
      // Second destroy should throw since session no longer exists
      await expect(manager.destroySession(id)).rejects.toThrow(/not found/);
    });

    it("getSession returns undefined after destroy", async () => {
      const session = await manager.createSession();
      const id = session.id;

      await manager.destroySession(id);
      expect(manager.getSession(id)).toBeUndefined();
    });

    it("session is not listed after destroy", async () => {
      const session = await manager.createSession();
      const id = session.id;

      await manager.destroySession(id);
      const list = manager.listSessions();
      const found = list.find((s) => s.id === id);
      expect(found).toBeUndefined();
    });
  });

  // ─── BUG-009: Page crash should not leave zombie session ───────────
  // Root cause: No page.on("crash") handler. Page crash leaves session in Map
  // with an unusable page handle.

  describe("BUG-009: Page crash detection via health check", () => {
    it("health check detects a closed page as unhealthy", async () => {
      const session = await manager.createSession();

      // Simulate page becoming closed (crash-like scenario)
      const page = tabManager.getActivePage(session);
      await page.close();

      const result = await crashRecovery.healthCheck(session);
      expect(result.healthy).toBe(false);
      expect(result.reason).toBeDefined();

      // Cleanup — session is still in the map even though page is closed
      await manager.destroySession(session.id);
    });

    it("health check returns healthy for a working session", async () => {
      const session = await manager.createSession();

      const result = await crashRecovery.healthCheck(session);
      expect(result.healthy).toBe(true);
      expect(result.reason).toBeUndefined();

      await manager.destroySession(session.id);
    });

    it("healthCheckAll identifies mixed healthy/unhealthy sessions", async () => {
      const s1 = await manager.createSession();
      const s2 = await manager.createSession();

      // Close s2's page to simulate crash
      await s2.page.close();

      const allSessions = manager.getSessions();
      const results = await crashRecovery.healthCheckAll(allSessions);

      expect(results.get(s1.id)?.healthy).toBe(true);
      expect(results.get(s2.id)?.healthy).toBe(false);

      await manager.destroySession(s1.id);
      await manager.destroySession(s2.id);
    });
  });
});
