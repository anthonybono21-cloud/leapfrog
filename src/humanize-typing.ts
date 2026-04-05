// ─── Humanized Typing ──────────────────────────────────────────────────────
//
// Log-normal–distributed inter-key delays, key dwell time, rollover typing,
// bigram-aware timing, burst typing, and a QWERTY-adjacency typo model with
// backspace correction.
//
// Research basis: 03-typing-humanization.md
//   - Log-normal distribution (right-skewed, heavy-tailed — matches 136M
//     keystrokes study, Monaco et al. 2021 log-logistic finding)
//   - 200ms median IKI (~52 WPM, population mean)
//   - Key dwell time 70ms median (50-130ms range)
//   - Rollover typing on hand-alternation bigrams
//   - Bigram-aware speed multipliers (hand alternation, same-finger)
//
// Integration point: import { humanTyping } from "./humanize-typing.js"
// then call humanTyping.typeText(page, text) inside the act tool handler
// (src/index.ts) as an alternative to page.keyboard.type().
//
// Standalone module — no cross-dependencies on other humanize modules.

import type { Page } from "playwright-core";
import { humanDelay, logNormalDelay, sleep, isHumanizeEnabled } from "./humanize-utils.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface KeystrokeEvent {
  /** The character to press (or '\b' for backspace) */
  char: string;
  /** Delay before this keystroke in ms (flight time / inter-key interval) */
  delay: number;
  /** Key dwell time in ms (how long the key is held down) */
  dwell: number;
  /** Whether this keystroke is a typo */
  isTypo: boolean;
  /** If non-null, the correct character that was retyped after a typo correction */
  correction: string | null;
  /** Whether this keystroke should overlap with the previous key release (rollover) */
  rollover: boolean;
}

