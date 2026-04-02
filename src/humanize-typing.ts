// ─── Humanized Typing ──────────────────────────────────────────────────────
//
// Gaussian-distributed inter-key delays, burst typing, and a QWERTY-adjacency
// typo model with backspace correction. Ported from the validated humanize.js
// prototype (tested on 3090 box, statistically verified).
//
// Integration point: import { humanTyping } from "./humanize-typing.js"
// then call humanTyping.typeText(page, text) inside the act tool handler
// (src/index.ts) as an alternative to page.keyboard.type().
//
// Standalone module — no cross-dependencies on other humanize modules.

import type { Page } from "playwright";
import { humanDelay, sleep, isHumanizeEnabled } from "./humanize-utils.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface KeystrokeEvent {
  /** The character to press (or '\b' for backspace) */
  char: string;
  /** Delay before this keystroke in ms */
  delay: number;
  /** Whether this keystroke is a typo */
  isTypo: boolean;
  /** If non-null, the correct character that was retyped after a typo correction */
  correction: string | null;
}

export interface TypeOptions {
  /** Mean inter-key delay in ms. Default: 80 */
  baseDelay?: number;
  /** Base probability of a typo per alphabetic character. Default: 0.02 */
  typoRate?: number;
}

// ─── QWERTY Adjacency Map ──────────────────────────────────────────────────

/**
 * QWERTY adjacency map for simulating realistic typos.
 * Each key maps to its physically adjacent keys on a standard QWERTY layout.
 */
const QWERTY_ADJACENT: Record<string, string[]> = {
  q: ["w", "a"],            w: ["q", "e", "a", "s"],     e: ["w", "r", "s", "d"],
  r: ["e", "t", "d", "f"],  t: ["r", "y", "f", "g"],     y: ["t", "u", "g", "h"],
  u: ["y", "i", "h", "j"],  i: ["u", "o", "j", "k"],     o: ["i", "p", "k", "l"],
  p: ["o", "l"],
  a: ["q", "w", "s", "z"],  s: ["a", "w", "e", "d", "z", "x"],
  d: ["s", "e", "r", "f", "x", "c"],  f: ["d", "r", "t", "g", "c", "v"],
  g: ["f", "t", "y", "h", "v", "b"],  h: ["g", "y", "u", "j", "b", "n"],
  j: ["h", "u", "i", "k", "n", "m"],  k: ["j", "i", "o", "l", "m"],
  l: ["k", "o", "p"],
  z: ["a", "s", "x"],       x: ["z", "s", "d", "c"],     c: ["x", "d", "f", "v"],
  v: ["c", "f", "g", "b"],  b: ["v", "g", "h", "n"],     n: ["b", "h", "j", "m"],
  m: ["n", "j", "k"],
};

// ─── Keystroke Plan ────────────────────────────────────────────────────────

/**
 * Generate a sequence of keystroke events with humanized timing and typo simulation.
 *
 * Timing model:
 * - Base delay: Gaussian around 80ms (stddev 25ms) for common keys
 * - Longer pauses after spaces and punctuation (~150ms)
 * - Burst typing: occasional faster sequences (~50ms)
 *
 * Typo model:
 * - 2% base rate for alphabetic characters
 * - Higher rate (4%) for characters with many adjacent keys
 * - Typo character is chosen from QWERTY adjacency map
 * - Correction: backspace + retype after a short pause (200-400ms)
 */
export function humanTypeString(text: string, opts: TypeOptions = {}): KeystrokeEvent[] {
  const baseDelay = opts.baseDelay ?? 80;
  const typoRate = opts.typoRate ?? 0.02;
  const events: KeystrokeEvent[] = [];
  let inBurst = false;
  let burstRemaining = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const lower = char.toLowerCase();
    const isAlpha = /[a-z]/.test(lower);

    // Determine delay
    let delay: number;
    if (burstRemaining > 0) {
      delay = humanDelay(30, 55);
      burstRemaining--;
      if (burstRemaining === 0) inBurst = false;
    } else if (char === " " || /[.,;:!?]/.test(char)) {
      delay = humanDelay(100, 200); // pause at word boundaries
    } else if (char === "\n") {
      delay = humanDelay(200, 500); // longer pause at line breaks
    } else {
      delay = humanDelay(baseDelay - 25, baseDelay + 40);
    }

    // Random burst initiation (~8% chance at word starts)
    if (!inBurst && char === " " && Math.random() < 0.08) {
      inBurst = true;
      burstRemaining = Math.floor(Math.random() * 4) + 3;
    }

    // Typo check
    const adjacents = QWERTY_ADJACENT[lower];
    const effectiveRate = adjacents && adjacents.length >= 5 ? typoRate * 2 : typoRate;

    if (isAlpha && Math.random() < effectiveRate && adjacents) {
      const typoChar = adjacents[Math.floor(Math.random() * adjacents.length)];
      const displayTypo = char === char.toUpperCase() ? typoChar.toUpperCase() : typoChar;

      // Push the wrong keystroke
      events.push({ char: displayTypo, delay, isTypo: true, correction: null });
      // Push the backspace after a reaction delay
      events.push({ char: "\b", delay: humanDelay(150, 350), isTypo: false, correction: null });
      // Push the correct keystroke
      events.push({ char, delay: humanDelay(50, 120), isTypo: false, correction: char });
    } else {
      events.push({ char, delay, isTypo: false, correction: null });
    }
  }

  return events;
}

// ─── HumanTyping Class ─────────────────────────────────────────────────────

export class HumanTyping {
  /**
   * Whether humanized typing is enabled.
   * Returns false unless LEAP_HUMANIZE=true or LEAP_HUMANIZE=1 is set.
   */
  isEnabled(): boolean {
    return isHumanizeEnabled();
  }

  /**
   * Type text with humanized inter-key delays, occasional typos, and corrections.
   * Uses page.keyboard.press() for each character to control timing precisely.
   *
   * No-op if humanization is disabled.
   */
  async typeText(page: Page, text: string, opts?: TypeOptions): Promise<void> {
    if (!this.isEnabled()) return;

    const events = humanTypeString(text, opts);

    for (const event of events) {
      await sleep(event.delay);

      if (event.char === "\b") {
        await page.keyboard.press("Backspace");
      } else {
        await page.keyboard.press(event.char);
      }
    }
  }
}

export const humanTyping = new HumanTyping();
export default humanTyping;
