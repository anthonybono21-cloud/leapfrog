// ─── EXP3 Adversarial Bandit for Stealth Strategy Selection ──────────────
//
// Bot detection is adversarial — the detector adapts, so static strategies
// decay. EXP3 provides worst-case regret guarantees regardless of what the
// detector does. One bandit per domain, because different sites use different
// detection stacks.
//
// Arms map to stealth tiers in DomainRecord.stealthTier:
//   0 = baseline, 1 = cookies+UA, 2 = fingerprint spoofing, 3 = full stealth

import { logger } from './logger.js';
import type { StealthModeType } from './stealth.js';

// ─── Strategy Definitions ────────────────────────────────────────────────

const STRATEGIES = [
  'baseline',
  'tier1-cookies',
  'tier2-fingerprint',
  'tier3-full-stealth',
] as const;

export type StealthStrategy = (typeof STRATEGIES)[number];

// ─── Arm → Stealth Mode Mapping ─────────────────────────────────────────
//
// Maps bandit arm indices to the stealth mode that gets applied per-page.
//
//   Arm 0: baseline         → 'off'     — raw Playwright, no stealth patches
//   Arm 1: tier1-cookies    → 'passive' — remove automation signals only
//   Arm 2: tier2-fingerprint → 'active' — full fingerprint spoofing
//   Arm 3: tier3-full-stealth → 'active' — full stealth + extra measures
//
// Key insight: passive mode is the sweet spot for most sites. Active
// fingerprint spoofing is counterproductive on advanced fingerprinters
// (CreepJS detects the faked identity as "lies"). The bandit should
// naturally converge on passive (arm 1) for most sites.

export function armToStealthMode(armIndex: number): StealthModeType {
  switch (armIndex) {
    case 0: return 'off';       // baseline — no stealth at all
    case 1: return 'passive';   // tier1 — remove automation signals only
    case 2: return 'active';    // tier2 — full fingerprint spoofing
    case 3: return 'active';    // tier3 — full stealth (same mode, extra measures elsewhere)
    default: return 'passive';  // safe fallback
  }
}

/**
 * Whether the given arm index implies extra behavioral measures
 * beyond the stealth mode (rate limiting, human-like delays).
 * Only tier3-full-stealth (arm 3) triggers these extras.
 */
export function armRequiresExtraMeasures(armIndex: number): boolean {
  return armIndex === 3;
}

// ─── EXP3 Bandit ─────────────────────────────────────────────────────────

export class StealthBandit {
  private weights: number[];
  private gamma: number;
  private numArms: number;

  constructor(numArms: number, gamma?: number) {
    this.numArms = numArms;
    // Theoretical EXP3 optimal: sqrt(K * ln(K) / ((e-1) * T)).
    // Without a known T, we assume T=100 visits per domain as a reasonable
    // horizon. This keeps exploration meaningful for small K while still
    // converging.  Clamped to [0.01, 0.5] for stability.
    this.gamma = gamma ?? Math.min(0.5, Math.max(0.01, Math.sqrt(
      numArms * Math.log(numArms) / ((Math.E - 1) * 100),
    )));
    this.weights = new Array(numArms).fill(1.0);
  }

  /** Probability distribution over arms (EXP3 mixture). */
  getDistribution(): number[] {
    const sum = this.weights.reduce((a, b) => a + b, 0);
    return this.weights.map(w =>
      (1 - this.gamma) * (w / sum) + this.gamma / this.numArms,
    );
  }

  /** Sample an arm from the distribution. */
  selectArm(): number {
    const dist = this.getDistribution();
    let r = Math.random();
    for (let i = 0; i < dist.length; i++) {
      r -= dist[i];
      if (r <= 0) return i;
    }
    return this.numArms - 1; // floating-point safety net
  }

  /** Importance-weighted exponential update after observing reward. */
  update(arm: number, reward: number): void {
    const dist = this.getDistribution();
    const estimatedReward = reward / dist[arm];
    this.weights[arm] *= Math.exp(
      this.gamma * estimatedReward / this.numArms,
    );

    // Prevent weight explosion — normalize when any weight exceeds 1e10
    const maxWeight = Math.max(...this.weights);
    if (maxWeight > 1e10) {
      this.weights = this.weights.map(w => w / maxWeight);
    }
  }

  /** Serialize for persistence in domain records. */
  toJSON(): { weights: number[]; gamma: number; numArms: number } {
    return { weights: [...this.weights], gamma: this.gamma, numArms: this.numArms };
  }

  /** Restore from persisted state. */
  static fromJSON(data: { weights: number[]; gamma: number; numArms?: number }): StealthBandit {
    const bandit = new StealthBandit(data.weights.length, data.gamma);
    bandit.weights = [...data.weights];
    return bandit;
  }
}

// ─── Per-Domain Strategy Manager ─────────────────────────────────────────

export class StrategyManager {
  private bandits: Map<string, StealthBandit> = new Map();
  private strategies: readonly string[];

  constructor(strategies: readonly string[] = STRATEGIES) {
    this.strategies = strategies;
  }

  /** Normalize domain: strip www., lowercase. */
  private normalizeDomain(domain: string): string {
    return domain.toLowerCase().replace(/^www\./, '');
  }

  /** Get or create the bandit for a domain. */
  private getBandit(domain: string): StealthBandit {
    const key = this.normalizeDomain(domain);
    let bandit = this.bandits.get(key);
    if (!bandit) {
      bandit = new StealthBandit(this.strategies.length);
      this.bandits.set(key, bandit);
      logger.debug('stealth-bandit:created', { domain: key, arms: this.strategies.length });
    }
    return bandit;
  }

  /** Select a stealth strategy for the given domain. */
  selectStrategy(domain: string): { strategy: string; armIndex: number } {
    const bandit = this.getBandit(domain);
    const armIndex = bandit.selectArm();
    const strategy = this.strategies[armIndex];
    logger.debug('stealth-bandit:selected', { domain: this.normalizeDomain(domain), strategy, armIndex });
    return { strategy, armIndex };
  }

  /** Record success/failure for a strategy on a domain. */
  recordOutcome(domain: string, armIndex: number, success: boolean): void {
    const bandit = this.getBandit(domain);
    bandit.update(armIndex, success ? 1 : 0);
    logger.debug('stealth-bandit:outcome', {
      domain: this.normalizeDomain(domain),
      arm: armIndex,
      strategy: this.strategies[armIndex],
      success,
    });
  }

  /** Debugging stats for a domain's bandit. */
  getStats(domain: string): { distribution: number[]; strategies: readonly string[] } {
    const bandit = this.getBandit(domain);
    return {
      distribution: bandit.getDistribution(),
      strategies: this.strategies,
    };
  }

  /** Serialize a domain's bandit for persistence. */
  toJSON(domain: string): ReturnType<StealthBandit['toJSON']> | null {
    const key = this.normalizeDomain(domain);
    const bandit = this.bandits.get(key);
    return bandit ? bandit.toJSON() : null;
  }

  /** Restore a domain's bandit from persisted data. */
  fromJSON(domain: string, data: { weights: number[]; gamma: number }): void {
    const key = this.normalizeDomain(domain);
    this.bandits.set(key, StealthBandit.fromJSON(data));
    logger.debug('stealth-bandit:restored', { domain: key });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

export const strategyManager = new StrategyManager();
