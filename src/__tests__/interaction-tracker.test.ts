import { describe, it, expect, beforeEach, vi } from "vitest";
import { InteractionTracker } from "../interaction-tracker.js";
import type { InteractionRecord } from "../interaction-tracker.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeTracker(): InteractionTracker {
  return new InteractionTracker();
}

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

// ─── Tests ────────────────────────────────────────────────────────────────

describe("InteractionTracker", () => {
  let tracker: InteractionTracker;

  beforeEach(() => {
    tracker = makeTracker();
    vi.restoreAllMocks();
  });

  // ── Recording ─────────────────────────────────────────────────────────

  it("records click interactions correctly", () => {
    tracker.recordInteraction("example.com", "button:submit", "click");
    const data = tracker.toJSON("example.com");
    expect(data).toHaveLength(1);
    expect(data[0].fingerprint).toBe("button:submit");
    expect(data[0].clicks).toBe(1);
    expect(data[0].fills).toBe(0);
    expect(data[0].extracts).toBe(0);
  });

  it("records fill interactions correctly", () => {
    tracker.recordInteraction("example.com", "textbox:email", "fill");
    const data = tracker.toJSON("example.com");
    expect(data).toHaveLength(1);
    expect(data[0].fills).toBe(1);
    expect(data[0].clicks).toBe(0);
    expect(data[0].extracts).toBe(0);
  });

  it("records extract interactions correctly", () => {
    tracker.recordInteraction("example.com", "heading:title", "extract");
    const data = tracker.toJSON("example.com");
    expect(data).toHaveLength(1);
    expect(data[0].extracts).toBe(1);
    expect(data[0].clicks).toBe(0);
    expect(data[0].fills).toBe(0);
  });

  it("increments existing records instead of creating duplicates", () => {
    tracker.recordInteraction("example.com", "button:submit", "click");
    tracker.recordInteraction("example.com", "button:submit", "click");
    tracker.recordInteraction("example.com", "button:submit", "fill");
    const data = tracker.toJSON("example.com");
    expect(data).toHaveLength(1);
    expect(data[0].clicks).toBe(2);
    expect(data[0].fills).toBe(1);
    expect(data[0].extracts).toBe(0);
  });

  it("updates lastUsed timestamp on each interaction", () => {
    const before = Date.now();
    tracker.recordInteraction("example.com", "button:submit", "click");
    const data = tracker.toJSON("example.com");
    expect(data[0].lastUsed).toBeGreaterThanOrEqual(before);
    expect(data[0].lastUsed).toBeLessThanOrEqual(Date.now());
  });

  // ── LRU Cap ───────────────────────────────────────────────────────────

  it("enforces LRU cap at 200 records per domain", () => {
    // Fill to 201 records — oldest should be evicted
    for (let i = 0; i < 201; i++) {
      tracker.recordInteraction("example.com", `link:item-${i}`, "click");
    }
    const data = tracker.toJSON("example.com");
    expect(data).toHaveLength(200);
    // The most recent (item-200) should be present
    expect(data.some((r) => r.fingerprint === "link:item-200")).toBe(true);
  });

  // ── Domain Independence ───────────────────────────────────────────────

  it("tracks different domains independently", () => {
    tracker.recordInteraction("github.com", "link:repo", "click");
    tracker.recordInteraction("gitlab.com", "link:project", "click");

    expect(tracker.toJSON("github.com")).toHaveLength(1);
    expect(tracker.toJSON("gitlab.com")).toHaveLength(1);
    expect(tracker.toJSON("github.com")[0].fingerprint).toBe("link:repo");
    expect(tracker.toJSON("gitlab.com")[0].fingerprint).toBe("link:project");
  });

  // ── Domain Normalization ──────────────────────────────────────────────

  it("normalizes domains by stripping www. and lowercasing", () => {
    tracker.recordInteraction("www.Example.COM", "button:ok", "click");
    tracker.recordInteraction("example.com", "button:ok", "click");
    const data = tracker.toJSON("example.com");
    expect(data).toHaveLength(1);
    expect(data[0].clicks).toBe(2);
  });

  it("normalizes domains on read operations too", () => {
    tracker.recordInteraction("example.com", "button:ok", "click");
    const data = tracker.toJSON("WWW.Example.Com");
    expect(data).toHaveLength(1);
  });

  // ── Relevance Scores ──────────────────────────────────────────────────

  it("returns empty map when visitCount < 10", () => {
    tracker.recordInteraction("example.com", "button:submit", "click");
    const scores = tracker.getRelevanceScores("example.com", 9);
    expect(scores.size).toBe(0);
  });

  it("returns empty map for unknown domain", () => {
    const scores = tracker.getRelevanceScores("unknown.com", 15);
    expect(scores.size).toBe(0);
  });

  it("returns 0.0 scores for elements with zero interactions", () => {
    // Manually load a zero-interaction record via fromJSON
    const records: InteractionRecord[] = [
      { fingerprint: "link:pricing", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON("example.com", records);
    const scores = tracker.getRelevanceScores("example.com", 10);
    expect(scores.get("link:pricing")).toBe(0.0);
  });

  it("returns higher scores for frequently-used elements", () => {
    for (let i = 0; i < 20; i++) {
      tracker.recordInteraction("example.com", "button:submit", "click");
    }
    tracker.recordInteraction("example.com", "link:about", "click");

    const scores = tracker.getRelevanceScores("example.com", 20);
    const submitScore = scores.get("button:submit")!;
    const aboutScore = scores.get("link:about")!;
    expect(submitScore).toBeGreaterThan(aboutScore);
  });

  it("caps relevance score at 1.0", () => {
    for (let i = 0; i < 100; i++) {
      tracker.recordInteraction("example.com", "button:submit", "click");
    }
    const scores = tracker.getRelevanceScores("example.com", 10);
    expect(scores.get("button:submit")).toBe(1.0);
  });

  it("applies recency boost of 1.0 for elements used within 7 days", () => {
    tracker.recordInteraction("example.com", "button:submit", "click");
    // Just recorded — within 7 days
    const scores = tracker.getRelevanceScores("example.com", 10);
    // score = (1 / 10) * 1.0 = 0.1
    expect(scores.get("button:submit")).toBeCloseTo(0.1, 5);
  });

  it("applies recency boost of 0.7 for elements used 7-30 days ago", () => {
    const eightDaysAgo = Date.now() - SEVEN_DAYS - 24 * 60 * 60 * 1000;
    const records: InteractionRecord[] = [
      { fingerprint: "button:submit", clicks: 1, fills: 0, extracts: 0, lastUsed: eightDaysAgo },
    ];
    tracker.fromJSON("example.com", records);
    const scores = tracker.getRelevanceScores("example.com", 10);
    // score = (1 / 10) * 0.7 = 0.07
    expect(scores.get("button:submit")).toBeCloseTo(0.07, 5);
  });

  it("applies recency boost of 0.4 for elements older than 30 days", () => {
    const fortyDaysAgo = Date.now() - THIRTY_DAYS - 10 * 24 * 60 * 60 * 1000;
    const records: InteractionRecord[] = [
      { fingerprint: "button:submit", clicks: 1, fills: 0, extracts: 0, lastUsed: fortyDaysAgo },
    ];
    tracker.fromJSON("example.com", records);
    const scores = tracker.getRelevanceScores("example.com", 10);
    // score = (1 / 10) * 0.4 = 0.04
    expect(scores.get("button:submit")).toBeCloseTo(0.04, 5);
  });

  // ── Suppress Set ──────────────────────────────────────────────────────

  it("returns only zero-interaction fingerprints in suppress set", () => {
    const records: InteractionRecord[] = [
      { fingerprint: "link:pricing", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "link:enterprise", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "button:submit", clicks: 5, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON("example.com", records);
    const suppressed = tracker.getSuppressSet("example.com", 15);
    expect(suppressed.size).toBe(2);
    expect(suppressed.has("link:pricing")).toBe(true);
    expect(suppressed.has("link:enterprise")).toBe(true);
    expect(suppressed.has("button:submit")).toBe(false);
  });

  it("returns empty set when visitCount < 10", () => {
    const records: InteractionRecord[] = [
      { fingerprint: "link:pricing", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON("example.com", records);
    const suppressed = tracker.getSuppressSet("example.com", 9);
    expect(suppressed.size).toBe(0);
  });

  it("excludes form input roles from suppress set", () => {
    const formRoles = [
      "textbox", "checkbox", "radio", "combobox",
      "searchbox", "spinbutton", "slider", "switch", "listbox",
    ];
    const records: InteractionRecord[] = formRoles.map((role) => ({
      fingerprint: `${role}:some-field`,
      clicks: 0,
      fills: 0,
      extracts: 0,
      lastUsed: Date.now(),
    }));
    // Add one non-form element too
    records.push({
      fingerprint: "link:never-clicked",
      clicks: 0,
      fills: 0,
      extracts: 0,
      lastUsed: Date.now(),
    });
    tracker.fromJSON("example.com", records);
    const suppressed = tracker.getSuppressSet("example.com", 15);
    // Only the link should be in the suppress set
    expect(suppressed.size).toBe(1);
    expect(suppressed.has("link:never-clicked")).toBe(true);
    for (const role of formRoles) {
      expect(suppressed.has(`${role}:some-field`)).toBe(false);
    }
  });

  // ── Single Interaction ────────────────────────────────────────────────

  it("a single interaction makes an element non-suppressible", () => {
    const records: InteractionRecord[] = [
      { fingerprint: "link:pricing", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON("example.com", records);
    // Before any interaction — it's suppressible
    expect(tracker.getSuppressSet("example.com", 15).has("link:pricing")).toBe(true);
    // One click — no longer suppressible
    tracker.recordInteraction("example.com", "link:pricing", "click");
    expect(tracker.getSuppressSet("example.com", 15).has("link:pricing")).toBe(false);
  });

  // ── Serialization ─────────────────────────────────────────────────────

  it("serialization round-trip preserves state", () => {
    tracker.recordInteraction("example.com", "button:submit", "click");
    tracker.recordInteraction("example.com", "button:submit", "click");
    tracker.recordInteraction("example.com", "textbox:search", "fill");
    tracker.recordInteraction("example.com", "heading:title", "extract");

    const json = tracker.toJSON("example.com");

    // Restore into a fresh tracker
    const tracker2 = makeTracker();
    tracker2.fromJSON("example.com", json);

    const restored = tracker2.toJSON("example.com");
    expect(restored).toHaveLength(3);
    const submitRec = restored.find((r) => r.fingerprint === "button:submit")!;
    expect(submitRec.clicks).toBe(2);
    expect(submitRec.fills).toBe(0);
    const searchRec = restored.find((r) => r.fingerprint === "textbox:search")!;
    expect(searchRec.fills).toBe(1);
    const titleRec = restored.find((r) => r.fingerprint === "heading:title")!;
    expect(titleRec.extracts).toBe(1);
  });

  it("toJSON returns empty array for unknown domain", () => {
    expect(tracker.toJSON("nonexistent.com")).toEqual([]);
  });

  // ── Empty Tracker ─────────────────────────────────────────────────────

  it("empty tracker returns empty relevance scores", () => {
    const scores = tracker.getRelevanceScores("example.com", 15);
    expect(scores.size).toBe(0);
  });

  it("empty tracker returns empty suppress set", () => {
    const suppressed = tracker.getSuppressSet("example.com", 15);
    expect(suppressed.size).toBe(0);
  });
});
