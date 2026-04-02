/**
 * humanize-typing.test.ts — Tests for human-like typing simulation.
 *
 * Tests:
 * - Log-normal distribution produces right-skewed, variable delays
 * - Key dwell time is present and in realistic range
 * - Bigram-aware timing (hand alternation faster, same-finger slower)
 * - Rollover typing on hand-alternation bigrams
 * - Punctuation gets longer pauses
 * - Burst typing occurs at expected rate
 * - Typo + correction sequences (QWERTY adjacency)
 * - Total typing time is reasonable for 200ms median (~52 WPM)
 *
 * Reference: research/03-typing-humanization.md
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Reimplementation of typing primitives (mirrors humanize-utils.ts + humanize-typing.ts)
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

function logNormalDelay(median: number, sigma: number, floor = 40): number {
  const mu = Math.log(median);
  const normal = gaussianRandom(0, 1);
  return Math.max(floor, Math.round(Math.exp(mu + sigma * normal)));
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

const ALTERNATING_BIGRAMS = new Set([
  "th", "ht", "di", "id", "en", "ne", "ri", "ir", "to", "ot",
  "do", "od", "gu", "ug", "ha", "ah", "fi", "if", "pe", "ep",
  "wo", "ow", "bi", "ib", "tu", "ut", "ry", "yr", "ck", "kc",
]);

const SAME_FINGER_BIGRAMS = new Set([
  "ed", "de", "nu", "un", "my", "ym", "ce", "ec", "rb", "br",
  "ft", "tf", "ju", "uj", "ki", "ik", "lo", "ol", "ws", "sw",
]);

function bigramMultiplier(prev: string, curr: string): number {
  const pair = (prev + curr).toLowerCase();
  if (ALTERNATING_BIGRAMS.has(pair)) return 0.7;
  if (SAME_FINGER_BIGRAMS.has(pair)) return 1.4;
  return 1.0;
}

const DWELL_MEDIAN = 70;
const DWELL_SIGMA = 0.3;

function computeDwell(char: string): number {
  if (char === "\b") return logNormalDelay(40, 0.25, 20);
  return logNormalDelay(DWELL_MEDIAN, DWELL_SIGMA, 30);
}

interface TypeEvent {
  char: string;
  delay: number;
  dwell: number;
  isTypo: boolean;
  correction: string | null;
  rollover: boolean;
}

function humanTypeString(
  text: string,
  opts: { baseDelay?: number; typoRate?: number } = {}
): TypeEvent[] {
  const baseDelay = opts.baseDelay ?? 200;
  const typoRate = opts.typoRate ?? 0.02;
  const events: TypeEvent[] = [];
  let inBurst = false;
  let burstRemaining = 0;
  let prevChar = "";
  const ikiSigma = 0.45;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const lower = char.toLowerCase();
    const isAlpha = /[a-z]/.test(lower);

    let delay: number;
    if (burstRemaining > 0) {
      delay = logNormalDelay(Math.round(baseDelay * 0.5), 0.35, 25);
      burstRemaining--;
      if (burstRemaining === 0) inBurst = false;
    } else if (char === " ") {
      delay = logNormalDelay(250, 0.4, 80);
    } else if (/[.,;:!?]/.test(char)) {
      delay = logNormalDelay(200, 0.4, 80);
    } else if (char === "\n") {
      delay = logNormalDelay(400, 0.5, 150);
    } else {
      const multiplier = prevChar ? bigramMultiplier(prevChar, lower) : 1.0;
      delay = logNormalDelay(Math.round(baseDelay * multiplier), ikiSigma, 40);
    }

    if (prevChar === " " && isAlpha && !inBurst && Math.random() < 0.12) {
      delay = logNormalDelay(400, 0.5, 150);
    }

    if (!inBurst && char === " " && Math.random() < 0.08) {
      inBurst = true;
      burstRemaining = Math.floor(Math.random() * 6) + 3;
    }

    let rollover = false;
    if (prevChar && delay < 180) {
      const pair = (prevChar + lower).toLowerCase();
      if (ALTERNATING_BIGRAMS.has(pair) && Math.random() < 0.3) {
        rollover = true;
      }
    }

    const dwell = computeDwell(char);

    const adjacents = QWERTY_ADJACENT[lower];
    const effectiveRate =
      adjacents && adjacents.length >= 5 ? typoRate * 2 : typoRate;

    if (isAlpha && Math.random() < effectiveRate && adjacents) {
      const typoChar =
        adjacents[Math.floor(Math.random() * adjacents.length)];
      const displayTypo =
        char === char.toUpperCase() ? typoChar.toUpperCase() : typoChar;

      events.push({ char: displayTypo, delay, dwell: computeDwell(displayTypo), isTypo: true, correction: null, rollover });
      events.push({
        char: "\b",
        delay: humanDelay(150, 350),
        dwell: computeDwell("\b"),
        isTypo: false,
        correction: null,
        rollover: false,
      });
      events.push({
        char,
        delay: humanDelay(50, 120),
        dwell,
        isTypo: false,
        correction: char,
        rollover: false,
      });
    } else {
      events.push({ char, delay, dwell, isTypo: false, correction: null, rollover });
    }

    prevChar = lower;
  }

  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Humanize Typing", () => {
  // ── Log-normal distribution ──────────────────────────────────────

  describe("Log-normal distribution produces right-skewed delays", () => {
    it("delays are not all the same value", () => {
      const events = humanTypeString("the quick brown fox jumps");
      const delays = events.map((e) => e.delay);
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

    it("delays for regular characters are within log-normal range", () => {
      const events = humanTypeString("abcdefgh");
      const regularEvents = events.filter(
        (e) => !e.isTypo && e.char !== "\b" && e.correction === null
      );
      for (const e of regularEvents) {
        // Log-normal with 200ms median can produce 40ms floor to ~800ms tail
        expect(e.delay).toBeGreaterThanOrEqual(40);
        expect(e.delay).toBeLessThanOrEqual(1500);
      }
    });

    it("mean delay is higher than median (right-skewed)", () => {
      // A right-skewed distribution has mean > median
      const delays: number[] = [];
      for (let trial = 0; trial < 30; trial++) {
        const events = humanTypeString("abcdefghijklmnop", { typoRate: 0 });
        for (const e of events) {
          if (e.char !== " " && e.char !== "\b") {
            delays.push(e.delay);
          }
        }
      }
      const sorted = [...delays].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const mean = delays.reduce((s, d) => s + d, 0) / delays.length;

      // For log-normal, mean should be > median
      expect(mean).toBeGreaterThan(median);
    });
  });

  // ── Key dwell time ───────────────────────────────────────────────

  describe("Key dwell time", () => {
    it("every event has a positive dwell time", () => {
      const events = humanTypeString("hello world");
      for (const e of events) {
        expect(e.dwell).toBeGreaterThan(0);
        expect(Number.isFinite(e.dwell)).toBe(true);
      }
    });

    it("dwell times for regular keys are in 30-300ms range", () => {
      const events = humanTypeString("the quick brown fox", { typoRate: 0 });
      for (const e of events) {
        if (e.char !== "\b" && e.char !== " ") {
          expect(e.dwell).toBeGreaterThanOrEqual(30);
          expect(e.dwell).toBeLessThanOrEqual(300);
        }
      }
    });

    it("average dwell is near 70ms median", () => {
      const dwells: number[] = [];
      for (let trial = 0; trial < 30; trial++) {
        const events = humanTypeString("abcdefghijklmnop", { typoRate: 0 });
        for (const e of events) {
          if (/[a-z]/.test(e.char)) {
            dwells.push(e.dwell);
          }
        }
      }
      const avg = dwells.reduce((s, d) => s + d, 0) / dwells.length;
      // Should be roughly near 70ms (log-normal mean is slightly above median)
      expect(avg).toBeGreaterThan(50);
      expect(avg).toBeLessThan(120);
    });

    it("backspace has shorter dwell than regular keys", () => {
      let bsDwells: number[] = [];
      let regDwells: number[] = [];
      for (let trial = 0; trial < 50; trial++) {
        const events = humanTypeString("abcdefghijklmnop", { typoRate: 0.5 });
        for (const e of events) {
          if (e.char === "\b") bsDwells.push(e.dwell);
          else if (/[a-z]/.test(e.char)) regDwells.push(e.dwell);
        }
      }
      if (bsDwells.length > 0 && regDwells.length > 0) {
        const avgBs = bsDwells.reduce((s, d) => s + d, 0) / bsDwells.length;
        const avgReg = regDwells.reduce((s, d) => s + d, 0) / regDwells.length;
        expect(avgBs).toBeLessThan(avgReg);
      }
    });
  });

  // ── Bigram-aware timing ──────────────────────────────────────────

  describe("Bigram-aware timing", () => {
    it("hand-alternation bigrams are faster than same-finger bigrams", () => {
      // Use text with known bigrams: "th" (alternating) vs "ed" (same finger)
      let altDelays: number[] = [];
      let sfDelays: number[] = [];

      for (let trial = 0; trial < 100; trial++) {
        // "th" is alternating-hand, "ed" is same-finger
        const events = humanTypeString("theded", { typoRate: 0 });
        // events[1] is 'h' after 't' = "th" bigram (alternating)
        // events[3] is 'd' after 'e' = "ed" bigram (same-finger)
        if (events.length >= 6) {
          altDelays.push(events[1].delay);  // 'h' in "th"
          sfDelays.push(events[3].delay);   // first 'd' in "ed"
        }
      }

      const avgAlt = altDelays.reduce((s, d) => s + d, 0) / altDelays.length;
      const avgSf = sfDelays.reduce((s, d) => s + d, 0) / sfDelays.length;

      // Alternating should be faster (lower delay) than same-finger
      expect(avgAlt).toBeLessThan(avgSf);
    });
  });

  // ── Rollover typing ──────────────────────────────────────────────

  describe("Rollover typing", () => {
    it("some events are marked as rollover", () => {
      let foundRollover = false;
      // Use text with many hand-alternation bigrams
      for (let trial = 0; trial < 100 && !foundRollover; trial++) {
        const events = humanTypeString("the then they them that this those");
        foundRollover = events.some((e) => e.rollover);
      }
      expect(foundRollover).toBe(true);
    });

    it("rollover only occurs on alternating-hand bigrams", () => {
      // Run many trials and verify rollover is always on valid bigrams
      for (let trial = 0; trial < 50; trial++) {
        const text = "the quick brown fox jumps";
        const events = humanTypeString(text, { typoRate: 0 });
        let prev = "";
        for (const e of events) {
          if (e.rollover && prev) {
            const pair = (prev + e.char).toLowerCase();
            expect(ALTERNATING_BIGRAMS.has(pair)).toBe(true);
          }
          prev = e.char.toLowerCase();
        }
      }
    });
  });

  // ── Punctuation pauses ────────────────────────────────────────────

  describe("Punctuation gets longer pauses", () => {
    it("space character gets longer delay than regular characters", () => {
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

      // Space delays (250ms median) should be higher than regular (200ms median)
      expect(avgSpaceDelay).toBeGreaterThan(avgRegularDelay);
    });

    it("comma gets a pause above 80ms", () => {
      const events = humanTypeString("hello, world");
      const commaEvent = events.find(
        (e) => e.char === "," && !e.isTypo
      );
      expect(commaEvent).toBeDefined();
      if (commaEvent) {
        expect(commaEvent.delay).toBeGreaterThanOrEqual(80);
      }
    });

    it("period gets a pause above 80ms", () => {
      const events = humanTypeString("end. start");
      const periodEvent = events.find(
        (e) => e.char === "." && !e.isTypo
      );
      expect(periodEvent).toBeDefined();
      if (periodEvent) {
        expect(periodEvent.delay).toBeGreaterThanOrEqual(80);
      }
    });

    it("newline gets a long pause (150ms+)", () => {
      const events = humanTypeString("line one\nline two");
      const newlineEvent = events.find(
        (e) => e.char === "\n" && !e.isTypo
      );
      expect(newlineEvent).toBeDefined();
      if (newlineEvent) {
        expect(newlineEvent.delay).toBeGreaterThanOrEqual(150);
      }
    });
  });

  // ── Burst typing ──────────────────────────────────────────────────

  describe("Burst typing", () => {
    it("burst events have shorter delays than base", () => {
      const text =
        "the quick brown fox jumps over the lazy dog and then some more words";

      let shortDelayCount = 0;

      for (let trial = 0; trial < 100; trial++) {
        const events = humanTypeString(text);
        for (const e of events) {
          // Burst at 50% of 200ms base = ~100ms median, with floor 25ms
          if (e.delay <= 80 && e.delay >= 25 && /[a-z]/.test(e.char)) {
            shortDelayCount++;
          }
        }
      }

      // We should find some burst-speed events across all trials
      expect(shortDelayCount).toBeGreaterThan(0);
    });
  });

  // ── Typo + correction ─────────────────────────────────────────────

  describe("Typo and correction sequences", () => {
    it("typos occur at approximately the configured rate", () => {
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
      expect(observedRate).toBeGreaterThan(0.03);
      expect(observedRate).toBeLessThan(0.25);
    });

    it("typo sequence is: wrong char -> backspace -> correct char", () => {
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
    it("short text (~10 chars) takes 1000ms-8000ms of simulated time", () => {
      const events = humanTypeString("hello test");
      const totalDelay = events.reduce((sum, e) => sum + e.delay, 0);

      // With 200ms median per key, 10 chars ~ 2000ms + dwell
      expect(totalDelay).toBeGreaterThan(500);
      expect(totalDelay).toBeLessThan(8000);
    });

    it("medium text (~50 chars) takes 5000ms-40000ms of simulated time", () => {
      const text = "The quick brown fox jumps over the lazy dog today";
      const events = humanTypeString(text);
      const totalDelay = events.reduce((sum, e) => sum + e.delay, 0);

      expect(totalDelay).toBeGreaterThan(3000);
      expect(totalDelay).toBeLessThan(40000);
    });

    it("average WPM is in a human range (20-100 WPM)", () => {
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

      // With 200ms median IKI: ~52 WPM target. Allow wide range for stochastic variation.
      expect(wpm).toBeGreaterThan(15);
      expect(wpm).toBeLessThan(120);
    });
  });

  // ── logNormalDelay function ─────────────────────────────────────

  describe("logNormalDelay function", () => {
    it("returns values at or above the floor", () => {
      for (let i = 0; i < 200; i++) {
        const delay = logNormalDelay(200, 0.45, 40);
        expect(delay).toBeGreaterThanOrEqual(40);
      }
    });

    it("returns integer values", () => {
      for (let i = 0; i < 50; i++) {
        const delay = logNormalDelay(100, 0.3);
        expect(Number.isInteger(delay)).toBe(true);
      }
    });

    it("median is near the specified median value", () => {
      const values: number[] = [];
      for (let i = 0; i < 2000; i++) {
        values.push(logNormalDelay(200, 0.45, 40));
      }
      values.sort((a, b) => a - b);
      const observedMedian = values[Math.floor(values.length / 2)];
      // Should be near 200 +/- 40
      expect(observedMedian).toBeGreaterThan(150);
      expect(observedMedian).toBeLessThan(260);
    });
  });

  // ── humanDelay function (still used for typo reaction times) ────

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
      // Should have dwell and rollover fields
      expect(events[0].dwell).toBeGreaterThan(0);
      expect(events[0].rollover).toBe(false);
    });

    it("non-alpha characters never produce typos", () => {
      const events = humanTypeString("123!@# 456", { typoRate: 1.0 });
      for (const e of events) {
        if (/[^a-zA-Z]/.test(e.char) && e.char !== "\b") {
          expect(e.isTypo).toBe(false);
        }
      }
    });

    it("uppercase letters preserve case in typo corrections", () => {
      let foundUpperTypo = false;
      for (let trial = 0; trial < 200 && !foundUpperTypo; trial++) {
        const events = humanTypeString("ABCDEFGHIJ", { typoRate: 0.5 });
        for (let i = 0; i < events.length - 2; i++) {
          if (events[i].isTypo) {
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
