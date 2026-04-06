import { describe, it, expect, beforeEach } from "vitest";
import { StealthBandit, StrategyManager } from "../stealth-bandit.js";

// ---------------------------------------------------------------------------
// StealthBandit (EXP3 core)
// ---------------------------------------------------------------------------

describe("StealthBandit", () => {
  it("initializes with uniform weights", () => {
    const bandit = new StealthBandit(4);
    const dist = bandit.getDistribution();
    expect(dist).toHaveLength(4);
    // Uniform: all probabilities should be equal
    for (const p of dist) {
      expect(p).toBeCloseTo(dist[0], 10);
    }
  });

  it("distribution sums to ~1.0", () => {
    const bandit = new StealthBandit(4);
    const sum = bandit.getDistribution().reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("distribution sums to ~1.0 after updates", () => {
    const bandit = new StealthBandit(4);
    bandit.update(0, 1);
    bandit.update(2, 1);
    bandit.update(1, 0);
    const sum = bandit.getDistribution().reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("selectArm returns a valid index", () => {
    const bandit = new StealthBandit(4);
    for (let i = 0; i < 100; i++) {
      const arm = bandit.selectArm();
      expect(arm).toBeGreaterThanOrEqual(0);
      expect(arm).toBeLessThan(4);
    }
  });

  it("update shifts distribution toward rewarded arm", () => {
    const bandit = new StealthBandit(4);
    // Heavily reward arm 2
    for (let i = 0; i < 50; i++) {
      bandit.update(2, 1);
    }
    const dist = bandit.getDistribution();
    // Arm 2 should have the highest probability
    for (let i = 0; i < 4; i++) {
      if (i !== 2) expect(dist[2]).toBeGreaterThan(dist[i]);
    }
  });

  it("unrewarded arms lose probability mass", () => {
    const bandit = new StealthBandit(4);
    const distBefore = bandit.getDistribution();
    // Reward only arm 0 many times
    for (let i = 0; i < 30; i++) {
      bandit.update(0, 1);
    }
    const distAfter = bandit.getDistribution();
    // Arm 0 should have gained; arms 1-3 should have lost
    expect(distAfter[0]).toBeGreaterThan(distBefore[0]);
    expect(distAfter[1]).toBeLessThan(distBefore[1]);
  });

  it("weight explosion prevention normalizes extreme weights", () => {
    const bandit = new StealthBandit(4);
    // Push weights to astronomical levels
    for (let i = 0; i < 1000; i++) {
      bandit.update(0, 1);
    }
    const dist = bandit.getDistribution();
    // Should still be a valid distribution
    const sum = dist.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
    for (const p of dist) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("serialization round-trip preserves state", () => {
    const bandit = new StealthBandit(4, 0.3);
    bandit.update(1, 1);
    bandit.update(3, 1);
    const json = bandit.toJSON();
    const restored = StealthBandit.fromJSON(json);
    expect(restored.getDistribution()).toEqual(bandit.getDistribution());
    expect(restored.toJSON().gamma).toBe(0.3);
  });

  it("toJSON contains correct fields", () => {
    const bandit = new StealthBandit(3, 0.5);
    const json = bandit.toJSON();
    expect(json).toHaveProperty("weights");
    expect(json).toHaveProperty("gamma", 0.5);
    expect(json).toHaveProperty("numArms", 3);
    expect(json.weights).toHaveLength(3);
  });

  it("works with a single arm", () => {
    const bandit = new StealthBandit(1);
    const dist = bandit.getDistribution();
    expect(dist).toHaveLength(1);
    expect(dist[0]).toBeCloseTo(1.0, 10);
    expect(bandit.selectArm()).toBe(0);
    // Update should not crash
    bandit.update(0, 1);
    bandit.update(0, 0);
    expect(bandit.getDistribution()[0]).toBeCloseTo(1.0, 10);
  });

  it("all same rewards keeps distribution roughly uniform", () => {
    const bandit = new StealthBandit(4);
    // Give all arms the same reward
    for (let i = 0; i < 20; i++) {
      for (let arm = 0; arm < 4; arm++) {
        bandit.update(arm, 1);
      }
    }
    const dist = bandit.getDistribution();
    // No arm should dominate — all should be within 10% of 0.25
    for (const p of dist) {
      expect(p).toBeGreaterThan(0.15);
      expect(p).toBeLessThan(0.35);
    }
  });

  it("zero gamma freezes learning (pure exploitation of initial weights)", () => {
    const bandit = new StealthBandit(4, 0);
    // With gamma=0, the EXP3 update multiplier is exp(0*...)=1 — no learning.
    // Distribution is purely proportional to weights, which start uniform.
    bandit.update(0, 1);
    const dist = bandit.getDistribution();
    const sum = dist.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
    // All arms stay equal because gamma=0 prevents weight updates
    for (const p of dist) {
      expect(p).toBeCloseTo(0.25, 10);
    }
  });

  it("very small gamma still allows slow learning", () => {
    const bandit = new StealthBandit(4, 0.01);
    for (let i = 0; i < 200; i++) {
      bandit.update(0, 1);
    }
    const dist = bandit.getDistribution();
    // Arm 0 should have gained at least some probability
    expect(dist[0]).toBeGreaterThan(dist[1]);
  });

  it("after failure on dominant arm, distribution shifts away", () => {
    const bandit = new StealthBandit(4);
    // Build up arm 0 as dominant
    for (let i = 0; i < 30; i++) {
      bandit.update(0, 1);
    }
    const distBefore = bandit.getDistribution();
    // Now reward a different arm heavily
    for (let i = 0; i < 50; i++) {
      bandit.update(2, 1);
    }
    const distAfter = bandit.getDistribution();
    // Arm 2 should have gained relative to arm 0's dominance
    expect(distAfter[2]).toBeGreaterThan(distBefore[2]);
  });

  it("default gamma uses the practical EXP3 formula", () => {
    const K = 4;
    const expectedGamma = Math.min(0.5, Math.max(0.01, Math.sqrt(
      K * Math.log(K) / ((Math.E - 1) * 100),
    )));
    const bandit = new StealthBandit(K);
    expect(bandit.toJSON().gamma).toBeCloseTo(expectedGamma, 10);
    // Should be between the clamp bounds
    expect(bandit.toJSON().gamma).toBeGreaterThanOrEqual(0.01);
    expect(bandit.toJSON().gamma).toBeLessThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------
// StrategyManager (per-domain bandit management)
// ---------------------------------------------------------------------------

describe("StrategyManager", () => {
  let manager: StrategyManager;

  beforeEach(() => {
    manager = new StrategyManager();
  });

  it("creates bandits per domain on first select", () => {
    const result = manager.selectStrategy("example.com");
    expect(result).toHaveProperty("strategy");
    expect(result).toHaveProperty("armIndex");
    expect(typeof result.strategy).toBe("string");
    expect(typeof result.armIndex).toBe("number");
  });

  it("normalizes domains: strips www. and lowercases", () => {
    manager.selectStrategy("WWW.Example.Com");
    const stats = manager.getStats("example.com");
    expect(stats.distribution).toHaveLength(4);

    // www.EXAMPLE.com should hit the same bandit
    const json = manager.toJSON("www.example.com");
    expect(json).not.toBeNull();
  });

  it("different domains have independent bandits", () => {
    manager.selectStrategy("alpha.com");
    // Reward arm 0 heavily on alpha
    for (let i = 0; i < 30; i++) {
      manager.recordOutcome("alpha.com", 0, true);
    }
    // beta.com should still be uniform
    const betaStats = manager.getStats("beta.com");
    const dist = betaStats.distribution;
    // All arms roughly equal for a fresh bandit
    for (const p of dist) {
      expect(p).toBeCloseTo(0.25, 1);
    }
  });

  it("recordOutcome shifts strategy selection over time", () => {
    const domain = "shop.example.com";
    // Always succeed on arm 3
    for (let i = 0; i < 50; i++) {
      manager.recordOutcome(domain, 3, true);
    }
    const stats = manager.getStats(domain);
    // Arm 3 (tier3-full-stealth) should dominate
    expect(stats.distribution[3]).toBeGreaterThan(stats.distribution[0]);
    expect(stats.distribution[3]).toBeGreaterThan(stats.distribution[1]);
    expect(stats.distribution[3]).toBeGreaterThan(stats.distribution[2]);
  });

  it("selectStrategy returns valid strategy names", () => {
    const validStrategies = [
      "baseline",
      "tier1-cookies",
      "tier2-fingerprint",
      "tier3-full-stealth",
    ];
    for (let i = 0; i < 50; i++) {
      const { strategy, armIndex } = manager.selectStrategy("test.com");
      expect(validStrategies).toContain(strategy);
      expect(armIndex).toBeGreaterThanOrEqual(0);
      expect(armIndex).toBeLessThan(4);
    }
  });

  it("getStats returns valid data", () => {
    const stats = manager.getStats("new-domain.com");
    expect(stats.distribution).toHaveLength(4);
    expect(stats.strategies).toHaveLength(4);
    const sum = stats.distribution.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 10);
    expect(stats.strategies[0]).toBe("baseline");
    expect(stats.strategies[3]).toBe("tier3-full-stealth");
  });

  it("toJSON returns null for unknown domain", () => {
    expect(manager.toJSON("never-seen.com")).toBeNull();
  });

  it("toJSON/fromJSON round-trip preserves domain state", () => {
    const domain = "roundtrip.com";
    // Train the bandit
    for (let i = 0; i < 20; i++) {
      manager.recordOutcome(domain, 1, true);
    }
    const json = manager.toJSON(domain);
    expect(json).not.toBeNull();

    // Restore into a fresh manager
    const freshManager = new StrategyManager();
    freshManager.fromJSON(domain, json!);
    const originalStats = manager.getStats(domain);
    const restoredStats = freshManager.getStats(domain);
    expect(restoredStats.distribution).toEqual(originalStats.distribution);
  });

  it("accepts custom strategy lists", () => {
    const custom = new StrategyManager(["fast", "slow", "stealth"]);
    const { strategy } = custom.selectStrategy("custom.com");
    expect(["fast", "slow", "stealth"]).toContain(strategy);
    expect(custom.getStats("custom.com").strategies).toHaveLength(3);
  });

  it("arm index maps to correct stealth tier", () => {
    // Arm 0 = tier 0 (baseline), arm 3 = tier 3 (full stealth)
    const stats = manager.getStats("tier-test.com");
    expect(stats.strategies[0]).toBe("baseline");
    expect(stats.strategies[1]).toBe("tier1-cookies");
    expect(stats.strategies[2]).toBe("tier2-fingerprint");
    expect(stats.strategies[3]).toBe("tier3-full-stealth");
  });
});
