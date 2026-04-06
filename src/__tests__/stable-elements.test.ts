import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { SnapshotEngine, elementFingerprint } from "../snapshot-engine.js";
import { DomainKnowledge } from "../domain-knowledge.js";
import type { Session } from "../types.js";
import { tmpdir } from "os";
import { join } from "path";
import { rm } from "fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "s_stable01",
    context: {} as any,
    page: {} as any,
    pages: [],
    activePageIndex: 0,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    refCounter: 0,
    refMap: new Map(),
    networkLog: [],
    consoleLog: [],
    interceptRules: [],
    ...overrides,
  };
}

function mockPage(yaml: string) {
  return {
    ariaSnapshot: vi.fn().mockResolvedValue(yaml),
    locator: vi.fn().mockReturnValue({
      first: () => ({
        ariaSnapshot: vi.fn().mockResolvedValue(yaml),
      }),
    }),
  } as any;
}

const testDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `leapfrog-stable-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  testDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  for (const dir of testDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Stable Elements", () => {
  let engine: SnapshotEngine;

  beforeEach(() => {
    engine = new SnapshotEngine();
  });

  // ── 1. Fingerprints are extracted correctly from snapshot results ────

  it("extracts fingerprints from snapshot results", async () => {
    const yaml = [
      '- button "Save" [ref=e1]',
      '- link "Home" [ref=e2]',
      '- textbox "Email" [ref=e3]',
      '- heading "Welcome" [level=1] [ref=e4]',
    ].join("\n");

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.fingerprints).toBeDefined();
    expect(result.fingerprints).toHaveLength(4);
    expect(result.fingerprints).toContain("button:save");
    expect(result.fingerprints).toContain("link:home");
    expect(result.fingerprints).toContain("textbox:email");
    expect(result.fingerprints).toContain("heading:welcome");
  });

  // ── 2. Fingerprints are case-insensitive for the name portion ───────

  it("fingerprints are case-insensitive for names", async () => {
    const yaml = [
      '- link "Sign In" [ref=e1]',
      '- button "SUBMIT" [ref=e2]',
    ].join("\n");

    const session = makeSession();
    const page = mockPage(yaml);
    const result = await engine.snapshot(page, session);

    expect(result.fingerprints).toContain("link:sign in");
    expect(result.fingerprints).toContain("button:submit");
  });

  // ── 3. elementFingerprint helper works correctly ────────────────────

  it("elementFingerprint produces correct format", () => {
    // Simulate a ParsedNode-like object
    const fp = elementFingerprint({
      role: "link",
      name: "About Us",
      ariaRef: "e1",
      attrs: new Map(),
      depth: 0,
      children: [],
    } as any);

    expect(fp).toBe("link:about us");
  });

  // ── 4. Stable elements accumulate after multiple visits ─────────────

  it("stable elements accumulate after multiple recordElementFingerprints calls", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("test.com");

    const visit1 = ["link:home", "link:about", "button:login"];
    dk.recordElementFingerprints("test.com", visit1);

    const record = dk.get("test.com")!;
    expect(record.stableElements).toHaveLength(3);
    expect(record.stableElements[0].seenCount).toBe(1);

    const visit2 = ["link:home", "link:about", "button:login"];
    dk.recordElementFingerprints("test.com", visit2);

    expect(record.stableElements[0].seenCount).toBe(2);
    expect(record.stableElements[1].seenCount).toBe(2);
    expect(record.stableElements[2].seenCount).toBe(2);

    const visit3 = ["link:home", "link:about", "button:login"];
    dk.recordElementFingerprints("test.com", visit3);

    expect(record.stableElements[0].seenCount).toBe(3);
  });

  // ── 5. seenCount increments correctly ───────────────────────────────

  it("seenCount increments only for fingerprints present in the visit", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("increment.com");

    dk.recordElementFingerprints("increment.com", ["link:home", "link:about"]);
    dk.recordElementFingerprints("increment.com", ["link:home"]); // about is missing

    const record = dk.get("increment.com")!;
    const home = record.stableElements.find((e) => e.fingerprint === "link:home");
    const about = record.stableElements.find((e) => e.fingerprint === "link:about");

    expect(home!.seenCount).toBe(2);
    expect(about!.seenCount).toBe(1); // only seen once
  });

  // ── 6. Elements missing for 3+ consecutive visits are removed ───────

  it("removes fingerprints not seen in 3+ consecutive visits", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("removal.com");

    // Add an element
    dk.recordElementFingerprints("removal.com", ["link:home", "link:promo"]);

    // 3 visits without "link:promo"
    dk.recordElementFingerprints("removal.com", ["link:home"]);
    dk.recordElementFingerprints("removal.com", ["link:home"]);
    dk.recordElementFingerprints("removal.com", ["link:home"]);

    const record = dk.get("removal.com")!;
    const promo = record.stableElements.find((e) => e.fingerprint === "link:promo");
    expect(promo).toBeUndefined(); // removed after 3 consecutive misses

    const home = record.stableElements.find((e) => e.fingerprint === "link:home");
    expect(home).toBeDefined();
    expect(home!.seenCount).toBe(4); // seen on all 4 visits
  });

  // ── 7. getStableFingerprints returns only elements with sufficient seenCount ─

  it("getStableFingerprints returns only elements with seenCount >= minSeen", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("filter.com");

    // Visit 1
    dk.recordElementFingerprints("filter.com", ["link:home", "link:about", "link:new"]);
    // Visit 2
    dk.recordElementFingerprints("filter.com", ["link:home", "link:about"]);
    // Visit 3
    dk.recordElementFingerprints("filter.com", ["link:home", "link:about"]);

    // link:home has seenCount=3, link:about has seenCount=3, link:new has seenCount=1
    const stable = dk.getStableFingerprints("filter.com", 3);
    expect(stable).toContain("link:home");
    expect(stable).toContain("link:about");
    expect(stable).not.toContain("link:new");
  });

  // ── 8. Suppression reduces node count after 3+ visits ──────────────

  it("suppression reduces node count when suppress set is provided", async () => {
    const yaml = [
      '- link "Home" [ref=e1]',
      '- link "About" [ref=e2]',
      '- link "Contact" [ref=e3]',
      '- button "Sign Up" [ref=e4]',
      '- heading "Welcome" [level=1] [ref=e5]',
    ].join("\n");

    const page = mockPage(yaml);

    // First snapshot — no suppression
    const session1 = makeSession();
    const result1 = await engine.snapshot(page, session1);
    expect(result1.nodeCount).toBe(5);
    expect(result1.elementsSuppressed).toBe(0);

    // Second snapshot — suppress nav links
    const suppressSet = new Set(["link:home", "link:about", "link:contact"]);
    const session2 = makeSession();
    const result2 = await engine.snapshot(page, session2, {
      suppressFingerprints: suppressSet,
    });

    expect(result2.nodeCount).toBe(2); // button + heading remain
    expect(result2.elementsSuppressed).toBe(3);
    expect(result2.tokensSaved).toBe(90); // 3 * 30
    expect(result2.text).toContain('button "Sign Up"');
    expect(result2.text).toContain('heading "Welcome"');
    expect(result2.text).not.toContain('link "Home"');
    expect(result2.text).not.toContain('link "About"');
    expect(result2.text).not.toContain('link "Contact"');
  });

  // ── 9. Form inputs are NEVER suppressed ────────────────────────────

  it("never suppresses form inputs even when in suppress set", async () => {
    const yaml = [
      '- textbox "Email" [ref=e1]',
      '- checkbox "Accept Terms" [ref=e2]',
      '- radio "Option A" [ref=e3]',
      '- combobox "Country" [ref=e4]',
      '- searchbox "Search" [ref=e5]',
      '- link "Home" [ref=e6]',
    ].join("\n");

    const page = mockPage(yaml);

    // Suppress all fingerprints — form inputs should survive
    const suppressSet = new Set([
      "textbox:email",
      "checkbox:accept terms",
      "radio:option a",
      "combobox:country",
      "searchbox:search",
      "link:home",
    ]);

    const session = makeSession();
    const result = await engine.snapshot(page, session, {
      suppressFingerprints: suppressSet,
    });

    // Only the link should be suppressed — all form inputs survive
    expect(result.nodeCount).toBe(5);
    expect(result.elementsSuppressed).toBe(1); // just the link
    expect(result.text).toContain('textbox "Email"');
    expect(result.text).toContain('checkbox "Accept Terms"');
    expect(result.text).toContain('radio "Option A"');
    expect(result.text).toContain('combobox "Country"');
    expect(result.text).toContain('searchbox "Search"');
    expect(result.text).not.toContain('link "Home"');
  });

  // ── 10. The 60% minimum floor ──────────────────────────────────────

  it("does not suppress more than 60% of elements (safety floor)", async () => {
    // 5 elements — 60% floor means max 3 can be suppressed
    const yaml = [
      '- link "Home" [ref=e1]',
      '- link "About" [ref=e2]',
      '- link "Services" [ref=e3]',
      '- link "Contact" [ref=e4]',
      '- heading "Title" [level=1] [ref=e5]',
    ].join("\n");

    const page = mockPage(yaml);

    // Try to suppress all 4 links (80%) — should be blocked by 60% floor
    const suppressSet = new Set([
      "link:home",
      "link:about",
      "link:services",
      "link:contact",
    ]);

    const session = makeSession();
    const result = await engine.snapshot(page, session, {
      suppressFingerprints: suppressSet,
    });

    // The 60% floor should prevent suppression entirely (4/5 = 80% > 60%)
    // Engine falls back to no suppression when the cap is exceeded
    expect(result.nodeCount).toBe(5);
    expect(result.elementsSuppressed).toBe(0);
  });

  // ── 11. Suppression metrics are correct ────────────────────────────

  it("reports correct suppression metrics", async () => {
    const yaml = [
      '- link "Home" [ref=e1]',
      '- link "About" [ref=e2]',
      '- button "Save" [ref=e3]',
      '- heading "Page Title" [level=1] [ref=e4]',
      '- textbox "Name" [ref=e5]',
    ].join("\n");

    const page = mockPage(yaml);
    const suppressSet = new Set(["link:home"]); // suppress 1 of 5 (20%, under 60%)

    const session = makeSession();
    const result = await engine.snapshot(page, session, {
      suppressFingerprints: suppressSet,
    });

    expect(result.elementsTotal).toBe(5);
    expect(result.elementsSuppressed).toBe(1);
    expect(result.tokensSaved).toBe(30);
    expect(result.nodeCount).toBe(4);
  });

  // ── 12. New fingerprints are added, existing ones incremented ───────

  it("adds new fingerprints and increments existing ones correctly", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("mixed.com");

    dk.recordElementFingerprints("mixed.com", ["link:home", "link:about"]);
    dk.recordElementFingerprints("mixed.com", ["link:home", "link:about", "button:new"]);

    const record = dk.get("mixed.com")!;
    expect(record.stableElements).toHaveLength(3);

    const home = record.stableElements.find((e) => e.fingerprint === "link:home");
    expect(home!.seenCount).toBe(2);

    const newBtn = record.stableElements.find(
      (e) => e.fingerprint === "button:new"
    );
    expect(newBtn!.seenCount).toBe(1);
  });

  // ── 13. Empty fingerprints are handled gracefully ──────────────────

  it("handles empty fingerprint arrays without errors", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("empty.com");

    dk.recordElementFingerprints("empty.com", []);

    const record = dk.get("empty.com")!;
    expect(record.stableElements).toEqual([]);
  });

  // ── 14. Persistence of stable elements through flush/reload ────────

  it("stable elements persist through flush and reload", async () => {
    const dir = makeTempDir();

    const dk1 = new DomainKnowledge(dir);
    await dk1.load("persist.com");

    dk1.recordElementFingerprints("persist.com", ["link:home", "link:about"]);
    dk1.recordElementFingerprints("persist.com", ["link:home", "link:about"]);
    dk1.recordElementFingerprints("persist.com", ["link:home", "link:about"]);
    await dk1.flush();

    // New instance loads from disk
    const dk2 = new DomainKnowledge(dir);
    const record = await dk2.load("persist.com");

    expect(record.stableElements).toHaveLength(2);
    const home = record.stableElements.find((e) => e.fingerprint === "link:home");
    expect(home!.seenCount).toBe(3);

    const stable = dk2.getStableFingerprints("persist.com", 3);
    expect(stable).toContain("link:home");
    expect(stable).toContain("link:about");
  });

  // ── 15. getStableFingerprints returns sorted by seenCount desc ─────

  it("getStableFingerprints returns sorted by seenCount descending", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("sorted.com");

    // link:home seen 5 times, link:about seen 3 times, button:save seen 4 times
    for (let i = 0; i < 5; i++) {
      const fps = ["link:home"];
      if (i < 4) fps.push("button:save");
      if (i < 3) fps.push("link:about");
      dk.recordElementFingerprints("sorted.com", fps);
    }

    const stable = dk.getStableFingerprints("sorted.com", 3);
    expect(stable[0]).toBe("link:home"); // 5x
    expect(stable[1]).toBe("button:save"); // 4x
    expect(stable[2]).toBe("link:about"); // 3x
  });

  // ── 16. Fingerprints include suppressed elements' children ─────────

  it("children of suppressed elements still appear in output", async () => {
    const yaml = [
      '- navigation "Main" [ref=e1]:',
      "  - link \"Home\" [ref=e2]",
      "  - link \"About\" [ref=e3]",
      '- button "Action" [ref=e4]',
    ].join("\n");

    const page = mockPage(yaml);
    // Suppress a child link — parent is a group, children should still work
    const suppressSet = new Set(["link:home"]);

    const session = makeSession();
    const result = await engine.snapshot(page, session, {
      suppressFingerprints: suppressSet,
    });

    // link:home should be suppressed, link:about and button:action remain
    expect(result.text).not.toContain('link "Home"');
    expect(result.text).toContain('link "About"');
    expect(result.text).toContain('button "Action"');
  });

  // ── 17. Switch and slider are form inputs — never suppressed ───────

  it("never suppresses switch and slider roles", async () => {
    const yaml = [
      '- switch "Dark Mode" [ref=e1]',
      '- slider "Volume" [ref=e2]',
      '- spinbutton "Quantity" [ref=e3]',
      '- listbox "Options" [ref=e4]',
    ].join("\n");

    const page = mockPage(yaml);
    const suppressSet = new Set([
      "switch:dark mode",
      "slider:volume",
      "spinbutton:quantity",
      "listbox:options",
    ]);

    const session = makeSession();
    const result = await engine.snapshot(page, session, {
      suppressFingerprints: suppressSet,
    });

    // All are form inputs — none suppressed
    expect(result.nodeCount).toBe(4);
    expect(result.elementsSuppressed).toBe(0);
  });

  // ── 18. Miss counter resets when element reappears ─────────────────

  it("miss counter resets when a previously-missing element reappears", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("reset.com");

    // Add elements
    dk.recordElementFingerprints("reset.com", ["link:home", "link:promo"]);

    // 2 visits without promo (not yet at 3 misses)
    dk.recordElementFingerprints("reset.com", ["link:home"]);
    dk.recordElementFingerprints("reset.com", ["link:home"]);

    // Promo reappears — should reset miss counter
    dk.recordElementFingerprints("reset.com", ["link:home", "link:promo"]);

    // 2 more visits without promo — still shouldn't be removed (miss counter was reset)
    dk.recordElementFingerprints("reset.com", ["link:home"]);
    dk.recordElementFingerprints("reset.com", ["link:home"]);

    const record = dk.get("reset.com")!;
    const promo = record.stableElements.find(
      (e) => e.fingerprint === "link:promo"
    );
    expect(promo).toBeDefined(); // still present — miss counter was reset
    expect(promo!.seenCount).toBe(2); // seen on visit 1 and visit 4
  });

  // ── 19. Domain normalization works for stable elements ─────────────

  it("stable elements work with normalized domain names", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("www.Example.COM");

    dk.recordElementFingerprints("www.Example.COM", ["link:home"]);
    dk.recordElementFingerprints("example.com", ["link:home"]);
    dk.recordElementFingerprints("Example.com", ["link:home"]);

    const stable = dk.getStableFingerprints("example.com", 3);
    expect(stable).toContain("link:home");
  });

  // ── 20. End-to-end: snapshot → record → suppress cycle ────────────

  it("full cycle: snapshot fingerprints → record → suppress on next snap", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("cycle.com");

    const yaml = [
      '- link "Home" [ref=e1]',
      '- link "About" [ref=e2]',
      '- button "Buy" [ref=e3]',
      '- heading "Products" [level=1] [ref=e4]',
    ].join("\n");

    const page = mockPage(yaml);

    // Simulate 3 visits — record fingerprints each time
    for (let i = 0; i < 3; i++) {
      const session = makeSession();
      const result = await engine.snapshot(page, session);
      dk.recordElementFingerprints("cycle.com", result.fingerprints!);
    }

    // Now get stable fingerprints and use as suppress set
    const stableFPs = dk.getStableFingerprints("cycle.com", 3);
    expect(stableFPs.length).toBe(4); // all 4 seen 3 times

    // But with 4/4 elements suppressed (100%), the 60% floor should kick in
    const suppressSet = new Set(stableFPs);
    const session4 = makeSession();
    const result4 = await engine.snapshot(page, session4, {
      suppressFingerprints: suppressSet,
    });

    // 100% > 60% floor → suppression disabled entirely
    expect(result4.nodeCount).toBe(4);
    expect(result4.elementsSuppressed).toBe(0);
  });
});