export interface TypeOptions {
  /** Median inter-key delay in ms (log-normal center). Default: 200 */
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

// ─── Bigram Timing ─────────────────────────────────────────────────────────

/**
 * Hand-alternation bigrams — typed fastest because both hands work in parallel.
 * (Salthouse 1986: 30-60ms faster than same-hand bigrams)
 */
const ALTERNATING_BIGRAMS = new Set([
  "th", "ht", "di", "id", "en", "ne", "ri", "ir", "to", "ot",
  "do", "od", "gu", "ug", "ha", "ah", "fi", "if", "pe", "ep",
  "wo", "ow", "bi", "ib", "tu", "ut", "ry", "yr", "ck", "kc",
]);

/**
 * Same-finger bigrams — typed slowest because one finger must travel between rows.
 */
const SAME_FINGER_BIGRAMS = new Set([
  "ed", "de", "nu", "un", "my", "ym", "ce", "ec", "rb", "br",
  "ft", "tf", "ju", "uj", "ki", "ik", "lo", "ol", "ws", "sw",
]);

/**
 * Return a speed multiplier based on the bigram (previous + current character).
 * Hand alternation = 0.7x (30% faster), same finger = 1.4x (40% slower).
 */
function bigramMultiplier(prev: string, curr: string): number {
  const pair = (prev + curr).toLowerCase();
  if (ALTERNATING_BIGRAMS.has(pair)) return 0.7;
  if (SAME_FINGER_BIGRAMS.has(pair)) return 1.4;
  return 1.0;
}

// ─── Dwell Time ────────────────────────────────────────────────────────────

/** Default dwell time config (research: 50-130ms range, median ~70ms) */
const DWELL_MEDIAN = 70;
const DWELL_SIGMA = 0.3;

/**
 * Compute key dwell time (keydown-to-keyup duration) for a character.
 * Backspace has a shorter dwell (~40ms). Regular keys ~70ms median.
 */
function computeDwell(char: string): number {
  if (char === "\b") return logNormalDelay(40, 0.25, 20);
  return logNormalDelay(DWELL_MEDIAN, DWELL_SIGMA, 30);
}

// ─── Keystroke Plan ────────────────────────────────────────────────────────

/**
 * Generate a sequence of keystroke events with humanized timing and typo simulation.
 *
 * Timing model (research-backed):
 * - Base delay: Log-normal with 200ms median, sigma 0.45 (right-skewed, heavy-tailed)
 * - Bigram-aware: hand-alternation pairs 30% faster, same-finger pairs 40% slower
 * - Longer pauses at word boundaries (~250ms median) and after punctuation
 * - Burst typing: occasional faster sequences (50% of base delay)
 * - Key dwell time: log-normal with 70ms median (50-130ms typical range)
 * - Rollover: next key pressed before previous released on fast hand-alternation bigrams
 *
 * Typo model:
 * - 2% base rate for alphabetic characters
 * - Higher rate (4%) for characters with many adjacent keys
 * - Typo character is chosen from QWERTY adjacency map
 * - Correction: backspace + retype after a short pause (200-400ms)
 */
export function humanTypeString(text: string, opts: TypeOptions = {}): KeystrokeEvent[] {
  const baseDelay = opts.baseDelay ?? 200;
  const typoRate = opts.typoRate ?? 0.02;
  const events: KeystrokeEvent[] = [];
  let inBurst = false;
  let burstRemaining = 0;
  let prevChar = "";

  // ── Fatigue model ─────────────────────────────────────────────────
  // After ~30 seconds of continuous typing (estimated from char count × avg IKI),
  // gradually slow down by 10-15%. This simulates reduced motor performance
  // during sustained input — a strong human signal absent in bots.
  const FATIGUE_ONSET_CHARS = 150; // ~30s at 200ms avg IKI
  const FATIGUE_MAX_MULTIPLIER = 1.15; // 15% slower at peak fatigue
  const FATIGUE_RAMP_CHARS = 100; // chars over which fatigue ramps from 1.0 to max

  // Log-normal sigma: controls the right-skew / heavy tail.
  // 0.45 produces mode ~170ms, mean ~215ms with occasional spikes to 400-600ms.
  const ikiSigma = 0.45;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const lower = char.toLowerCase();
    const isAlpha = /[a-z]/.test(lower);

    // ── Fatigue multiplier ───────────────────────────────────────
    let fatigueMultiplier = 1.0;
    if (i > FATIGUE_ONSET_CHARS) {
      const fatigueProgress = Math.min(1.0, (i - FATIGUE_ONSET_CHARS) / FATIGUE_RAMP_CHARS);
      fatigueMultiplier = 1.0 + fatigueProgress * (FATIGUE_MAX_MULTIPLIER - 1.0);
    }

    // ── Compute inter-key delay (flight time) ──────────────────────
    let delay: number;
    if (burstRemaining > 0) {
      // Burst: 50% of base delay, still log-normal distributed
      delay = logNormalDelay(Math.round(baseDelay * 0.5), 0.35, 25);
      burstRemaining--;
      if (burstRemaining === 0) inBurst = false;
    } else if (char === " ") {
      // Word boundary: research shows ~250ms median inter-word pause
      delay = logNormalDelay(250, 0.4, 80);
    } else if (/[.,;:!?]/.test(char)) {
      // Punctuation: slightly longer pause
      delay = logNormalDelay(200, 0.4, 80);
    } else if (char === "\n") {
      // Line break: cognitive pause
      delay = logNormalDelay(400, 0.5, 150);
    } else {
      // Regular character: log-normal around baseDelay with bigram adjustment
      const multiplier = prevChar ? bigramMultiplier(prevChar, lower) : 1.0;
      delay = logNormalDelay(Math.round(baseDelay * multiplier), ikiSigma, 40);
    }

    // Apply fatigue to the computed delay
    delay = Math.round(delay * fatigueMultiplier);

    // ── Cognitive pause: 12% chance of a think-pause at word starts ──
    if (prevChar === " " && isAlpha && !inBurst && Math.random() < 0.12) {
      delay = logNormalDelay(400, 0.5, 150);
    }

    // ── Burst initiation: ~8% chance after spaces ──────────────────
    if (!inBurst && char === " " && Math.random() < 0.08) {
      inBurst = true;
      burstRemaining = Math.floor(Math.random() * 6) + 3; // 3-8 chars
    }

    // ── Rollover detection ─────────────────────────────────────────
    // On hand-alternation bigrams with short flight times, the next key
    // is pressed before the previous key is released. This is a strong
    // human signal that sequential bots lack.
    let rollover = false;
    if (prevChar && delay < 180) {
      const pair = (prevChar + lower).toLowerCase();
      if (ALTERNATING_BIGRAMS.has(pair) && Math.random() < 0.3) {
        rollover = true;
      }
    }

    // ── Compute dwell time ─────────────────────────────────────────
    const dwell = computeDwell(char);

    // ── Typo check ─────────────────────────────────────────────────
    const adjacents = QWERTY_ADJACENT[lower];
    const effectiveRate = adjacents && adjacents.length >= 5 ? typoRate * 2 : typoRate;

    if (isAlpha && Math.random() < effectiveRate && adjacents) {
      const typoChar = adjacents[Math.floor(Math.random() * adjacents.length)];
      const displayTypo = char === char.toUpperCase() ? typoChar.toUpperCase() : typoChar;

      // Push the wrong keystroke
      events.push({ char: displayTypo, delay, dwell: computeDwell(displayTypo), isTypo: true, correction: null, rollover });
      // Push the backspace after a reaction delay
      events.push({ char: "\b", delay: humanDelay(150, 350), dwell: computeDwell("\b"), isTypo: false, correction: null, rollover: false });
      // Push the correct keystroke
      events.push({ char, delay: humanDelay(50, 120), dwell, isTypo: false, correction: char, rollover: false });
    } else {
      events.push({ char, delay, dwell, isTypo: false, correction: null, rollover });
    }

    prevChar = lower;
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
   * Type text with humanized inter-key delays, key dwell time, rollover,
   * occasional typos, and corrections.
   *
   * Uses page.keyboard.down() / up() for full timing control:
   *   - Per-key flight time (variable IKI via log-normal distribution)
   *   - Per-key dwell time (variable hold duration)
   *   - Rollover simulation (next keydown before previous keyup)
   *
   * No-op if humanization is disabled.
   */
  async typeText(page: Page, text: string, opts?: TypeOptions): Promise<void> {
    if (!this.isEnabled()) return;

    const events = humanTypeString(text, opts);
    let prevKeyDown: string | null = null;

    for (const event of events) {
      const key = event.char === "\b" ? "Backspace" : event.char;

      if (event.rollover && prevKeyDown) {
        // Rollover: press next key BEFORE releasing previous key.
        // Overlap by a portion of the flight time.
        const overlap = logNormalDelay(25, 0.3, 10);
        const preOverlapWait = Math.max(0, event.delay - overlap);
        await sleep(preOverlapWait);
        await page.keyboard.down(key);
        await sleep(overlap);
        await page.keyboard.up(prevKeyDown);
        await sleep(event.dwell);
        await page.keyboard.up(key);
        prevKeyDown = null;
      } else {
        // Release previous key if still held (shouldn't normally happen,
        // but guard against it)
        if (prevKeyDown) {
          await page.keyboard.up(prevKeyDown);
          prevKeyDown = null;
        }

        // Standard keystroke: wait flight time, then keydown, hold, keyup
        await sleep(event.delay);
        await page.keyboard.down(key);
        await sleep(event.dwell);
        await page.keyboard.up(key);
      }
    }

    // Ensure final key is released
    if (prevKeyDown) {
      await page.keyboard.up(prevKeyDown);
    }
  }
}

export const humanTyping = new HumanTyping();
export default humanTyping;
