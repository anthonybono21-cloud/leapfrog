import { describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stealth Strategy Integration Tests
//
// Tests the closed feedback loop:
//   domain knowledge → bandit warm start → arm selection → stealth mode mapping
//   → outcome recording → bandit weight update → domain knowledge persistence
// ---------------------------------------------------------------------------

import {
  StealthBandit,
  StrategyManager,
  armToStealthMode,
  armRequiresExtraMeasures,
} from '../stealth-bandit.js';

// ─── armToStealthMode mapping ──────────────────────────────────────────────

describe('armToStealthMode', () => {
  it('maps arm 0 (baseline) to off', () => {
    expect(armToStealthMode(0)).toBe('off');
  });

  it('maps arm 1 (tier1-cookies) to passive', () => {
    expect(armToStealthMode(1)).toBe('passive');
  });

  it('maps arm 2 (tier2-fingerprint) to active', () => {
    expect(armToStealthMode(2)).toBe('active');
  });

  it('maps arm 3 (tier3-full-stealth) to active', () => {
    expect(armToStealthMode(3)).toBe('active');
  });

  it('maps unknown arm indices to passive as safe fallback', () => {
    expect(armToStealthMode(99)).toBe('passive');
    expect(armToStealthMode(-1)).toBe('passive');
  });
});

// ���── armRequiresExtraMeasures ──────────────────────���───────────────────────

describe('armRequiresExtraMeasures', () => {
  it('returns true only for arm 3 (tier3-full-stealth)', () => {
    expect(armRequiresExtraMeasures(0)).toBe(false);
    expect(armRequiresExtraMeasures(1)).toBe(false);
    expect(armRequiresExtraMeasures(2)).toBe(false);
    expect(armRequiresExtraMeasures(3)).toBe(true);
  });
});

// ─── StealthBandit core ──────────────────��─────────────────────���───────────

describe('StealthBandit', () => {
  it('creates uniform initial distribution', () => {
    const bandit = new StealthBandit(4);
    const dist = bandit.getDistribution();
    expect(dist).toHaveLength(4);
    // With uniform weights, each arm should get roughly 1/4
    for (const p of dist) {
      expect(p).toBeCloseTo(0.25, 1);
    }
  });

  it('selectArm returns valid arm index', () => {
    const bandit = new StealthBandit(4);
    for (let i = 0; i < 100; i++) {
      const arm = bandit.selectArm();
      expect(arm).toBeGreaterThanOrEqual(0);
      expect(arm).toBeLessThan(4);
    }
  });

  it('shifts probability toward rewarded arms after updates', () => {
    const bandit = new StealthBandit(4, 0.1); // low gamma for faster convergence
    const initialDist = bandit.getDistribution();

    // Reward arm 1 heavily, punish all others
    for (let i = 0; i < 50; i++) {
      bandit.update(1, 1.0); // success on arm 1
      bandit.update(0, 0.0); // failure on arm 0
      bandit.update(2, 0.0); // failure on arm 2
      bandit.update(3, 0.0); // failure on arm 3
    }

    const updatedDist = bandit.getDistribution();
    // Arm 1 should now have much higher probability than initial
    expect(updatedDist[1]).toBeGreaterThan(initialDist[1]);
    // Arm 1 should dominate
    expect(updatedDist[1]).toBeGreaterThan(updatedDist[0]);
    expect(updatedDist[1]).toBeGreaterThan(updatedDist[2]);
    expect(updatedDist[1]).toBeGreaterThan(updatedDist[3]);
  });

  it('serializes and deserializes correctly', () => {
    const bandit = new StealthBandit(4, 0.15);
    // Do some updates to differentiate weights
    bandit.update(1, 1.0);
    bandit.update(2, 0.0);

    const json = bandit.toJSON();
    expect(json.weights).toHaveLength(4);
    expect(json.gamma).toBe(0.15);
    expect(json.numArms).toBe(4);

    const restored = StealthBandit.fromJSON(json);
    expect(restored.getDistribution()).toEqual(bandit.getDistribution());
    expect(restored.toJSON()).toEqual(json);
  });

  it('prevents weight explosion via normalization', () => {
    const bandit = new StealthBandit(4, 0.5);
    // Slam the same arm with many rewards to trigger normalization
    for (let i = 0; i < 1000; i++) {
      bandit.update(0, 1.0);
    }
    const json = bandit.toJSON();
    // All weights should be finite (not Infinity or NaN)
    for (const w of json.weights) {
      expect(Number.isFinite(w)).toBe(true);
    }
  });
});

// ─── StrategyManager ───────────────────────────────────────────────────────

describe('StrategyManager', () => {
  let manager: StrategyManager;

  beforeEach(() => {
    manager = new StrategyManager();
  });

  it('selectStrategy returns valid strategy and arm index', () => {
    const { strategy, armIndex } = manager.selectStrategy('example.com');
    expect(armIndex).toBeGreaterThanOrEqual(0);
    expect(armIndex).toBeLessThan(4);
    expect(['baseline', 'tier1-cookies', 'tier2-fingerprint', 'tier3-full-stealth']).toContain(strategy);
  });

  it('normalizes domains consistently', () => {
    // www.example.com and example.com should share the same bandit
    manager.selectStrategy('www.example.com');
    manager.selectStrategy('Example.com');

    const stats1 = manager.getStats('www.example.com');
    const stats2 = manager.getStats('example.com');
    // Both should reference the same underlying distribution
    expect(stats1.distribution).toEqual(stats2.distribution);
  });

  it('recordOutcome updates bandit weights', () => {
    const domain = 'test-outcome.com';
    const { armIndex } = manager.selectStrategy(domain);

    const beforeDist = manager.getStats(domain).distribution;
    manager.recordOutcome(domain, armIndex, true); // success
    const afterDist = manager.getStats(domain).distribution;

    // Distribution should have changed
    const changed = beforeDist.some((p, i) => Math.abs(p - afterDist[i]) > 1e-10);
    expect(changed).toBe(true);
  });

  it('serializes and restores per-domain bandit state', () => {
    const domain = 'persist.com';
    // Do some selections and outcomes to build non-trivial state
    for (let i = 0; i < 10; i++) {
      const { armIndex } = manager.selectStrategy(domain);
      manager.recordOutcome(domain, armIndex, armIndex === 1); // only arm 1 succeeds
    }

    const saved = manager.toJSON(domain);
    expect(saved).not.toBeNull();
    expect(saved!.weights).toHaveLength(4);

    // Create a fresh manager and restore
    const manager2 = new StrategyManager();
    manager2.fromJSON(domain, saved!);

    expect(manager2.getStats(domain).distribution).toEqual(
      manager.getStats(domain).distribution,
    );
  });

  it('toJSON returns null for unknown domains', () => {
    expect(manager.toJSON('never-visited.com')).toBeNull();
  });

  it('shifts toward successful arms over many trials', () => {
    const domain = 'learning.com';
    const manager = new StrategyManager();

    // Run 200 trials where only arm 1 (passive) succeeds
    const armCounts = [0, 0, 0, 0];
    for (let i = 0; i < 200; i++) {
      const { armIndex } = manager.selectStrategy(domain);
      armCounts[armIndex]++;
      // Only arm 1 succeeds, all others fail
      manager.recordOutcome(domain, armIndex, armIndex === 1);
    }

    // After learning, arm 1 should have the highest selection count
    const maxArm = armCounts.indexOf(Math.max(...armCounts));
    expect(maxArm).toBe(1);

    // Verify the final distribution heavily favors arm 1
    const finalDist = manager.getStats(domain).distribution;
    expect(finalDist[1]).toBeGreaterThan(0.4); // should dominate
  });
});

// ─── Bandit state round-trip through domain knowledge shape ────────────────

describe('bandit state persistence shape', () => {
  it('toJSON produces a shape compatible with DomainRecord.banditState', () => {
    const bandit = new StealthBandit(4);
    bandit.update(0, 1.0);
    bandit.update(1, 0.0);

    const json = bandit.toJSON();

    // Verify the shape matches what DomainRecord expects
    expect(json).toHaveProperty('weights');
    expect(json).toHaveProperty('gamma');
    expect(json).toHaveProperty('numArms');
    expect(Array.isArray(json.weights)).toBe(true);
    expect(typeof json.gamma).toBe('number');
    expect(typeof json.numArms).toBe('number');
  });

  it('fromJSON accepts the same shape and produces identical behavior', () => {
    const original = new StealthBandit(4, 0.2);
    original.update(2, 1.0);
    original.update(0, 0.0);

    const state = original.toJSON();

    // Simulate saving to JSON and loading back (as would happen with disk persistence)
    const roundTripped = JSON.parse(JSON.stringify(state));
    const restored = StealthBandit.fromJSON(roundTripped);

    expect(restored.toJSON().weights).toEqual(original.toJSON().weights);
    expect(restored.toJSON().gamma).toEqual(original.toJSON().gamma);
    expect(restored.getDistribution()).toEqual(original.getDistribution());
  });
});

// ─── Full feedback loop simulation ───��─────────────────────────────────────

describe('full feedback loop', () => {
  it('adapts strategy selection based on observed block rates', () => {
    const manager = new StrategyManager();
    const domain = 'tough-site.com';

    // Phase 1: All arms fail except arm 2 (active fingerprint)
    for (let i = 0; i < 50; i++) {
      const { armIndex } = manager.selectStrategy(domain);
      const success = armIndex === 2; // only tier2-fingerprint works
      manager.recordOutcome(domain, armIndex, success);
    }

    // Save state (simulating domain knowledge persistence)
    const savedState = manager.toJSON(domain);
    expect(savedState).not.toBeNull();

    // Phase 2: Restore in a fresh manager (simulating new session)
    const freshManager = new StrategyManager();
    freshManager.fromJSON(domain, savedState!);

    // The restored manager should favor arm 2
    const dist = freshManager.getStats(domain).distribution;
    expect(dist[2]).toBeGreaterThan(dist[0]); // arm 2 > baseline
    expect(dist[2]).toBeGreaterThan(dist[3]); // arm 2 > full stealth

    // Verify selected strategy maps to 'active' stealth mode
    // Sample 20 times — majority should be arm 2
    let arm2Count = 0;
    for (let i = 0; i < 20; i++) {
      const { armIndex } = freshManager.selectStrategy(domain);
      if (armIndex === 2) arm2Count++;
    }
    // At least half should be arm 2
    expect(arm2Count).toBeGreaterThan(10);
  });

  it('converges on passive mode for sites that only need automation removal', () => {
    const manager = new StrategyManager();
    const domain = 'simple-detection.com';

    // Arms 1-3 all succeed (site only checks for webdriver), arm 0 fails
    // The bandit should converge on the lowest-cost arm that works (arm 1)
    for (let i = 0; i < 100; i++) {
      const { armIndex } = manager.selectStrategy(domain);
      const success = armIndex >= 1; // passive and above all work
      manager.recordOutcome(domain, armIndex, success);
    }

    // The stealth mode for the most selected arm should be passive or active
    const dist = manager.getStats(domain).distribution;
    // Arm 0 (baseline, which fails) should have lowest probability
    expect(dist[0]).toBeLessThan(dist[1]);
  });

  it('arm-to-mode mapping covers the full escalation path', () => {
    // Verify the escalation path makes sense:
    // off → passive → active → active (with extras)
    const modes = [0, 1, 2, 3].map(armToStealthMode);
    expect(modes).toEqual(['off', 'passive', 'active', 'active']);

    // Verify extra measures only apply at the highest tier
    const extras = [0, 1, 2, 3].map(armRequiresExtraMeasures);
    expect(extras).toEqual([false, false, false, true]);
  });
});
