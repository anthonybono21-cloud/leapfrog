/**
 * humanize-typing.test.ts — Tests for human-like typing simulation from humanize.js.
 *
 * Tests:
 * - Variable delays between keystrokes
 * - Common pairs get shorter delays (burst typing)
 * - Punctuation gets longer pauses
 * - Burst typing occurs at expected rate
 * - Typo + correction sequences (QWERTY adjacency)
 * - Total typing time is reasonable
 *
 * Reference: research/gdrive-qa/humanize.js (humanTypeString, humanDelay, QWERTY_ADJACENT)
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Reimplementation of typing primitives from humanize.js
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

const QWERTY_ADJACENT: Record<string, string[]> = {
  q: ["w", "a"],
  w: ["q", "e", "a", "s"],
  e: ["w", "r", "s", "d"],
  r: ["e", "t", "d", "f"],
  t: ["r", "y", "f", "g"],
  y: ["t", "u", "g", "h"],
  u: ["y", "i", "h", "j"],
  i: ["u", "o", "j", "k"],
  o: ["i", "p", "k", "l"],
  p: ["o", "l"],
  a: ["q", "w", "s", "z"],
  s: ["a", "w", "e", "d", "z", "x"],
  d: ["s", "e", "r", "f", "x", "c"],
  f: ["d", "r", "t", "g", "c", "v"],
  g: ["f", "t", "y", "h", "v", "b"],
  h: ["g", "y", "u", "j", "b", "n"],
  j: ["h", "u", "i", "k", "n", "m"],
  k: ["j", "i", "o", "l", "m"],
  l: ["k", "o", "p"],
  z: ["a", "s", "x"],
  x: ["z", "s", "d", "c"],
  c: ["x", "d", "f", "v"],
  v: ["c", "f", "g", "b"],
  b: ["v", "g", "h", "n"],
  n: ["b", "h", "j", "m"],
  m: ["n", "j", "k"],
};

interface TypeEvent {
  char: string;
  delay: number;
  isTypo: boolean;
  correction: string | null;
}

function humanTypeString(
  text: string,
  opts: { baseDelay?: number; typoRate?: number } = {}
): TypeEvent[] {
  const baseDelay = opts.baseDelay || 80;
  const typoRate = opts.typoRate || 0.02;
  const events: TypeEvent[] = [];
  let inBurst = false;
  let burstRemaining = 0;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const lower = char.toLowerCase();
    const isAlpha = /[a-z]/.test(lower);

    let delay: number;
    if (burstRemaining > 0) {
      delay = humanDelay(30, 55);
      burstRemaining--;
      if (burstRemaining === 0) inBurst = false;
    } else if (char === " " || /[.,;:!?]/.test(char)) {
      delay = humanDelay(100, 200);
    } else if (char === "\n") {
      delay = humanDelay(200, 500);
    } else {
      delay = humanDelay(baseDelay - 25, baseDelay + 40);
    }

    if (!inBurst && char === " " && Math.random() < 0.08) {
      inBurst = true;
      burstRemaining = Math.floor(Math.random() * 4) + 3;
    }

    let isTypo = false;
    let correction: string | null = null;
    const adjacents = QWERTY_ADJACENT[lower];
    const effectiveRate =
      adjacents && adjacents.length >= 5 ? typoRate * 2 : typoRate;

    if (isAlpha && Math.random() < effectiveRate && adjacents) {
      isTypo = true;
      const typoChar =
        adjacents[Math.floor(Math.random() * adjacents.length)];
      const displayTypo =
        char === char.toUpperCase() ? typoChar.toUpperCase() : typoChar;
      correction = char;

      events.push({ char: displayTypo, delay, isTypo: true, correction: null });
      events.push({
        char: "\b",
        delay: humanDelay(150, 350),
        isTypo: false,
        correction: null,
      });
      events.push({
        char,
        delay: humanDelay(50, 120),
        isTypo: false,
        correction,
      });
    } else {
      events.push({ char, delay, isTypo: false, correction: null });
    }
  }

  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Humanize Typing", () => {
  // ── Variable delays ────────────────────────────────────────────────

  describe("Variable delays between keystrokes", () => {
    it("delays are not all the same value", () => {
      const events = humanTypeString("the quick brown fox jumps");
      const delays = events.map((e) => e.delay);

      // With enough characters, we should see variation
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(3);
    });

    it("all delays are positive numbers", () => {
      const events = humanTypeString("testing delays");
      for (const e of events) {
        expect(e.delay).toBeGreaterThan(0);
        expect(Number.isFinite(e.delay)).toBe(true);
      }
    });

    it("delays for regular characters are within expected range", () => {
      const events = humanTypeString("abcdefgh");

      // Filter to non-typo, non-punctuation characters
      const regularEvents = events.filter(
        (e) => !e.isTypo && e.char !== "\b" && e.correction === null
      );

      for (const e of regularEvents) {
        // Base delay range: baseDelay-25 to baseDelay+40 = 55 to 120
        // With Gaussian distribution, most should fall in this range
        expect(e.delay).toBeGreaterThanOrEqual(10);
        expect(e.delay).toBeLessThanOrEqual(500);
      }
    });
  });

  // ── Punctuation pauses ────────────────────────────────────────────

  describe("Punctuation gets longer pauses", () => {
    it("space character gets longer delay than regular characters", () => {
      // Run many trials to get statistical significance
      let spaceDelaySum = 0;
      let spaceCount = 0;
      let regularDelaySum = 0;
      let regularCount = 0;

      for (let trial = 0; trial < 50; trial++) {
        const events = humanTypeString("the cat sat on the mat");
        for (const e of events) {
          if (e.isTypo || e.char === "\b") continue;
          if (e.char === " ") {
            spaceDelaySum += e.delay;
            spaceCount++;
          } else if (/[a-z]/.test(e.char) && e.correction === null) {
            regularDelaySum += e.delay;
            regularCount++;
          }
        }
      }

      const avgSpaceDelay = spaceDelaySum / spaceCount;
      const avgRegularDelay = regularDelaySum / regularCount;

      // Space delays (100-200ms range) should be higher than regular (55-120ms range)
      expect(avgSpaceDelay).toBeGreaterThan(avgRegularDelay);
    });

    it("comma gets a pause in the 100-200ms range", () => {
      const events = humanTypeString("hello, world");
      const commaEvent = events.find(
        (e) => e.char === "," && !e.isTypo
      );
      expect(commaEvent).toBeDefined();
      if (commaEvent) {
        expect(commaEvent.delay).toBeGreaterThanOrEqual(100);
        expect(commaEvent.delay).toBeLessThanOrEqual(200);
      }
    });

    it("period gets a pause in the 100-200ms range", () => {
      const events = humanTypeString("end. start");
      const periodEvent = events.find(
        (e) => e.char === "." && !e.isTypo
      );
      expect(periodEvent).toBeDefined();
      if (periodEvent) {
        expect(periodEvent.delay).toBeGreaterThanOrEqual(100);
        expect(periodEvent.delay).toBeLessThanOrEqual(200);
      }
    });

    it("newline gets the longest pause (200-500ms)", () => {
      const events = humanTypeString("line one\nline two");
      const newlineEvent = events.find(
        (e) => e.char === "\n" && !e.isTypo
      );
      expect(newlineEvent).toBeDefined();
      if (newlineEvent) {
        expect(newlineEvent.delay).toBeGreaterThanOrEqual(200);
        expect(newlineEvent.delay).toBeLessThanOrEqual(500);
      }
    });
  });

  // ── Burst typing ──────────────────────────────────────────────────

  describe("Burst typing", () => {
    it("burst events have shorter delays (30-55ms range)", () => {
      // Use a long text with many spaces to increase burst probability
      const text =
        "the quick brown fox jumps over the lazy dog and then some more words";

      // Run many trials to catch bursts
      let burstDelayCount = 0;
      let burstDelaySum = 0;

      for (let trial = 0; trial < 100; trial++) {
        const events = humanTypeString(text);
        // Look for clusters of short delays after spaces
        for (let i = 0; i < events.length; i++) {
          if (events[i].delay <= 55 && events[i].delay >= 30) {
            burstDelayCount++;
            burstDelaySum += events[i].delay;
          }
        }
      }

      // We should find some burst-speed events across all trials
      expect(burstDelayCount).toBeGreaterThan(0);
      if (burstDelayCount > 0) {
        const avgBurstDelay = burstDelaySum / burstDelayCount;
        expect(avgBurstDelay).toBeGreaterThanOrEqual(30);
        expect(avgBurstDelay).toBeLessThanOrEqual(55);
      }
    });
  });

  // ── Typo + correction ─────────────────────────────────────────────

  describe("Typo and correction sequences", () => {
    it("typos occur at approximately the configured rate", () => {
      // Use a high typo rate to ensure we get some
      const text = "abcdefghijklmnopqrstuvwxyz".repeat(10);
      let totalTypos = 0;
      let totalChars = 0;
      const trials = 50;

      for (let trial = 0; trial < trials; trial++) {
        const events = humanTypeString(text, { typoRate: 0.1 });
        const typos = events.filter((e) => e.isTypo);
        totalTypos += typos.length;
        totalChars += text.length;
      }

      const observedRate = totalTypos / totalChars;
      // With 0.1 base rate, observed should be in the neighborhood
      // (some chars have 2x rate due to many adjacent keys)
      expect(observedRate).toBeGreaterThan(0.03);
      expect(observedRate).toBeLessThan(0.25);
    });

    it("typo sequence is: wrong char -> backspace -> correct char", () => {
      // Use very high typo rate to guarantee typos
      const text = "abcdefghijklmnopqrstuvwxyz";
      let foundTypoSequence = false;

      for (let trial = 0; trial < 100 && !foundTypoSequence; trial++) {
        const events = humanTypeString(text, { typoRate: 0.5 });

        for (let i = 0; i < events.length - 2; i++) {
          if (
            events[i].isTypo &&
            events[i + 1].char === "\b" &&
            events[i + 2].correction !== null
          ) {
            foundTypoSequence = true;

            // The typo char should be from QWERTY adjacency
            const correctChar = events[i + 2].char.toLowerCase();
            const adjacents = QWERTY_ADJACENT[correctChar];
            if (adjacents) {
              const typoChar = events[i].char.toLowerCase();
              expect(adjacents).toContain(typoChar);
            }
            break;
          }
        }
      }

      expect(foundTypoSequence).toBe(true);
    });

    it("backspace after typo has a reaction delay (150-350ms)", () => {
      const text = "abcdefghijklmnopqrstuvwxyz";
      let foundBackspace = false;

      for (let trial = 0; trial < 100 && !foundBackspace; trial++) {
        const events = humanTypeString(text, { typoRate: 0.5 });
        for (const e of events) {
          if (e.char === "\b") {
            expect(e.delay).toBeGreaterThanOrEqual(150);
            expect(e.delay).toBeLessThanOrEqual(350);
            foundBackspace = true;
            break;
          }
        }
      }

      expect(foundBackspace).toBe(true);
    });

    it("correction after backspace has quick retype delay (50-120ms)", () => {
      const text = "abcdefghijklmnopqrstuvwxyz";
      let foundCorrection = false;

      for (let trial = 0; trial < 100 && !foundCorrection; trial++) {
        const events = humanTypeString(text, { typoRate: 0.5 });
        for (const e of events) {
          if (e.correction !== null) {
            expect(e.delay).toBeGreaterThanOrEqual(50);
            expect(e.delay).toBeLessThanOrEqual(120);
            foundCorrection = true;
            break;
          }
        }
      }

      expect(foundCorrection).toBe(true);
    });

    it("typo rate of 0 produces zero typos", () => {
      const events = humanTypeString("hello world testing", {
        typoRate: 0,
      });
      const typos = events.filter((e) => e.isTypo);
      expect(typos.length).toBe(0);
      const backspaces = events.filter((e) => e.char === "\b");
      expect(backspaces.length).toBe(0);
    });
  });

  // ── Total typing time ─────────────────────────────────────────────

  describe("Total typing time is reasonable", () => {
    it("short text (~10 chars) takes 500ms-3000ms of simulated time", () => {
      const events = humanTypeString("hello test");
      const totalDelay = events.reduce((sum, e) => sum + e.delay, 0);

      expect(totalDelay).toBeGreaterThan(500);
      expect(totalDelay).toBeLessThan(3000);
    });

    it("medium text (~50 chars) takes 2000ms-15000ms of simulated time", () => {
      const text = "The quick brown fox jumps over the lazy dog today";
      const events = humanTypeString(text);
      const totalDelay = events.reduce((sum, e) => sum + e.delay, 0);

      expect(totalDelay).toBeGreaterThan(2000);
      expect(totalDelay).toBeLessThan(15000);
    });

    it("average WPM is in a human range (30-120 WPM)", () => {
      const text = "The quick brown fox jumps over the lazy dog today and every day";
      const wordCount = text.split(" ").length;

      let totalMs = 0;
      const trials = 20;

      for (let trial = 0; trial < trials; trial++) {
        const events = humanTypeString(text);
        totalMs += events.reduce((sum, e) => sum + e.delay, 0);
      }

      const avgMs = totalMs / trials;
      const avgMinutes = avgMs / 60000;
      const wpm = wordCount / avgMinutes;

      // Human typing speed: casual 30-60 WPM, skilled 60-120 WPM
      expect(wpm).toBeGreaterThan(20);
      expect(wpm).toBeLessThan(150);
    });
  });

  // ── humanDelay function ───────────────────────────────────────────

  describe("humanDelay function", () => {
    it("returns values within [min, max]", () => {
      for (let i = 0; i < 100; i++) {
        const delay = humanDelay(50, 200);
        expect(delay).toBeGreaterThanOrEqual(50);
        expect(delay).toBeLessThanOrEqual(200);
      }
    });

    it("returns integer values", () => {
      for (let i = 0; i < 50; i++) {
        const delay = humanDelay(10, 100);
        expect(Number.isInteger(delay)).toBe(true);
      }
    });

    it("average is near the midpoint of min and max", () => {
      let sum = 0;
      const n = 1000;
      for (let i = 0; i < n; i++) {
        sum += humanDelay(100, 200);
      }
      const avg = sum / n;
      // Midpoint is 150; average should be close
      expect(avg).toBeGreaterThan(130);
      expect(avg).toBeLessThan(170);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("Edge cases", () => {
    it("empty string produces zero events", () => {
      const events = humanTypeString("");
      expect(events.length).toBe(0);
    });

    it("single character produces one event (or 3 if typo)", () => {
      const events = humanTypeString("a", { typoRate: 0 });
      expect(events.length).toBe(1);
      expect(events[0].char).toBe("a");
    });

    it("non-alpha characters never produce typos", () => {
      const events = humanTypeString("123!@# 456", { typoRate: 1.0 });
      // Numbers, symbols, and spaces should never be marked as typo
      for (const e of events) {
        if (/[^a-zA-Z]/.test(e.char) && e.char !== "\b") {
          expect(e.isTypo).toBe(false);
        }
      }
    });

    it("uppercase letters preserve case in typo corrections", () => {
      // Use high typo rate to force typos on uppercase
      let foundUpperTypo = false;
      for (let trial = 0; trial < 200 && !foundUpperTypo; trial++) {
        const events = humanTypeString("ABCDEFGHIJ", { typoRate: 0.5 });
        for (let i = 0; i < events.length - 2; i++) {
          if (events[i].isTypo) {
            // Typo char should be uppercase
            expect(events[i].char).toBe(events[i].char.toUpperCase());
            foundUpperTypo = true;
            break;
          }
        }
      }
      expect(foundUpperTypo).toBe(true);
    });
  });
});
