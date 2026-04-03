import { describe, it, expect, beforeEach } from "vitest";
import { SnapshotDiffer } from "../snapshot-differ.js";
import type { SnapshotResult } from "../types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSnapshot(text: string, nodeCount?: number): SnapshotResult {
  return {
    text,
    refs: new Map(),
    nodeCount: nodeCount ?? text.split("\n").filter((l) => l.includes("@e")).length,
  };
}

const PAGE_A = `@e1 navigation "Main Nav"
  @e2 link "Home"
  @e3 link "Products"
@e4 main
  @e5 heading "Welcome"
  @e6 button "Get Started"`;

const PAGE_B_ADDED = `@e1 navigation "Main Nav"
  @e2 link "Home"
  @e3 link "Products"
@e4 main
  @e5 heading "Welcome"
  @e6 button "Get Started"
  @e7 button "Confirm Order"`;

const PAGE_C_REMOVED = `@e1 navigation "Main Nav"
  @e2 link "Home"
@e4 main
  @e5 heading "Welcome"
  @e6 button "Get Started"`;

const PAGE_D_CHANGED = `@e1 navigation "Main Nav"
  @e2 link "Home"
  @e3 link "Products"
@e4 main
  @e5 heading "New Title"
  @e6 button "Get Started"`;

const PAGE_E_MULTI = `@e1 navigation "Main Nav"
  @e2 link "Home"
@e4 main
  @e5 heading "New Title"
  @e6 button "Get Started"
  @e8 button "Submit"`;

// ─── Tests ────────────────────────────────────────────────────────────────

describe("SnapshotDiffer", () => {
  beforeEach(() => {
    SnapshotDiffer.clearAll();
  });

  // 1. First snapshot returns isFirst=true, no diff
  it("returns isFirst=true on the first snapshot for a session+url", () => {
    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    expect(result.isFirst).toBe(true);
    expect(result.changeCount).toBe(0);
    expect(result.diffText).toBe("");
  });

  // 2. Identical consecutive snapshots return 0 changes
  it("returns 0 changes for identical consecutive snapshots", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));

    expect(result.isFirst).toBe(false);
    expect(result.changeCount).toBe(0);
    expect(result.diffText).toContain("0 changes");
  });

  // 3. Added element detected correctly
  it("detects added elements", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_B_ADDED));

    expect(result.isFirst).toBe(false);
    expect(result.changeCount).toBe(1);
    expect(result.diffText).toContain("+ @e7");
    expect(result.diffText).toContain("(new)");
    expect(result.diffText).toContain("Confirm Order");
  });

  // 4. Removed element detected correctly
  it("detects removed elements", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_C_REMOVED));

    expect(result.isFirst).toBe(false);
    expect(result.changeCount).toBe(1);
    expect(result.diffText).toContain("- @e3");
    expect(result.diffText).toContain("(removed)");
    expect(result.diffText).toContain("Products");
  });

  // 5. Changed element text detected
  it("detects changed element text", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_D_CHANGED));

    expect(result.isFirst).toBe(false);
    expect(result.changeCount).toBe(1);
    expect(result.diffText).toContain("~ @e5");
    expect(result.diffText).toContain("Welcome");
    expect(result.diffText).toContain("New Title");
    expect(result.diffText).toContain("(changed)");
  });

  // 6. Multiple simultaneous changes
  it("detects multiple simultaneous changes", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_E_MULTI));

    expect(result.isFirst).toBe(false);
    // @e3 removed, @e5 changed, @e8 added = 3 changes
    expect(result.changeCount).toBe(3);
    expect(result.diffText).toContain("3 changes");
    expect(result.diffText).toContain("+ @e8");
    expect(result.diffText).toContain("~ @e5");
    expect(result.diffText).toContain("- @e3");
  });

  // 7. Cache cleared on clearSession()
  it("clears cache for a session, next snapshot is isFirst again", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    expect(SnapshotDiffer.stats().size).toBe(1);

    SnapshotDiffer.clearSession("s1");
    expect(SnapshotDiffer.stats().size).toBe(0);

    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    expect(result.isFirst).toBe(true);
  });

  // 8. Cache LRU eviction at 100 entries
  it("evicts LRU entry when cache exceeds 100", () => {
    // Fill cache to exactly 100
    for (let i = 0; i < 100; i++) {
      SnapshotDiffer.diff("s1", `https://example.com/page${i}`, makeSnapshot(PAGE_A));
    }
    expect(SnapshotDiffer.stats().size).toBe(100);

    // Add one more — should evict the oldest (page0) and stay at 100
    SnapshotDiffer.diff("s1", "https://example.com/page100", makeSnapshot(PAGE_A));
    expect(SnapshotDiffer.stats().size).toBe(100);

    // page0 was evicted, so next diff for it should be isFirst
    const result = SnapshotDiffer.diff("s1", "https://example.com/page0", makeSnapshot(PAGE_A));
    expect(result.isFirst).toBe(true);
    // That insert evicted page1, so cache is still at 100

    // page99 should still be in cache (it was more recent than page1)
    const result2 = SnapshotDiffer.diff("s1", "https://example.com/page99", makeSnapshot(PAGE_A));
    expect(result2.isFirst).toBe(false);
  });

  // 9. Different sessions don't interfere with each other
  it("isolates different sessions from each other", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    SnapshotDiffer.diff("s2", "https://example.com", makeSnapshot(PAGE_A));

    // Change in s1 should not affect s2
    const r1 = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_B_ADDED));
    const r2 = SnapshotDiffer.diff("s2", "https://example.com", makeSnapshot(PAGE_A));

    expect(r1.changeCount).toBe(1); // s1 sees the addition
    expect(r2.changeCount).toBe(0); // s2 sees no change

    // Clearing s1 should not affect s2
    SnapshotDiffer.clearSession("s1");
    expect(SnapshotDiffer.stats().size).toBe(1); // only s2 remains
  });

  // 10. URL change clears page-specific cache (different URL = fresh start)
  it("treats different URLs as separate cache entries", () => {
    SnapshotDiffer.diff("s1", "https://example.com/page1", makeSnapshot(PAGE_A));
    const result = SnapshotDiffer.diff("s1", "https://example.com/page2", makeSnapshot(PAGE_A));

    // Different URL = first snapshot for that URL
    expect(result.isFirst).toBe(true);
    expect(SnapshotDiffer.stats().size).toBe(2);
  });

  // Token estimates
  it("provides reasonable token estimates", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_B_ADDED));

    expect(result.fullTokenEstimate).toBeGreaterThan(0);
    expect(result.diffTokenEstimate).toBeGreaterThan(0);
    expect(result.diffTokenEstimate).toBeLessThan(result.fullTokenEstimate);
  });

  // clearAll
  it("clearAll empties the entire cache", () => {
    SnapshotDiffer.diff("s1", "https://a.com", makeSnapshot(PAGE_A));
    SnapshotDiffer.diff("s2", "https://b.com", makeSnapshot(PAGE_A));
    expect(SnapshotDiffer.stats().size).toBe(2);

    SnapshotDiffer.clearAll();
    expect(SnapshotDiffer.stats().size).toBe(0);
  });

  // Singular "change" grammar
  it("uses singular 'change' for exactly 1 change", () => {
    SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_A));
    const result = SnapshotDiffer.diff("s1", "https://example.com", makeSnapshot(PAGE_B_ADDED));

    expect(result.diffText).toContain("1 change since");
    expect(result.diffText).not.toContain("1 changes");
  });
});
