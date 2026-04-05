import { describe, it, expect } from "vitest";
import {
  getHUDInitScript,
  getHUDUpdateScript,
  getClickRippleScript,
  getMoveCursorScript,
  getToggleCursorScript,
} from "../session-hud.js";
import type { HUDStatus } from "../session-hud.js";

// ---------------------------------------------------------------------------
// Unit tests — pure string-returning functions, no browser needed.
// ---------------------------------------------------------------------------

describe("session-hud", () => {
  // ── getHUDInitScript ───────────────────────────────────────────────

  describe("getHUDInitScript", () => {
    it("returns a non-empty string containing the session name", () => {
      const script = getHUDInitScript("my-session");
      expect(script).toBeTruthy();
      expect(script).toContain("my-session");
    });

    it("output contains key CSS (border, z-index, leapfrog-hud)", () => {
      const script = getHUDInitScript("test");
      expect(script).toContain("border");
      expect(script).toContain("z-index");
      expect(script).toContain("leapfrog-hud");
    });

    it("output references window.__leapfrog (valid JS control surface)", () => {
      const script = getHUDInitScript("test");
      expect(script).toContain("window.__leapfrog");
    });
  });

  // ── getHUDUpdateScript ─────────────────────────────────────────────

  describe("getHUDUpdateScript", () => {
    it("returns string containing the green color for 'active'", () => {
      const script = getHUDUpdateScript("active");
      expect(script).toContain("active");
      expect(script).toBeTruthy();
    });

    it("returns string containing 'loading' for 'loading' status", () => {
      const script = getHUDUpdateScript("loading");
      expect(script).toContain("loading");
    });

    it("returns string containing 'error' for 'error' status", () => {
      const script = getHUDUpdateScript("error");
      expect(script).toContain("error");
    });

    it("includes the label when provided", () => {
      const script = getHUDUpdateScript("active", "Navigating...");
      expect(script).toContain("Navigating...");
    });
  });

  // ── getClickRippleScript ───────────────────────────────────────────

  describe("getClickRippleScript", () => {
    it("returns string containing the coordinates", () => {
      const script = getClickRippleScript(100, 200);
      expect(script).toContain("100");
      expect(script).toContain("200");
    });
  });

  // ── getMoveCursorScript ────────────────────────────────────────────

  describe("getMoveCursorScript", () => {
    it("returns string containing the coordinates", () => {
      const script = getMoveCursorScript(50, 75);
      expect(script).toContain("50");
      expect(script).toContain("75");
    });
  });

  // ── getToggleCursorScript ──────────────────────────────────────────

  describe("getToggleCursorScript", () => {
    it("returns different strings for true vs false", () => {
      const showScript = getToggleCursorScript(true);
      const hideScript = getToggleCursorScript(false);
      expect(showScript).not.toBe(hideScript);
    });

    it("visible=true output contains 'true'", () => {
      expect(getToggleCursorScript(true)).toContain("true");
    });

    it("visible=false output contains 'false'", () => {
      expect(getToggleCursorScript(false)).toContain("false");
    });
  });
});
