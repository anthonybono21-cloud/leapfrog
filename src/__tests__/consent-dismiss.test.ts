import { describe, it, expect } from "vitest";
import {
  CONSENT_SELECTORS,
  getConsentDismissScript,
  getConsentDetectScript,
  getManualDismissScript,
  getCacheSelectorScript,
} from "../consent-dismiss.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("consent-dismiss", () => {
  // ── 1. CONSENT_SELECTORS is a non-empty array ─────────────────────────

  it("CONSENT_SELECTORS is a non-empty array", () => {
    expect(Array.isArray(CONSENT_SELECTORS)).toBe(true);
    expect(CONSENT_SELECTORS.length).toBeGreaterThan(0);
  });

  // ── 2. Contains major consent frameworks ──────────────────────────────

  it("contains OneTrust, CookieBot, and other major frameworks", () => {
    const names = CONSENT_SELECTORS.map((f) => f.name);
    expect(names).toContain("OneTrust");
    expect(names).toContain("CookieBot");
    expect(names).toContain("TrustArc");
    expect(names).toContain("Quantcast");
    expect(names).toContain("Didomi");
  });

  // ── 3. Each entry has a name and non-empty selectors array ────────────

  it("each entry has a name and non-empty selectors array", () => {
    for (const entry of CONSENT_SELECTORS) {
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.selectors)).toBe(true);
      expect(entry.selectors.length).toBeGreaterThan(0);
    }
  });

  // ── 4. getConsentDismissScript() returns non-empty consent-related JS ─

  it("getConsentDismissScript() returns non-empty string containing consent-related JS", () => {
    const script = getConsentDismissScript();
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
    // Should contain consent-related logic
    expect(script).toContain("consent");
  });

  // ── 5. getConsentDismissScript() output contains __leapfrog_consent ───

  it("getConsentDismissScript() output contains __leapfrog_consent reference", () => {
    const script = getConsentDismissScript();
    expect(script).toContain("__leapfrog_consent");
  });

  // ── 6. getConsentDismissScript() output contains MutationObserver or setTimeout ─

  it("getConsentDismissScript() output contains MutationObserver or setTimeout pattern", () => {
    const script = getConsentDismissScript();
    const hasMutationObserver = script.includes("MutationObserver");
    const hasSetTimeout = script.includes("setTimeout");
    expect(hasMutationObserver || hasSetTimeout).toBe(true);
    // In practice, the script uses both
    expect(hasMutationObserver).toBe(true);
    expect(hasSetTimeout).toBe(true);
  });

  // ── 7. getConsentDetectScript() returns non-empty string ──────────────

  it("getConsentDetectScript() returns non-empty string", () => {
    const script = getConsentDetectScript();
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
  });

  // ── 8. getManualDismissScript() returns non-empty string that resets dismissed flag ─

  it("getManualDismissScript() returns non-empty string that resets dismissed flag", () => {
    const script = getManualDismissScript();
    expect(typeof script).toBe("string");
    expect(script.length).toBeGreaterThan(0);
    // Must reset the dismissed flag so the dismiss function runs fresh
    expect(script).toContain("__leapfrog_consent_dismissed");
    expect(script).toContain("false");
  });

  // ── 9. getCacheSelectorScript() returns string containing domain and selector ─

  it("getCacheSelectorScript('example.com', '#accept') returns string with domain and selector", () => {
    const script = getCacheSelectorScript("example.com", "#accept");
    expect(typeof script).toBe("string");
    expect(script).toContain("example.com");
    expect(script).toContain("#accept");
  });
});
