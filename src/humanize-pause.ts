// ─── Humanized Think Pauses ────────────────────────────────────────────────
//
// Inter-action "think" delays that simulate the cognitive gap between
// deciding what to do and actually doing it. Real humans don't chain
// click-type-scroll at machine speed — there's a reaction time gap.
//
// Also includes post-navigation settling, content-aware dwell time,
// and form-fill timing helpers.
//
// Integration point: import { thinkPause } from "./humanize-pause.js"
// then call thinkPause.beforeAction("click") inside the act tool handler
// (src/index.ts) before dispatching each Playwright action.
//
// Standalone module — no cross-dependencies on other humanize modules.

import { humanDelay, logNormalDelay, sleep, isHumanizeEnabled } from "./humanize-utils.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/** Action types that trigger different think-pause durations. */
export type ActionType = "click" | "type" | "scroll" | "navigate";

/** Delay range configuration per action type. */
interface DelayRange {
  min: number;
  max: number;
}

// ─── Delay Ranges ──────────────────────────────────────────────────────────

/**
 * Cognitive delay ranges based on action type.
 *
 * These ranges are calibrated from HCI research on human reaction times:
 * - Click: quick motor action, 100-400ms (visual target acquisition)
 * - Type: mental composition before typing, 200-600ms
 * - Scroll: rapid decision, 50-200ms (continuation gesture)
 * - Navigate: page comprehension pause, 500-1500ms (after page load)
 */
const DELAY_RANGES: Record<ActionType, DelayRange> = {
  click:    { min: 100, max: 400 },
  type:     { min: 200, max: 600 },
  scroll:   { min: 50,  max: 200 },
  navigate: { min: 500, max: 1500 },
};

// ─── Constants ─────────────────────────────────────────────────────────────

/** Minimum post-navigation settling time in ms. */
const NAV_SETTLE_FLOOR_MS = 500;

/** Median first-interaction delay after navigation (log-normal center). */
const NAV_FIRST_INTERACTION_MEDIAN_MS = 1500;

// ─── ThinkPause Class ──────────────────────────────────────────────────────

export class ThinkPause {
  /**
   * Timestamp of the last navigation completion. Used to enforce the
   * post-navigation settling delay.
   */
  private lastNavigationTime = 0;

  /**
   * Whether the first interaction after the latest navigation has occurred.
   * Reset on each navigation, set to true after the first beforeAction call.
   */
  private firstInteractionDone = true;

  /**
   * Whether think pauses are enabled.
   * Returns false unless LEAP_HUMANIZE=true or LEAP_HUMANIZE=1 is set.
   */
  isEnabled(): boolean {
    return isHumanizeEnabled();
  }

  /**
   * Wait a human-like amount of time before performing an action.
   * The delay is drawn from a Gaussian distribution within the range
   * appropriate for the given action type.
   *
   * If this is the first interaction after a navigation, an additional
   * post-navigation settling delay is enforced (min 500ms, log-normal
   * median 1.5s).
   *
   * No-op if humanization is disabled.
   *
   * @param actionType - The type of action about to be performed
   * @returns The actual delay waited in ms (0 if disabled)
   */
  async beforeAction(actionType: ActionType): Promise<number> {
    if (!this.isEnabled()) return 0;

    let totalDelay = 0;

    // Post-navigation settling: enforce minimum 500ms after navigation
    if (!this.firstInteractionDone) {
      this.firstInteractionDone = true;
      const elapsed = Date.now() - this.lastNavigationTime;
      const settleDelay = logNormalDelay(NAV_FIRST_INTERACTION_MEDIAN_MS, 0.4, NAV_SETTLE_FLOOR_MS);
      const remaining = Math.max(0, settleDelay - elapsed);
      if (remaining > 0) {
        await sleep(remaining);
        totalDelay += remaining;
      }
    }

    const range = DELAY_RANGES[actionType] ?? DELAY_RANGES.click;
    const delay = humanDelay(range.min, range.max);
    await sleep(delay);
    totalDelay += delay;

    return totalDelay;
  }

  /**
   * Signal that a navigation has completed. Must be called after each
   * page navigation to arm the post-navigation settling logic.
   *
   * The next call to beforeAction() will enforce a minimum 500ms delay
   * with a log-normal first-interaction pause (median 1.5s).
   *
   * No-op if humanization is disabled.
   *
   * @returns The settling delay that will be enforced (0 if disabled)
   */
  afterNavigation(): number {
    if (!this.isEnabled()) return 0;

    this.lastNavigationTime = Date.now();
    this.firstInteractionDone = false;

    return NAV_SETTLE_FLOOR_MS;
  }

}

export const thinkPause = new ThinkPause();
export default thinkPause;
