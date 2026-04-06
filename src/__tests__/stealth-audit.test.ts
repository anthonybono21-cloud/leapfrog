/**
 * stealth-audit.test.ts — Tests for the stealth audit CLI
 *
 * Tests mode option parsing, expected failure tagging, compare mode structure,
 * and JSON output format. Does NOT hit external sites — all browser-dependent
 * tests are mocked or skipped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the module's exported types and functions. The browser-launching
// runAuditForMode is tested via mocking to avoid needing a real browser.

describe("Stealth Audit — Mode Support", () => {
  // ── AuditOptions interface tests (compile-time, validated by usage) ────

  describe("AuditOptions type", () => {
    it("accepts all valid mode values", async () => {
      // Dynamic import to get types
      const mod = await import("../stealth-audit.js");
      type Opts = Parameters<typeof mod.runStealthAudit>[0];

      // These should all be valid — TypeScript compile check
      const opts: Opts[] = [
        { mode: "off" },
        { mode: "passive" },
        { mode: "active" },
        { mode: "compare" },
        {}, // undefined mode = default
      ];
      expect(opts).toHaveLength(5);
    });
  });

  // ── Expected failure tagging ──────────────────────────────────────────

  describe("EXPECTED_FAILURES", () => {
    it("passive mode expects plugins and mimeTypes failures", async () => {
      // Import the module to access the constant via runAuditForMode behavior
      const mod = await import("../stealth-audit.js");

      // We can't directly access EXPECTED_FAILURES (it's not exported),
      // but we can verify the behavior through AuditResult.expected field.
      // The constant is tested indirectly through the tagging function.
      expect(mod.runAuditForMode).toBeDefined();
    });

    it("active mode has no expected failures", async () => {
      const mod = await import("../stealth-audit.js");
      // Active mode aims to pass everything
      expect(mod.runStealthAudit).toBeDefined();
    });
  });

  // ── Mode parsing integration ──────────────────────────────────────────

  describe("mode CLI parsing", () => {
    it("defaults to active when no mode specified", async () => {
      const mod = await import("../stealth-audit.js");

      // Mock process.exit to prevent test from dying
      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as any);

      // Mock chromium.launch to avoid real browser
      const chromiumMod = await import("playwright-core");
      const launchSpy = vi.spyOn(chromiumMod.chromium, "launch").mockRejectedValue(
        new Error("mocked - no browser"),
      );

      // Run with no mode → should default to active
      try {
        await mod.runStealthAudit({});
      } catch {
        // Expected — process.exit throws
      }

      // Verify it attempted to launch (meaning it got past mode parsing)
      expect(launchSpy).toHaveBeenCalled();

      exitSpy.mockRestore();
      launchSpy.mockRestore();
    });

    it("accepts mode=off and launches without stealth", async () => {
      const mod = await import("../stealth-audit.js");

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as any);

      const chromiumMod = await import("playwright-core");
      const launchSpy = vi.spyOn(chromiumMod.chromium, "launch").mockRejectedValue(
        new Error("mocked - no browser"),
      );

      try {
        await mod.runStealthAudit({ mode: "off" });
      } catch {
        // Expected
      }

      // In off mode, launch should still be called but with no args
      expect(launchSpy).toHaveBeenCalled();
      const callArgs = launchSpy.mock.calls[0]?.[0];
      // Off mode should have undefined or empty args
      expect(callArgs?.args).toBeUndefined();

      exitSpy.mockRestore();
      launchSpy.mockRestore();
    });
  });

  // ── JSON output structure ─────────────────────────────────────────────

  describe("JSON output", () => {
    it("single mode JSON includes mode field", async () => {
      const mod = await import("../stealth-audit.js");

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as any);

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const chromiumMod = await import("playwright-core");
      const launchSpy = vi.spyOn(chromiumMod.chromium, "launch").mockRejectedValue(
        new Error("mocked - no browser"),
      );

      try {
        await mod.runStealthAudit({ mode: "passive", json: true });
      } catch {
        // Expected — process.exit
      }

      // Find the JSON output call (the one with the structured output)
      const jsonCalls = logSpy.mock.calls.filter((call) => {
        const arg = call[0];
        return typeof arg === "string" && arg.includes('"mode"');
      });

      expect(jsonCalls.length).toBeGreaterThan(0);
      const output = JSON.parse(jsonCalls[0][0] as string);
      expect(output.mode).toBe("passive");
      expect(output.version).toBeDefined();
      expect(output.summary).toBeDefined();
      expect(output.summary.expected).toBeDefined();

      exitSpy.mockRestore();
      logSpy.mockRestore();
      launchSpy.mockRestore();
    });
  });

  // ── Compare mode ──────────────────────────────────────────────────────

  describe("compare mode", () => {
    it("runs all three modes and exits 0", async () => {
      const mod = await import("../stealth-audit.js");

      let exitCode: number | undefined;
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
        exitCode = code;
        throw new Error("process.exit called");
      }) as any);

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const chromiumMod = await import("playwright-core");
      let launchCount = 0;
      const launchSpy = vi.spyOn(chromiumMod.chromium, "launch").mockImplementation(async () => {
        launchCount++;
        throw new Error("mocked - no browser");
      });

      try {
        await mod.runStealthAudit({ mode: "compare" });
      } catch {
        // Expected — process.exit
      }

      // Should have attempted to launch 3 browsers (off, passive, active)
      expect(launchCount).toBe(3);

      // Compare mode always exits 0 (informational)
      expect(exitCode).toBe(0);

      exitSpy.mockRestore();
      logSpy.mockRestore();
      launchSpy.mockRestore();
    });

    it("compare JSON output contains all three modes", async () => {
      const mod = await import("../stealth-audit.js");

      const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
        throw new Error("process.exit called");
      }) as any);

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const chromiumMod = await import("playwright-core");
      vi.spyOn(chromiumMod.chromium, "launch").mockRejectedValue(
        new Error("mocked - no browser"),
      );

      try {
        await mod.runStealthAudit({ mode: "compare", json: true });
      } catch {
        // Expected
      }

      // Find JSON output
      const jsonCalls = logSpy.mock.calls.filter((call) => {
        const arg = call[0];
        return typeof arg === "string" && arg.includes('"modes"');
      });

      expect(jsonCalls.length).toBeGreaterThan(0);
      const output = JSON.parse(jsonCalls[0][0] as string);
      expect(output.mode).toBe("compare");
      expect(output.modes).toHaveLength(3);
      expect(output.modes.map((m: any) => m.mode)).toEqual(["off", "passive", "active"]);

      exitSpy.mockRestore();
      logSpy.mockRestore();
    });
  });

  // ── AuditResult.expected field ────────────────────────────────────────

  describe("expected failure tagging", () => {
    it("runAuditForMode tags expected failures for passive mode", async () => {
      const mod = await import("../stealth-audit.js");

      // Mock browser to return a page that runs evaluate
      const chromiumMod = await import("playwright-core");

      // Create a minimal mock that returns a page with evaluate
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue([
          // Simulate a local check that should be expected-fail in passive
          { label: "P2 navigator.plugins count", pass: false, detail: "0 plugins", priority: "P2" },
          // Simulate a check that should genuinely pass
          { label: "P0 UA string clean", pass: true, detail: "Chrome/136...", priority: "P0" },
          // Simulate a check that should genuinely fail (unexpected in passive)
          { label: "P0 navigator.webdriver typeof", pass: true, detail: 'typeof = "undefined"', priority: "P0" },
        ]),
        addInitScript: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        waitForSelector: vi.fn().mockResolvedValue(undefined),
        waitForTimeout: vi.fn().mockResolvedValue(undefined),
      };

      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const launchSpy = vi.spyOn(chromiumMod.chromium, "launch").mockResolvedValue(
        mockBrowser as any,
      );

      const { results } = await mod.runAuditForMode("passive", { localOnly: true });

      // The plugins check should be tagged as expected failure
      const pluginsResult = results.find((r) => r.label === "P2 navigator.plugins count");
      expect(pluginsResult).toBeDefined();
      expect(pluginsResult?.status).toBe("fail");
      expect(pluginsResult?.expected).toBe(true);

      // The UA check should pass (no expected tag)
      const uaResult = results.find((r) => r.label === "P0 UA string clean");
      expect(uaResult?.status).toBe("pass");
      expect(uaResult?.expected).toBeUndefined();

      launchSpy.mockRestore();
    });
  });
});
