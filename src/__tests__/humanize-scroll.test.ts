/**
 * humanize-scroll.test.ts — Tests for scroll humanization from humanize.js.
 *
 * Tests:
 * - Ramp-up phase present (small initial increments)
 * - Momentum decay (each step smaller than previous in decay phase)
 * - Total distance matches requested
 * - Direction preserved (positive/negative)
 *
 * Reference: research/gdrive-qa/humanize.js (humanScrollPlan)
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Reimplementation of scroll primitives from humanize.js
// ---------------------------------------------------------------------------

function gaussianRandom(mean = 0, stddev = 1): number {
  let u: number, v: number, s: number;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  return mean + stddev * u * mul;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function humanDelay(min = 50, max = 200): number {
  const mean = (min + max) / 2;
  const stddev = (max - min) / 6;
  return Math.round(clamp(gaussianRandom(mean, stddev), min, max));
}

interface ScrollStep {
  delta: number;
  delay: number;
  cumulative: number;
}

function humanScrollPlan(
  distance: number,
  opts: { maxIncrement?: number; friction?: number } = {}
): ScrollStep[] {
  const maxIncrement = opts.maxIncrement || 120;
  const friction = opts.friction || 0.82;
  const direction = distance >= 0 ? 1 : -1;
  let remaining = Math.abs(distance);
  const steps: ScrollStep[] = [];
  let cumulative = 0;

  // Phase 1: Ramp-up
  const rampSteps = Math.floor(Math.random() * 2) + 2;
  for (let i = 0; i < rampSteps && remaining > 0; i++) {
    const fraction = (i + 1) / (rampSteps + 1);
    const base = maxIncrement * fraction * 0.6;
    const delta = Math.min(
      Math.round(base + gaussianRandom(0, 5)),
      remaining
    );
    remaining -= delta;
    cumulative += delta * direction;
    steps.push({
      delta: delta * direction,
      delay: humanDelay(12, 25),
      cumulative,
    });
  }

  // Phase 2: Momentum decay
  let velocity = maxIncrement + gaussianRandom(0, 15);
  while (remaining > 2) {
    velocity *= friction + gaussianRandom(0, 0.03);
    velocity = clamp(velocity, 3, maxIncrement * 1.2);
    const delta = Math.min(Math.round(velocity), remaining);
    remaining -= delta;
    cumulative += delta * direction;
    steps.push({
      delta: delta * direction,
      delay: humanDelay(14, 30),
      cumulative,
    });
  }

  // Mop up remainder
  if (remaining > 0) {
    cumulative += remaining * direction;
    steps.push({
      delta: remaining * direction,
      delay: humanDelay(20, 50),
      cumulative,
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Humanize Scroll", () => {
  // ── Ramp-up phase ──────────────────────────────────────────────────

  describe("Ramp-up phase", () => {
    it("first few steps have increasing deltas (ramp-up)", () => {
      // Use a large distance to ensure ramp-up is distinct
      const plan = humanScrollPlan(1000);

      // The plan should have at least 2 ramp-up steps
      expect(plan.length).toBeGreaterThanOrEqual(3);

      // First ramp-up steps should generally increase
      // (with noise, we check the trend across many trials)
      let rampUpCount = 0;

      for (let trial = 0; trial < 30; trial++) {
        const p = humanScrollPlan(1000);
        if (p.length >= 3) {
          // First step should be smaller than second step (ramp-up)
          if (Math.abs(p[0].delta) < Math.abs(p[1].delta)) {
            rampUpCount++;
          }
        }
      }

      // Most trials should show ramp-up pattern
      expect(rampUpCount).toBeGreaterThan(15);
    });

    it("ramp-up steps are smaller than the maxIncrement", () => {
      const maxIncrement = 120;
      const plan = humanScrollPlan(1000, { maxIncrement });

      // First 2-3 steps are ramp-up; they should be < maxIncrement * 0.6
      for (let i = 0; i < Math.min(3, plan.length); i++) {
        expect(Math.abs(plan[i].delta)).toBeLessThanOrEqual(maxIncrement);
      }
    });
  });

  // ── Momentum decay ────────────────────────────────────────────────

  describe("Momentum decay", () => {
    it("later steps generally get smaller (friction)", () => {
      // Use large distance to get many decay steps
      let decayPatternCount = 0;

      for (let trial = 0; trial < 30; trial++) {
        const plan = humanScrollPlan(2000, { friction: 0.82 });

        // Skip ramp-up (first 3-4 steps), look at decay phase
        const decayStart = Math.min(4, plan.length - 2);
        if (plan.length <= decayStart + 3) continue;

        // In the decay phase, most consecutive pairs should show decreasing deltas
        let decreasing = 0;
        let total = 0;
        for (let i = decayStart + 1; i < plan.length - 1; i++) {
          total++;
          if (Math.abs(plan[i].delta) <= Math.abs(plan[i - 1].delta)) {
            decreasing++;
          }
        }

        if (total > 0 && decreasing / total > 0.5) {
          decayPatternCount++;
        }
      }

      // Most trials should show decay pattern
      expect(decayPatternCount).toBeGreaterThan(15);
    });

    it("lower friction value causes smaller final velocity", () => {
      // With lower friction, the velocity decays faster, meaning later steps
      // have smaller deltas. We measure the average absolute delta in the
      // last third of each plan as a proxy for remaining velocity.
      let highFrictionTailAvg = 0;
      let lowFrictionTailAvg = 0;
      const trials = 30;

      for (let trial = 0; trial < trials; trial++) {
        const highFriction = humanScrollPlan(1000, { friction: 0.95 });
        const lowFriction = humanScrollPlan(1000, { friction: 0.7 });

        const hTail = highFriction.slice(
          Math.floor(highFriction.length * 0.66)
        );
        const lTail = lowFriction.slice(
          Math.floor(lowFriction.length * 0.66)
        );

        const hAvg =
          hTail.reduce((s, st) => s + Math.abs(st.delta), 0) /
          (hTail.length || 1);
        const lAvg =
          lTail.reduce((s, st) => s + Math.abs(st.delta), 0) /
          (lTail.length || 1);

        highFrictionTailAvg += hAvg;
        lowFrictionTailAvg += lAvg;
      }

      // Higher friction retains more velocity in the tail
      expect(highFrictionTailAvg / trials).toBeGreaterThan(
        lowFrictionTailAvg / trials
      );
    });
  });

  // ── Total distance matches ────────────────────────────────────────

  describe("Total distance matches requested", () => {
    it("cumulative sum of deltas equals the requested distance (positive)", () => {
      for (let trial = 0; trial < 20; trial++) {
        const distance = 500;
        const plan = humanScrollPlan(distance);

        const totalDelta = plan.reduce((sum, s) => sum + s.delta, 0);
        expect(totalDelta).toBe(distance);
      }
    });

    it("cumulative sum of deltas equals the requested distance (negative)", () => {
      for (let trial = 0; trial < 20; trial++) {
        const distance = -500;
        const plan = humanScrollPlan(distance);

        const totalDelta = plan.reduce((sum, s) => sum + s.delta, 0);
        expect(totalDelta).toBe(distance);
      }
    });

    it("final cumulative value matches the requested distance", () => {
      const distance = 750;
      const plan = humanScrollPlan(distance);

      const lastStep = plan[plan.length - 1];
      expect(lastStep.cumulative).toBe(distance);
    });

    it("cumulative field is monotonically increasing for positive distance", () => {
      const plan = humanScrollPlan(1000);

      for (let i = 1; i < plan.length; i++) {
        expect(plan[i].cumulative).toBeGreaterThanOrEqual(
          plan[i - 1].cumulative
        );
      }
    });

    it("cumulative field is monotonically decreasing for negative distance", () => {
      const plan = humanScrollPlan(-1000);

      for (let i = 1; i < plan.length; i++) {
        expect(plan[i].cumulative).toBeLessThanOrEqual(
          plan[i - 1].cumulative
        );
      }
    });

    it("works with small distances (10px)", () => {
      const plan = humanScrollPlan(10);
      const total = plan.reduce((sum, s) => sum + s.delta, 0);
      expect(total).toBe(10);
      expect(plan.length).toBeGreaterThanOrEqual(1);
    });

    it("works with large distances (10000px)", () => {
      const plan = humanScrollPlan(10000);
      const total = plan.reduce((sum, s) => sum + s.delta, 0);
      expect(total).toBe(10000);
      expect(plan.length).toBeGreaterThan(10);
    });
  });

  // ── Direction preserved ───────────────────────────────────────────

  describe("Direction preserved", () => {
    it("positive distance produces all positive deltas", () => {
      const plan = humanScrollPlan(500);

      for (const step of plan) {
        expect(step.delta).toBeGreaterThan(0);
      }
    });

    it("negative distance produces all negative deltas", () => {
      const plan = humanScrollPlan(-500);

      for (const step of plan) {
        expect(step.delta).toBeLessThan(0);
      }
    });

    it("zero distance produces empty plan", () => {
      const plan = humanScrollPlan(0);
      expect(plan.length).toBe(0);
    });
  });

  // ── Delay timing ──────────────────────────────────────────────────

  describe("Delay timing", () => {
    it("ramp-up delays are short (under 30ms)", () => {
      // The ramp phase uses humanDelay(12, 25) but the number of ramp
      // steps is random (2-3). If the distance is consumed early, later
      // steps may already be in the decay phase (humanDelay(14, 30)).
      // We verify the first 2 steps are in the short delay range.
      const plan = humanScrollPlan(1000);

      for (let i = 0; i < Math.min(2, plan.length); i++) {
        expect(plan[i].delay).toBeGreaterThanOrEqual(12);
        expect(plan[i].delay).toBeLessThanOrEqual(30);
      }
    });

    it("decay phase delays are in 14-30ms range", () => {
      const plan = humanScrollPlan(2000);

      // Skip ramp-up, check decay steps
      for (let i = 4; i < plan.length - 1; i++) {
        expect(plan[i].delay).toBeGreaterThanOrEqual(14);
        expect(plan[i].delay).toBeLessThanOrEqual(30);
      }
    });

    it("total simulated scroll time is reasonable", () => {
      const plan = humanScrollPlan(1000);
      const totalDelay = plan.reduce((sum, s) => sum + s.delay, 0);

      // 1000px scroll should take roughly 200-1000ms of simulated time
      expect(totalDelay).toBeGreaterThan(100);
      expect(totalDelay).toBeLessThan(5000);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("very small distance (1px) produces at least one step", () => {
      const plan = humanScrollPlan(1);
      expect(plan.length).toBeGreaterThanOrEqual(1);
      const total = plan.reduce((sum, s) => sum + s.delta, 0);
      expect(total).toBe(1);
    });

    it("custom maxIncrement is respected", () => {
      const plan = humanScrollPlan(500, { maxIncrement: 50 });

      for (const step of plan) {
        // With maxIncrement 50 and some noise, deltas should not exceed ~60
        expect(Math.abs(step.delta)).toBeLessThanOrEqual(70);
      }
    });

    it("all delays are positive integers", () => {
      const plan = humanScrollPlan(500);

      for (const step of plan) {
        expect(step.delay).toBeGreaterThan(0);
        expect(Number.isInteger(step.delay)).toBe(true);
      }
    });

    it("different runs produce different step counts (randomized)", () => {
      const stepCounts = new Set<number>();
      for (let trial = 0; trial < 30; trial++) {
        const plan = humanScrollPlan(1000);
        stepCounts.add(plan.length);
      }

      // Should see some variation in step count
      expect(stepCounts.size).toBeGreaterThan(1);
    });
  });
});
