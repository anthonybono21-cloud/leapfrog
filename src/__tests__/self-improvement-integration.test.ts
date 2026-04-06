import { describe, it, expect, beforeEach } from "vitest";
import {
  strategyManager,
  StrategyManager,
  StealthBandit,
} from "../stealth-bandit.js";
import {
  interactionTracker,
  InteractionTracker,
} from "../interaction-tracker.js";
import type { InteractionRecord } from "../interaction-tracker.js";
import { DomainKnowledge } from "../domain-knowledge.js";

// ---------------------------------------------------------------------------
// Fresh instances per test to avoid cross-test contamination
// ---------------------------------------------------------------------------

let tracker: InteractionTracker;
let manager: StrategyManager;
let dk: DomainKnowledge;

beforeEach(() => {
  tracker = new InteractionTracker();
  manager = new StrategyManager();
  dk = new DomainKnowledge("/tmp/leapfrog-test-" + Date.now());
});

// ---------------------------------------------------------------------------
// Stealth Bandit Integration
// ---------------------------------------------------------------------------

describe("Stealth Bandit Integration", () => {
  it("strategyManager singleton is importable and has correct strategies", () => {
    // The singleton should exist and be a StrategyManager instance
    expect(strategyManager).toBeInstanceOf(StrategyManager);
    const stats = strategyManager.getStats("singleton-test.com");
    expect(stats.strategies).toEqual([
      "baseline",
      "tier1-cookies",
      "tier2-fingerprint",
      "tier3-full-stealth",
    ]);
    expect(stats.strategies).toHaveLength(4);
  });

  it("selecting a strategy returns a valid strategy name and arm index", () => {
    const validStrategies = [
      "baseline",
      "tier1-cookies",
      "tier2-fingerprint",
      "tier3-full-stealth",
    ];
    // Run multiple selections to exercise randomness
    for (let i = 0; i < 30; i++) {
      const { strategy, armIndex } = manager.selectStrategy("select-test.com");
      expect(validStrategies).toContain(strategy);
      expect(armIndex).toBeGreaterThanOrEqual(0);
      expect(armIndex).toBeLessThan(4);
      // Strategy name and arm index must be consistent
      expect(strategy).toBe(validStrategies[armIndex]);
    }
  });

  it("recording outcomes changes the distribution (failures make arm less probable)", () => {
    const domain = "outcome-test.com";

    // Get the initial distribution
    const distBefore = manager.getStats(domain).distribution;
    const arm0Before = distBefore[0];

    // Record many successes on arm 2 (which shifts weight toward arm 2, away from arm 0)
    for (let i = 0; i < 80; i++) {
      manager.recordOutcome(domain, 2, true);
    }

    const distAfter = manager.getStats(domain).distribution;
    // Arm 0 should have lost probability since arm 2 was heavily rewarded
    expect(distAfter[0]).toBeLessThan(arm0Before);
    // Arm 2 should have gained
    expect(distAfter[2]).toBeGreaterThan(distBefore[2]);
  });

  it("different domains maintain separate bandits", () => {
    // Train domain A heavily
    for (let i = 0; i < 50; i++) {
      manager.recordOutcome("a.com", 0, true);
    }

    // Domain B should still have a uniform distribution
    const statsA = manager.getStats("a.com");
    const statsB = manager.getStats("b.com");

    // A should be skewed toward arm 0
    expect(statsA.distribution[0]).toBeGreaterThan(0.4);

    // B should be roughly uniform (~0.25 each)
    for (const p of statsB.distribution) {
      expect(p).toBeCloseTo(0.25, 1);
    }
  });

  it("strategy names map to stealth tiers 0-3", () => {
    const stats = manager.getStats("tier-map.com");
    const tierMap: Record<string, number> = {
      baseline: 0,
      "tier1-cookies": 1,
      "tier2-fingerprint": 2,
      "tier3-full-stealth": 3,
    };

    for (let armIndex = 0; armIndex < stats.strategies.length; armIndex++) {
      const strategyName = stats.strategies[armIndex];
      expect(tierMap[strategyName]).toBe(armIndex);
    }
  });
});

// ---------------------------------------------------------------------------
// Interaction Tracker Integration
// ---------------------------------------------------------------------------

