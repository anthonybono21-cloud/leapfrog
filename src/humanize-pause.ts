// ─── Humanized Think Pauses ────────────────────────────────────────────────
//
// Inter-action "think" delays that simulate the cognitive gap between
// deciding what to do and actually doing it. Real humans don't chain
// click-type-scroll at machine speed — there's a reaction time gap.
//
// Integration point: import { thinkPause } from "./humanize-pause.js"
// then call thinkPause.beforeAction("click") inside the act tool handler
// (src/index.ts) before dispatching each Playwright action.
//
// Standalone module — no cross-dependencies on other humanize modules.

import { humanDelay, sleep, isHumanizeEnabled } from "./humanize-utils.js";

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

// ─── ThinkPause Class ──────────────────────────────────────────────────────

export class ThinkPause {
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
   * No-op if humanization is disabled.
   *
   * @param actionType - The type of action about to be performed
   * @returns The actual delay waited in ms (0 if disabled)
   */
  async beforeAction(actionType: ActionType): Promise<number> {
    if (!this.isEnabled()) return 0;

    const range = DELAY_RANGES[actionType] ?? DELAY_RANGES.click;
    const delay = humanDelay(range.min, range.max);
    await sleep(delay);
    return delay;
  }
}

export const thinkPause = new ThinkPause();
export default thinkPause;
