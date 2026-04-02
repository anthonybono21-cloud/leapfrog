// ─── Humanize Shared Utilities ─────────────────────────────────────────────
//
// Pure math primitives shared across all humanize-* modules.
// Zero external dependencies. All distributions are self-contained.
//
// Standalone module — no cross-dependencies on other leapfrog modules.

/**
 * Generate a normally-distributed random number using the Box-Muller transform.
 * @param mean - Center of the distribution
 * @param stddev - Standard deviation
 * @returns A sample from N(mean, stddev^2)
 */
export function gaussianRandom(mean = 0, stddev = 1): number {
  let u: number, v: number, s: number;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  return mean + stddev * u * mul;
}

/**
 * Clamp a value between min and max.
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Generate a human-like delay (in ms) drawn from a Gaussian distribution.
 * The result is clamped to [min, max] so it never produces absurd values.
 *
 * @param min - Minimum delay in ms
 * @param max - Maximum delay in ms
 * @returns Delay in ms, Gaussian-distributed around the midpoint
 */
export function humanDelay(min = 50, max = 200): number {
  const mean = (min + max) / 2;
  const stddev = (max - min) / 6; // 99.7% of values fall within [min, max]
  return Math.round(clamp(gaussianRandom(mean, stddev), min, max));
}

/**
 * Sleep for the specified number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check whether the LEAP_HUMANIZE env var is enabled.
 * Returns false unless LEAP_HUMANIZE is explicitly set to "true" or "1".
 */
export function isHumanizeEnabled(): boolean {
  const val = process.env.LEAP_HUMANIZE;
  return val === "true" || val === "1";
}