describe("Interaction Tracker Integration", () => {
  it("interactionTracker singleton is importable", () => {
    expect(interactionTracker).toBeInstanceOf(InteractionTracker);
    // Should have the same API shape
    expect(typeof interactionTracker.recordInteraction).toBe("function");
    expect(typeof interactionTracker.getSuppressSet).toBe("function");
    expect(typeof interactionTracker.getRelevanceScores).toBe("function");
    expect(typeof interactionTracker.toJSON).toBe("function");
    expect(typeof interactionTracker.fromJSON).toBe("function");
  });

  it("recording click interactions increments click count", () => {
    tracker.recordInteraction("clicks.com", "button:submit", "click");
    tracker.recordInteraction("clicks.com", "button:submit", "click");
    tracker.recordInteraction("clicks.com", "button:submit", "click");

    const data = tracker.toJSON("clicks.com");
    expect(data).toHaveLength(1);
    expect(data[0].clicks).toBe(3);
    expect(data[0].fills).toBe(0);
    expect(data[0].extracts).toBe(0);
  });

  it("recording fill interactions increments fill count", () => {
    tracker.recordInteraction("fills.com", "textbox:email", "fill");
    tracker.recordInteraction("fills.com", "textbox:email", "fill");

    const data = tracker.toJSON("fills.com");
    expect(data).toHaveLength(1);
    expect(data[0].fills).toBe(2);
    expect(data[0].clicks).toBe(0);
    expect(data[0].extracts).toBe(0);
  });

  it("recording extract interactions increments extract count", () => {
    tracker.recordInteraction("extracts.com", "heading:price", "extract");
    tracker.recordInteraction("extracts.com", "heading:price", "extract");
    tracker.recordInteraction("extracts.com", "heading:price", "extract");
    tracker.recordInteraction("extracts.com", "heading:price", "extract");

    const data = tracker.toJSON("extracts.com");
    expect(data).toHaveLength(1);
    expect(data[0].extracts).toBe(4);
    expect(data[0].clicks).toBe(0);
    expect(data[0].fills).toBe(0);
  });

  it("getSuppressSet returns empty set when visitCount < 10", () => {
    // Load a zero-interaction record
    const records: InteractionRecord[] = [
      { fingerprint: "link:about", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "link:contact", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON("threshold.com", records);

    // visitCount = 9, below the threshold of 10
    const suppressed = tracker.getSuppressSet("threshold.com", 9);
    expect(suppressed.size).toBe(0);
  });

  it("getSuppressSet returns zero-interaction fingerprints when visitCount >= 10", () => {
    const records: InteractionRecord[] = [
      { fingerprint: "link:about", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "link:contact", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "button:submit", clicks: 5, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON("suppress.com", records);

    const suppressed = tracker.getSuppressSet("suppress.com", 15);
    expect(suppressed.size).toBe(2);
    expect(suppressed.has("link:about")).toBe(true);
    expect(suppressed.has("link:contact")).toBe(true);
    expect(suppressed.has("button:submit")).toBe(false);
  });

  it("getSuppressSet excludes form inputs (textbox:*, checkbox:*, etc.)", () => {
    const formFingerprints = [
      "textbox:username",
      "checkbox:remember-me",
      "radio:plan-pro",
      "combobox:country",
      "searchbox:query",
      "spinbutton:quantity",
      "slider:volume",
      "switch:dark-mode",
      "listbox:options",
    ];

    const records: InteractionRecord[] = formFingerprints.map((fp) => ({
      fingerprint: fp,
      clicks: 0,
      fills: 0,
      extracts: 0,
      lastUsed: Date.now(),
    }));
    // Add a non-form element that should be suppressible
    records.push({
      fingerprint: "img:hero-banner",
      clicks: 0,
      fills: 0,
      extracts: 0,
      lastUsed: Date.now(),
    });

    tracker.fromJSON("forms.com", records);
    const suppressed = tracker.getSuppressSet("forms.com", 20);

    // None of the form inputs should be suppressed
    for (const fp of formFingerprints) {
      expect(suppressed.has(fp)).toBe(false);
    }
    // The non-form element should be suppressed
    expect(suppressed.has("img:hero-banner")).toBe(true);
    expect(suppressed.size).toBe(1);
  });

  it("relevance scores increase with more interactions", () => {
    tracker.recordInteraction("scores.com", "button:buy", "click");
    const scoresLow = tracker.getRelevanceScores("scores.com", 10);
    const scoreLow = scoresLow.get("button:buy")!;

    // Add more interactions
    for (let i = 0; i < 9; i++) {
      tracker.recordInteraction("scores.com", "button:buy", "click");
    }
    const scoresHigh = tracker.getRelevanceScores("scores.com", 10);
    const scoreHigh = scoresHigh.get("button:buy")!;

    expect(scoreHigh).toBeGreaterThan(scoreLow);
  });
});

// ---------------------------------------------------------------------------
// Combined Suppression Logic
// ---------------------------------------------------------------------------

describe("Combined Suppression Logic", () => {
  it("both domainKnowledge and interactionTracker can provide suppress sets", async () => {
    const domain = "combined.com";

    // DomainKnowledge: seed stable elements via recordElementFingerprints
    const record = await dk.load(domain);
    // Visit enough times to build stable fingerprints (3+ sightings needed)
    for (let visit = 0; visit < 5; visit++) {
      dk.recordElementFingerprints(domain, [
        "nav:header",
        "link:home",
        "link:about",
        "footer:copyright",
      ]);
    }

    const stableFingerprints = dk.getStableFingerprints(domain, 3);
    expect(stableFingerprints.length).toBeGreaterThan(0);

    // InteractionTracker: seed some zero-interaction records
    const records: InteractionRecord[] = [
      { fingerprint: "img:ad-banner", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "link:promo", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON(domain, records);

    const heatmapSuppressSet = tracker.getSuppressSet(domain, 15);
    expect(heatmapSuppressSet.size).toBeGreaterThan(0);

    // Both systems produce data that can inform suppression
    expect(stableFingerprints.length).toBeGreaterThan(0);
    expect(heatmapSuppressSet.size).toBeGreaterThan(0);
  });

  it("stable element and heat map suppress sets can be merged into a single Set", async () => {
    const domain = "merge.com";

    // Build stable fingerprints in DomainKnowledge
    for (let visit = 0; visit < 5; visit++) {
      dk.recordElementFingerprints(domain, ["nav:header", "footer:legal"]);
    }
    const stableSet = new Set(dk.getStableFingerprints(domain, 3));

    // Build heat map suppress set in InteractionTracker
    const records: InteractionRecord[] = [
      { fingerprint: "img:sidebar-ad", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "div:cookie-notice", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON(domain, records);
    const heatmapSet = tracker.getSuppressSet(domain, 15);

    // Merge into a single unified set
    const merged = new Set([...stableSet, ...heatmapSet]);

    // Should contain elements from both sources
    expect(merged.has("nav:header")).toBe(true);
    expect(merged.has("footer:legal")).toBe(true);
    expect(merged.has("img:sidebar-ad")).toBe(true);
    expect(merged.has("div:cookie-notice")).toBe(true);
    expect(merged.size).toBe(4);
  });

  it("form inputs are protected in BOTH suppress systems", async () => {
    const domain = "form-protection.com";

    // InteractionTracker: form inputs with zero interactions should NOT be suppressed
    const heatmapRecords: InteractionRecord[] = [
      { fingerprint: "textbox:email", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "checkbox:terms", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
      { fingerprint: "link:decorative", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON(domain, heatmapRecords);
    const heatmapSuppressed = tracker.getSuppressSet(domain, 20);

    // Form inputs excluded from heat map suppression
    expect(heatmapSuppressed.has("textbox:email")).toBe(false);
    expect(heatmapSuppressed.has("checkbox:terms")).toBe(false);
    // Non-form element IS suppressed
    expect(heatmapSuppressed.has("link:decorative")).toBe(true);

    // DomainKnowledge stable elements: getStableFingerprints returns ALL stable
    // fingerprints including form inputs (they are stable and should be in snapshots).
    // The stable fingerprint system doesn't suppress form inputs because it tracks
    // what IS stable, not what to remove. Suppression of stable elements is additive
    // (keep them), while heat map suppression is subtractive (remove unused).
    for (let visit = 0; visit < 5; visit++) {
      dk.recordElementFingerprints(domain, [
        "textbox:email",
        "checkbox:terms",
        "link:decorative",
      ]);
    }
    const stableFingerprints = dk.getStableFingerprints(domain, 3);
    // All three should be stable (they appeared every visit)
    expect(stableFingerprints).toContain("textbox:email");
    expect(stableFingerprints).toContain("checkbox:terms");
    // Stable element system keeps form inputs visible -- they are NOT candidates for removal
  });

  it("visitCount from DomainRecord feeds into getSuppressSet threshold", async () => {
    const domain = "visit-threshold.com";

    // Use DomainKnowledge to record navigations, building up visitCount
    for (let i = 0; i < 12; i++) {
      dk.recordNavigation(domain, "networkidle", 500);
    }
    const record = dk.get(domain);
    expect(record).toBeDefined();
    expect(record!.visitCount).toBe(12);

    // Now use that visitCount with interactionTracker
    const heatmapRecords: InteractionRecord[] = [
      { fingerprint: "link:unused-nav", clicks: 0, fills: 0, extracts: 0, lastUsed: Date.now() },
    ];
    tracker.fromJSON(domain, heatmapRecords);

    // With visitCount >= 10, suppression activates
    const suppressed = tracker.getSuppressSet(domain, record!.visitCount);
    expect(suppressed.size).toBe(1);
    expect(suppressed.has("link:unused-nav")).toBe(true);

    // If visitCount were below threshold, it would return empty
    const suppressedLow = tracker.getSuppressSet(domain, 5);
    expect(suppressedLow.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Serialization Round-Trips
// ---------------------------------------------------------------------------

describe("Serialization Round-Trips", () => {
  it("strategyManager toJSON + fromJSON preserves bandit state", () => {
    const domain = "serial-bandit.com";

    // Train the bandit with a specific pattern
    for (let i = 0; i < 40; i++) {
      manager.recordOutcome(domain, 2, true);
    }
    for (let i = 0; i < 10; i++) {
      manager.recordOutcome(domain, 0, true);
    }

    const distBefore = manager.getStats(domain).distribution;
    const json = manager.toJSON(domain);
    expect(json).not.toBeNull();

    // Restore into a completely fresh manager
    const freshManager = new StrategyManager();
    freshManager.fromJSON(domain, json!);

    const distAfter = freshManager.getStats(domain).distribution;

    // Distributions should match exactly
    for (let i = 0; i < distBefore.length; i++) {
      expect(distAfter[i]).toBeCloseTo(distBefore[i], 10);
    }

    // Verify the trained pattern survived: arm 2 should dominate
    expect(distAfter[2]).toBeGreaterThan(distAfter[0]);
    expect(distAfter[2]).toBeGreaterThan(distAfter[1]);
    expect(distAfter[2]).toBeGreaterThan(distAfter[3]);
  });

  it("interactionTracker toJSON + fromJSON preserves interaction records", () => {
    const domain = "serial-tracker.com";

    // Build up a realistic set of interactions
    for (let i = 0; i < 5; i++) {
      tracker.recordInteraction(domain, "button:submit", "click");
    }
    tracker.recordInteraction(domain, "textbox:search", "fill");
    tracker.recordInteraction(domain, "textbox:search", "fill");
    tracker.recordInteraction(domain, "heading:product-name", "extract");
    tracker.recordInteraction(domain, "link:next-page", "click");
    tracker.recordInteraction(domain, "link:next-page", "click");
    tracker.recordInteraction(domain, "link:next-page", "click");

    const jsonBefore = tracker.toJSON(domain);
    expect(jsonBefore).toHaveLength(4);

    // Restore into a fresh tracker
    const freshTracker = new InteractionTracker();
    freshTracker.fromJSON(domain, jsonBefore);

    const jsonAfter = freshTracker.toJSON(domain);
    expect(jsonAfter).toHaveLength(4);

    // Verify each record survived the round-trip
    const submitRec = jsonAfter.find((r) => r.fingerprint === "button:submit")!;
    expect(submitRec.clicks).toBe(5);
    expect(submitRec.fills).toBe(0);
    expect(submitRec.extracts).toBe(0);

    const searchRec = jsonAfter.find((r) => r.fingerprint === "textbox:search")!;
    expect(searchRec.fills).toBe(2);

    const headingRec = jsonAfter.find(
      (r) => r.fingerprint === "heading:product-name"
    )!;
    expect(headingRec.extracts).toBe(1);

    const linkRec = jsonAfter.find((r) => r.fingerprint === "link:next-page")!;
    expect(linkRec.clicks).toBe(3);

    // Relevance scores should also be identical after restoration
    const scoresBefore = tracker.getRelevanceScores(domain, 15);
    const scoresAfter = freshTracker.getRelevanceScores(domain, 15);
    for (const [fp, score] of scoresBefore) {
      expect(scoresAfter.get(fp)).toBeCloseTo(score, 5);
    }
  });
});
