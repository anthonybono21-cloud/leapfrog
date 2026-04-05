import { describe, it, expect } from "vitest";
import {
  getHUDInitScript,
  getHUDUpdateScript,
  getClickRippleScript,
  getMoveCursorScript,
  getToggleCursorScript,
  getScrollToTargetScript,
} from "../session-hud.js";
import type { HUDStatus } from "../session-hud.js";

// ---------------------------------------------------------------------------
// Unit tests — pure string-returning functions, no browser needed.
// ---------------------------------------------------------------------------

describe("session-hud", () => {
  // ── getHUDInitScript ───────────────────────────────────────────────

  describe("getHUDInitScript", () => {
    it("returns a non-empty string containing ripple setup", () => {
      const script = getHUDInitScript("my-session");
      expect(script).toBeTruthy();
      expect(script).toContain("leapfrog-ripple");
    });

    it("output contains ripple CSS (z-index, leapfrog-ripple-container)", () => {
      const script = getHUDInitScript("test");
      expect(script).toContain("z-index");
      expect(script).toContain("leapfrog-ripple-container");
      expect(script).toContain("leapfrog-ripple");
    });

    it("output references window.__leapfrog (valid JS control surface)", () => {
      const script = getHUDInitScript("test");
      expect(script).toContain("window.__leapfrog");
    });
  });

  // ── getHUDUpdateScript ─────────────────────────────────────────────

  describe("getHUDUpdateScript", () => {
    it("returns empty string for 'active' (status bar removed)", () => {
      const script = getHUDUpdateScript("active");
      expect(script).toBe("");
    });

    it("returns empty string for 'loading' (status bar removed)", () => {
      const script = getHUDUpdateScript("loading");
      expect(script).toBe("");
    });

    it("returns empty string for 'error' (status bar removed)", () => {
      const script = getHUDUpdateScript("error");
      expect(script).toBe("");
    });

    it("returns empty string regardless of label (status bar removed)", () => {
      const script = getHUDUpdateScript("active", "Navigating...");
      expect(script).toBe("");
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
    it("returns empty string (agent cursor removed)", () => {
      const script = getMoveCursorScript(50, 75);
      expect(script).toBe("");
    });
  });

  // ── getToggleCursorScript ──────────────────────────────────────────

  describe("getToggleCursorScript", () => {
    it("returns empty string for both true and false (cursor removed)", () => {
      const showScript = getToggleCursorScript(true);
      const hideScript = getToggleCursorScript(false);
      expect(showScript).toBe("");
      expect(hideScript).toBe("");
    });

    it("visible=true returns empty string", () => {
      expect(getToggleCursorScript(true)).toBe("");
    });

    it("visible=false returns empty string", () => {
      expect(getToggleCursorScript(false)).toBe("");
    });
  });

  // ── getScrollToTargetScript ────────────────────────────────────────

  describe("getScrollToTargetScript", () => {
    it("returns JS containing the selector", () => {
      const script = getScrollToTargetScript("#my-element");
      expect(script).toContain("#my-element");
      expect(script).toContain("scrollIntoView");
    });

    it("escapes single quotes in selector", () => {
      const script = getScrollToTargetScript("div[data-name='test']");
      expect(script).toContain("\\'");
    });

    it("escapes backslashes in selector", () => {
      const script = getScrollToTargetScript("div\\[class]");
      expect(script).toContain("\\\\");
    });

    it("returns valid IIFE structure", () => {
      const script = getScrollToTargetScript(".target");
      expect(script).toContain("(function()");
      expect(script.trim().endsWith("})();")).toBe(true);
    });
  });
});
