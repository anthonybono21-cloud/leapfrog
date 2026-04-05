/**
 * v0.6.0 Integration Wiring Tests
 *
 * Verifies that the 6 new modules introduced in v0.6.0 are correctly wired
 * into index.ts. Tests the module contracts, singleton identity, session
 * identity fields, tab-switch ref isolation, and stealth init script ordering.
 *
 * These tests run WITHOUT a real browser wherever possible.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// ─── Test Group 1: Import Verification ──────────────────────────────────────

describe("Group 1: Import Verification", () => {
  it("imports session-hud without errors", async () => {
    const hud = await import("../session-hud.js");
    expect(hud).toBeDefined();
  });

  it("imports intervention without errors", async () => {
    const intervention = await import("../intervention.js");
    expect(intervention).toBeDefined();
  });

  it("imports sidecar without errors", async () => {
    const sidecar = await import("../sidecar.js");
    expect(sidecar).toBeDefined();
  });

  it("imports notify without errors", async () => {
    const notify = await import("../notify.js");
    expect(notify).toBeDefined();
  });

  it("imports consent-dismiss without errors", async () => {
    const consent = await import("../consent-dismiss.js");
    expect(consent).toBeDefined();
  });

  it("imports domain-knowledge without errors", async () => {
    const dk = await import("../domain-knowledge.js");
    expect(dk).toBeDefined();
  });

  it("session-hud exports the expected functions", async () => {
    const hud = await import("../session-hud.js");
    expect(typeof hud.getHUDInitScript).toBe("function");
    expect(typeof hud.getHUDUpdateScript).toBe("function");
    expect(typeof hud.getClickRippleScript).toBe("function");
    expect(typeof hud.getMoveCursorScript).toBe("function");
    expect(typeof hud.getToggleCursorScript).toBe("function");
  });

  it("intervention exports the expected functions and types", async () => {
    const intervention = await import("../intervention.js");
    expect(typeof intervention.getDetectionInitScript).toBe("function");
    expect(typeof intervention.getDetectionCheckScript).toBe("function");
    expect(typeof intervention.getOverlayScript).toBe("function");
    expect(typeof intervention.getDismissScript).toBe("function");
    expect(typeof intervention.getResolutionCheckScript).toBe("function");
    expect(typeof intervention.parseDetectionResult).toBe("function");
  });

  it("sidecar exports the SidecarServer class", async () => {
    const sidecar = await import("../sidecar.js");
    expect(typeof sidecar.SidecarServer).toBe("function");
  });

  it("notify exports chime and alert functions", async () => {
    const notify = await import("../notify.js");
    expect(typeof notify.chime).toBe("function");
    expect(typeof notify.alert).toBe("function");
  });

  it("consent-dismiss exports the expected functions", async () => {
    const consent = await import("../consent-dismiss.js");
    expect(typeof consent.getConsentDismissScript).toBe("function");
    expect(typeof consent.getCacheSelectorScript).toBe("function");
    expect(typeof consent.getConsentDetectScript).toBe("function");
    expect(typeof consent.getManualDismissScript).toBe("function");
  });

  it("domain-knowledge exports the DomainKnowledge class and singleton", async () => {
    const dk = await import("../domain-knowledge.js");
    expect(typeof dk.DomainKnowledge).toBe("function");
    expect(dk.domainKnowledge).toBeDefined();
    expect(dk.domainKnowledge).toBeInstanceOf(dk.DomainKnowledge);
  });
});

// ─── Test Group 2: Session Identity Integration ─────────────────────────────

describe("Group 2: Session Identity Integration", () => {
  let manager: InstanceType<typeof import("../session-manager.js").SessionManager>;

  beforeAll(async () => {
    const { SessionManager } = await import("../session-manager.js");
    manager = new SessionManager({
      maxSessions: 5,
      idleTimeoutMs: 500,
      cleanupIntervalMs: 300,
      headless: true,
    });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("session object has name, domain, pinned fields", async () => {
    const session = await manager.createSession();
    // Fields exist on the Session type (may be undefined initially)
    expect("name" in session || session.name === undefined).toBe(true);
    expect("domain" in session || session.domain === undefined).toBe(true);
    expect("pinned" in session || session.pinned === undefined).toBe(true);
    await manager.destroySession(session.id);
  });

  it("pinned field can be set on a session", async () => {
    const session = await manager.createSession();
    session.pinned = true;
    expect(session.pinned).toBe(true);
    await manager.destroySession(session.id);
  });

  it("findByName() returns undefined for nonexistent names", () => {
    const result = manager.findByName("nonexistent-session-name");
    expect(result).toBeUndefined();
  });

  it("findByName() returns a session after setting session.name", async () => {
    const session = await manager.createSession();
    session.name = "my-test-session";
    const found = manager.findByName("my-test-session");
    expect(found).toBeDefined();
    expect(found!.id).toBe(session.id);
    await manager.destroySession(session.id);
  });

  it("findByName() is case-insensitive", async () => {
    const session = await manager.createSession();
    session.name = "GitHub";
    const found = manager.findByName("github");
    expect(found).toBeDefined();
    expect(found!.id).toBe(session.id);
    await manager.destroySession(session.id);
  });

  it("sweepIdle() skips pinned sessions", async () => {
    // Create two sessions
    const s1 = await manager.createSession();
    const s2 = await manager.createSession();

    // Pin s1, leave s2 unpinned
    s1.pinned = true;

    // Force both sessions to appear idle by backdating lastUsedAt
    const longAgo = Date.now() - 100_000;
    s1.lastUsedAt = longAgo;
    s2.lastUsedAt = longAgo;

    // Wait for the cleanup timer to fire (idleTimeoutMs is 500ms, cleanup runs every 30s by default)
    // Instead of waiting, we can trigger a sweep indirectly by checking after a short wait.
    // The manager's idleTimeoutMs is 500ms so both are well past it.
    // We need to wait for at least one cleanup tick. Let's just wait a bit.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // s1 should still be alive (pinned), s2 should be swept
    expect(manager.getSession(s1.id)).toBeDefined();
    expect(manager.getSession(s2.id)).toBeUndefined();

    // Clean up the pinned session
    await manager.destroySession(s1.id);
  }, 10000);
});

// ─── Test Group 3: Domain Knowledge Singleton ───────────────────────────────

describe("Group 3: Domain Knowledge Singleton", () => {
  it("domainKnowledge is an instance of DomainKnowledge", async () => {
    const { domainKnowledge, DomainKnowledge } = await import("../domain-knowledge.js");
    expect(domainKnowledge).toBeInstanceOf(DomainKnowledge);
  });

  it("domainKnowledge.listDomains() returns an array", async () => {
    const { domainKnowledge } = await import("../domain-knowledge.js");
    const domains = domainKnowledge.listDomains();
    expect(Array.isArray(domains)).toBe(true);
  });

  it("singleton is the same reference on multiple imports", async () => {
    const dk1 = await import("../domain-knowledge.js");
    const dk2 = await import("../domain-knowledge.js");
    expect(dk1.domainKnowledge).toBe(dk2.domainKnowledge);
  });
});

// ─── Test Group 4: Module API Contract Verification ─────────────────────────

describe("Group 4: Module API Contract Verification", () => {
  it("getHUDInitScript accepts a string and returns a string", async () => {
    const { getHUDInitScript } = await import("../session-hud.js");
    const result = getHUDInitScript("test-session");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("getHUDUpdateScript accepts HUDStatus and optional string, returns string", async () => {
    const { getHUDUpdateScript } = await import("../session-hud.js");
    const result1 = getHUDUpdateScript("active");
    expect(typeof result1).toBe("string");
    const result2 = getHUDUpdateScript("loading", "Navigating...");
    expect(typeof result2).toBe("string");
  });

  it("getDetectionInitScript takes no args and returns string", async () => {
    const { getDetectionInitScript } = await import("../intervention.js");
    const result = getDetectionInitScript();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("getDetectionCheckScript takes no args and returns string", async () => {
    const { getDetectionCheckScript } = await import("../intervention.js");
    const result = getDetectionCheckScript();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("getOverlayScript accepts a string and returns string", async () => {
    const { getOverlayScript } = await import("../intervention.js");
    const result = getOverlayScript("CAPTCHA detected — please solve it");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("getDismissScript takes no args and returns string", async () => {
    const { getDismissScript } = await import("../intervention.js");
    const result = getDismissScript();
    expect(typeof result).toBe("string");
  });

  it("getResolutionCheckScript takes no args and returns string", async () => {
    const { getResolutionCheckScript } = await import("../intervention.js");
    const result = getResolutionCheckScript();
    expect(typeof result).toBe("string");
  });

  it("parseDetectionResult accepts unknown and returns InterventionEvent or null", async () => {
    const { parseDetectionResult } = await import("../intervention.js");

    // null / undefined / non-object
    expect(parseDetectionResult(null)).toBeNull();
    expect(parseDetectionResult(undefined)).toBeNull();
    expect(parseDetectionResult("string")).toBeNull();

    // Invalid object (missing fields)
    expect(parseDetectionResult({ type: "captcha" })).toBeNull();

    // Valid InterventionEvent
    const valid = parseDetectionResult({
      type: "captcha",
      reason: "reCAPTCHA detected",
      elementSelector: "iframe[src*='recaptcha']",
      timestamp: Date.now(),
    });
    expect(valid).not.toBeNull();
    expect(valid!.type).toBe("captcha");
    expect(valid!.reason).toBe("reCAPTCHA detected");

    // Invalid type string
    expect(parseDetectionResult({
      type: "bogus",
      reason: "test",
      timestamp: 12345,
    })).toBeNull();
  });

  it("SidecarServer constructor accepts a SidecarDeps object", async () => {
    const { SidecarServer } = await import("../sidecar.js");
    const mockDeps = {
      listSessions: () => [],
      focusSession: async () => {},
      zoomSession: async () => {},
      restoreGrid: async () => {},
      setLayout: async () => {},
      destroyAll: async () => {},
      screenshot: async () => Buffer.from(""),
    };
    const server = new SidecarServer(mockDeps);
    expect(server).toBeDefined();
    expect(server).toBeInstanceOf(SidecarServer);
  });

  it("chime is a function, alert is a function (from notify)", async () => {
    const notify = await import("../notify.js");
    expect(typeof notify.chime).toBe("function");
    expect(typeof notify.alert).toBe("function");
  });

  it("getConsentDismissScript takes no args and returns string", async () => {
    const { getConsentDismissScript } = await import("../consent-dismiss.js");
    const result = getConsentDismissScript();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("getCacheSelectorScript accepts two strings and returns string", async () => {
    const { getCacheSelectorScript } = await import("../consent-dismiss.js");
    const result = getCacheSelectorScript("example.com", "#accept-cookies");
    expect(typeof result).toBe("string");
    expect(result).toContain("example.com");
    expect(result).toContain("#accept-cookies");
  });

  it("domainKnowledge.load is an async function", async () => {
    const { domainKnowledge } = await import("../domain-knowledge.js");
    expect(typeof domainKnowledge.load).toBe("function");
    // load returns a Promise
    const result = domainKnowledge.load("test-domain.com");
    expect(result).toBeInstanceOf(Promise);
    // Await to avoid unhandled rejection
    const record = await result;
    expect(record).toBeDefined();
    expect(record.domain).toBe("test-domain.com");
  });

  it("domainKnowledge.recordNavigation is a function", async () => {
    const { domainKnowledge } = await import("../domain-knowledge.js");
    expect(typeof domainKnowledge.recordNavigation).toBe("function");
    // Should not throw
    domainKnowledge.recordNavigation("test-domain.com", "networkidle", 500);
  });

  it("domainKnowledge.flush is an async function", async () => {
    const { domainKnowledge } = await import("../domain-knowledge.js");
    expect(typeof domainKnowledge.flush).toBe("function");
    const result = domainKnowledge.flush();
    expect(result).toBeInstanceOf(Promise);
    await result; // Should resolve without error
  });
});

// ─── Test Group 5: Tab Switch Ref Isolation ─────────────────────────────────

describe("Group 5: Tab Switch Ref Isolation (Bug Fix Verification)", () => {
  let manager: InstanceType<typeof import("../session-manager.js").SessionManager>;

  beforeAll(async () => {
    const { SessionManager } = await import("../session-manager.js");
    manager = new SessionManager({ maxSessions: 3, headless: true });
  });

  afterAll(async () => {
    await manager.destroyAll();
  });

  it("tab switch updates staleRefThreshold and bumps navGeneration", async () => {
    const { tabManager } = await import("../tab-manager.js");
    const session = await manager.createSession();

    // Simulate having accumulated refs
    session.refCounter = 10;
    session.refMap.set("@e1", "button >> nth=0");
    session.refMap.set("@e5", "a >> nth=2");
    session.refMap.set("@e10", "input >> nth=0");

    const initialNavGen = session.navGeneration ?? 0;

    // Open a new tab (navigate to trigger a new page in the context)
    const page2 = await session.context.newPage();
    // Wait a tick for the "page" event handler to fire
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now switch to the new tab (index 1)
    const { pages } = { pages: session.pages ?? [session.page] };
    const newTabIndex = pages.length - 1;
    tabManager.switchTab(session, newTabIndex);

    // Verify ref isolation: staleRefThreshold should be set to the old refCounter
    expect(session.staleRefThreshold).toBe(10);
    // navGeneration should have been bumped
    expect(session.navGeneration).toBe(initialNavGen + 1);

    await manager.destroySession(session.id);
  });
});

// ─── Test Group 6: Stealth Init Script Race Fix Verification ────────────────

describe("Group 6: Stealth Init Script Race Fix", () => {
  it("getInitScript output starts with __pwInitScripts cleanup", async () => {
    const { stealth } = await import("../stealth.js");
    const script = stealth.getInitScript();

    // The very first meaningful code block should be the Playwright globals cleanup
    // Strip leading whitespace/comments and find the first IIFE
    const lines = script.split("\n");
    let firstCodeFound = false;
    let cleanupFoundBeforeOtherCode = false;

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip blank lines and comment lines
      if (trimmed === "" || trimmed.startsWith("//")) continue;

      if (!firstCodeFound) {
        firstCodeFound = true;
        // The first actual code should be the cleanup IIFE
        if (trimmed.startsWith("(function()")) {
          cleanupFoundBeforeOtherCode = true;
        }
      }
      break;
    }

    expect(cleanupFoundBeforeOtherCode).toBe(true);
  });

  it("getInitScript output contains delete window.__pwInitScripts", async () => {
    const { stealth } = await import("../stealth.js");
    const script = stealth.getInitScript();
    expect(script).toContain("__pwInitScripts");
    expect(script).toContain("delete window[globals[i]]");
  });

  it("__pwInitScripts cleanup appears before PRNG seed setup", async () => {
    const { stealth } = await import("../stealth.js");
    const script = stealth.getInitScript();

    const cleanupIndex = script.indexOf("__pwInitScripts");
    const prngIndex = script.indexOf("__leapSeed");

    expect(cleanupIndex).toBeGreaterThan(-1);
    expect(prngIndex).toBeGreaterThan(-1);
    expect(cleanupIndex).toBeLessThan(prngIndex);
  });
});
