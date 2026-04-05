import { describe, it, expect } from "vitest";
import {
  getDetectionInitScript,
  getDetectionCheckScript,
  getOverlayScript,
  getDismissScript,
  getResolutionCheckScript,
  getFullscreenScript,
  parseDetectionResult,
} from "../intervention.js";
import type { InterventionType, InterventionEvent } from "../intervention.js";

// ---------------------------------------------------------------------------
// Unit tests — pure string-returning functions + parse logic, no browser.
// ---------------------------------------------------------------------------

describe("intervention", () => {
  // ── getDetectionInitScript ─────────────────────────────────────────

  describe("getDetectionInitScript", () => {
    it("returns non-empty string containing MutationObserver", () => {
      const script = getDetectionInitScript();
      expect(script).toBeTruthy();
      expect(script).toContain("MutationObserver");
    });
  });

  // ── getDetectionCheckScript ────────────────────────────────────────

  describe("getDetectionCheckScript", () => {
    it("returns non-empty string", () => {
      const script = getDetectionCheckScript();
      expect(script).toBeTruthy();
      expect(script.length).toBeGreaterThan(0);
    });
  });

  // ── getOverlayScript ──────────────────────────────────────────────

  describe("getOverlayScript", () => {
    it("returns string containing '@..@' and the reason text", () => {
      const script = getOverlayScript("CAPTCHA detected");
      expect(script).toContain("@..@");
      expect(script).toContain("CAPTCHA detected");
    });

    it("output contains the Done button (leapfrog-intervention-done)", () => {
      const script = getOverlayScript("Login wall");
      expect(script).toContain("leapfrog-intervention-done");
    });

    it("safely escapes single quotes in reason", () => {
      const script = getOverlayScript("Can't proceed");
      // Should not break the JS string — the quote should be escaped
      expect(script).toContain("Can\\'t proceed");
    });
  });

  // ── getDismissScript ──────────────────────────────────────────────

  describe("getDismissScript", () => {
    it("returns non-empty string", () => {
      const script = getDismissScript();
      expect(script).toBeTruthy();
      expect(script.length).toBeGreaterThan(0);
    });
  });

  // ── getResolutionCheckScript ──────────────────────────────────────

  describe("getResolutionCheckScript", () => {
    it("returns string referencing __leapfrog_intervention_resolved", () => {
      const script = getResolutionCheckScript();
      expect(script).toContain("__leapfrog_intervention_resolved");
    });
  });

  // ── getFullscreenScript ───────────────────────────────────────────

  describe("getFullscreenScript", () => {
    it("returns string referencing __leapfrog_requestFullscreen", () => {
      const script = getFullscreenScript();
      expect(script).toContain("__leapfrog_requestFullscreen");
    });
  });

  // ── parseDetectionResult ──────────────────────────────────────────

  describe("parseDetectionResult", () => {
    it("returns null for null input", () => {
      expect(parseDetectionResult(null)).toBeNull();
    });

    it("returns null for undefined input", () => {
      expect(parseDetectionResult(undefined)).toBeNull();
    });

    it("returns a valid InterventionEvent for well-formed input", () => {
      const raw = { type: "captcha", reason: "reCAPTCHA", timestamp: 123 };
      const result = parseDetectionResult(raw);
      expect(result).not.toBeNull();
      expect(result!.type).toBe("captcha");
      expect(result!.reason).toBe("reCAPTCHA");
      expect(result!.timestamp).toBe(123);
    });

    it("returns null for object missing required fields", () => {
      expect(parseDetectionResult({ invalid: true })).toBeNull();
    });

    it("returns null for object with wrong type field", () => {
      expect(
        parseDetectionResult({ type: "unknown", reason: "x", timestamp: 1 })
      ).toBeNull();
    });

    it("returns null for object missing reason", () => {
      expect(
        parseDetectionResult({ type: "captcha", timestamp: 1 })
      ).toBeNull();
    });

    it("returns null for object missing timestamp", () => {
      expect(
        parseDetectionResult({ type: "captcha", reason: "x" })
      ).toBeNull();
    });

    it("includes elementSelector when provided as a string", () => {
      const raw = {
        type: "captcha",
        reason: "reCAPTCHA",
        timestamp: 100,
        elementSelector: "iframe.recaptcha",
      };
      const result = parseDetectionResult(raw);
      expect(result).not.toBeNull();
      expect(result!.elementSelector).toBe("iframe.recaptcha");
    });

    it("omits elementSelector when it is not a string", () => {
      const raw = {
        type: "captcha",
        reason: "reCAPTCHA",
        timestamp: 100,
        elementSelector: 42,
      };
      const result = parseDetectionResult(raw);
      expect(result).not.toBeNull();
      expect(result!.elementSelector).toBeUndefined();
    });

    it("handles all valid InterventionType values", () => {
      const types: InterventionType[] = [
        "captcha",
        "login",
        "oauth",
        "challenge",
        "manual",
      ];
      for (const t of types) {
        const result = parseDetectionResult({
          type: t,
          reason: `${t} reason`,
          timestamp: Date.now(),
        });
        expect(result).not.toBeNull();
        expect(result!.type).toBe(t);
      }
    });
  });
});
