// ─── Humanized Scrolling ───────────────────────────────────────────────────
//
// Inertial scroll simulation with ramp-up and momentum decay.
// Mimics touchpad / mouse-wheel scrolling with physics-based easing.
// Ported from the validated humanize.js prototype (tested on 3090 box,
// statistically verified).
//
// Integration point: import { humanScroll } from "./humanize-scroll.js"
// then call humanScroll.scroll(page, distance) inside the act tool handler
// (src/index.ts) as an alternative to page.mouse.wheel().
//
// Standalone module — no cross-dependencies on other humanize modules.

import type { Page } from "playwright";
import { gaussianRandom, clamp, humanDelay, sleep, isHumanizeEnabled } from "./humanize-utils.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface ScrollStep {
  /** Scroll increment in pixels (positive = down, negative = up) */
  delta: number;
  /** Delay before this step in ms */
  delay: number;
  /** Cumulative scroll distance after this step */
  cumulative: number;
}

export interface ScrollOptions {
  /** Maximum single scroll increment in pixels. Default: 120 */
  maxIncrement?: number;
  /** Momentum decay factor per step (0-1). Default: 0.82 */
  friction?: number;
}

// ─── Scroll Plan ───────────────────────────────────────────────────────────

/**
 * Generate a human-like scroll plan for a given pixel distance.
 * Simulates inertial scrolling with ease-out momentum decay.
 *
 * The scroll is broken into increments that start small (ramp-up / finger
 * contact), hit peak velocity, then taper off (friction / momentum loss),
 * similar to real touchpad scrolling.
 *
 * @param distance - Total scroll distance in pixels (positive = down)
 * @param opts - Configuration options
 * @returns Array of scroll steps with deltas and delays
 */
export function humanScrollPlan(distance: number, opts: ScrollOptions = {}): ScrollStep[] {
  const maxIncrement = opts.maxIncrement ?? 120;
  const friction = opts.friction ?? 0.82;
  const direction = distance >= 0 ? 1 : -1;
  let remaining = Math.abs(distance);
  const steps: ScrollStep[] = [];
  let cumulative = 0;

  // Phase 1: Ramp-up (2-3 small increments to simulate finger contact)
  const rampSteps = Math.floor(Math.random() * 2) + 2;
  for (let i = 0; i < rampSteps && remaining > 0; i++) {
    const fraction = (i + 1) / (rampSteps + 1);
    const base = maxIncrement * fraction * 0.6;
    const delta = Math.min(Math.round(base + gaussianRandom(0, 5)), remaining);
    remaining -= delta;
    cumulative += delta * direction;
    steps.push({
      delta: delta * direction,
      delay: humanDelay(12, 25),
      cumulative,
    });
  }

  // Phase 2: Momentum decay (ease-out)
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

  // Mop up any remainder
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

// ─── HumanScroll Class ─────────────────────────────────────────────────────

export class HumanScroll {
  /**
   * Whether humanized scrolling is enabled.
   * Returns false unless LEAP_HUMANIZE=true or LEAP_HUMANIZE=1 is set.
   */
  isEnabled(): boolean {
    return isHumanizeEnabled();
  }

  /**
   * Scroll the page by the given pixel distance using a human-like
   * ramp-up + momentum decay pattern.
   *
   * Each step in the scroll plan is dispatched as a mouse wheel event
   * with an inter-step delay to simulate real scrolling inertia.
   *
   * No-op if humanization is disabled.
   *
   * @param page - Playwright page instance
   * @param distance - Total scroll distance in pixels (positive = down, negative = up)
   */
  async scroll(page: Page, distance: number): Promise<void> {
    if (!this.isEnabled()) return;

    const plan = humanScrollPlan(distance);

    for (const step of plan) {
      await sleep(step.delay);
      await page.mouse.wheel(0, step.delta);
    }
  }
}

export const humanScroll = new HumanScroll();
export default humanScroll;
