// ─── Humanized Mouse Movement ──────────────────────────────────────────────
//
// Bezier curve mouse paths with Fitts's Law timing, asymmetric velocity
// profile, overshoot/correction, per-session motor profiles, micro-tremor
// jitter, and idle cursor drift.
//
// Integration point: import { humanMouse } from "./humanize-mouse.js"
// then call humanMouse.moveTo(page, x, y) or humanMouse.humanClick(page, x, y)
// inside the act tool handler (src/index.ts) before Playwright actions.
//
// Standalone module — no cross-dependencies on other humanize modules.

import type { Page } from "playwright-core";
import { gaussianRandom, clamp, humanDelay, sleep, isHumanizeEnabled } from "./humanize-utils.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface PathPoint extends Point {
  /** Bezier parameter t in [0, 1] */
  t: number;
}

/**
 * Per-session motor profile. Generated randomly at class instantiation
 * or via setProfile(). Modulates Fitts's Law constants, tremor magnitude,
 * overshoot probability, and pause timing to give each session a
 * consistent "personality" (some users are jittery, some are smooth).
 */
export interface MotorProfile {
  /** Multiplier on Fitts's Law base time (0.7 = fast, 1.3 = slow). */
  baseSpeed: number;
  /** Multiplier on micro-tremor stddev (0.5 = steady, 2.0 = shaky). */
  tremor: number;
  /** Multiplier on overshoot probability (0.5 = precise, 1.5 = sloppy). */
  overshootTendency: number;
  /** Multiplier on dwell/pause durations (0.8 = impatient, 1.4 = deliberate). */
  pauseMultiplier: number;
}

// ─── Motor Profile Generator ──────────────────────────────────────────────

/**
 * Generate a random motor profile. Each axis is drawn from a Gaussian
 * centered at 1.0 so most sessions feel "average" with occasional outliers.
 */
export function generateMotorProfile(): MotorProfile {
  return {
    baseSpeed: clamp(gaussianRandom(1.0, 0.15), 0.6, 1.5),
    tremor: clamp(gaussianRandom(1.0, 0.3), 0.3, 2.5),
    overshootTendency: clamp(gaussianRandom(1.0, 0.25), 0.3, 2.0),
    pauseMultiplier: clamp(gaussianRandom(1.0, 0.15), 0.6, 1.6),
  };
}

// ─── Bezier Math ───────────────────────────────────────────────────────────

/**
 * Evaluate a cubic Bezier curve at parameter t.
 * B(t) = (1-t)^3*P0 + 3*(1-t)^2*t*P1 + 3*(1-t)*t^2*P2 + t^3*P3
 */
export function bezierPoint(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Asymmetric ease parameterization: 40% acceleration / 60% deceleration.
 * Human deceleration is longer than acceleration due to corrective
 * submovements near the target (Woodworth 1899, Elliott et al. 2001).
 *
 * - t in [0, 0.4]: quadratic ease-in  (accelerating)
 * - t in [0.4, 1]: quadratic ease-out (decelerating, stretched over 60%)
 *
 * Returns a value in [0, 1] that maps linearly-spaced t to non-uniform
 * Bezier parameter values.
 */
function asymmetricEase(linearT: number): number {
  if (linearT <= 0.4) {
    // Ease-in: normalize to [0,1] within the accel phase, quadratic ramp-up
    const phase = linearT / 0.4; // 0..1
    // At phase=1, output should be 0.5 (halfway through curve)
    return 0.5 * phase * phase;
  } else {
    // Ease-out: normalize to [0,1] within the decel phase, quadratic ramp-down
    const phase = (linearT - 0.4) / 0.6; // 0..1
    // At phase=0 output=0.5, at phase=1 output=1.0
    return 0.5 + 0.5 * (1 - (1 - phase) * (1 - phase));
  }
}

/**
 * Generate a human-like mouse path between two points using a cubic Bezier curve.
 * Control points are randomly offset to simulate the natural arc of hand movement.
 * Point spacing is non-uniform — uses asymmetric 40/60 velocity profile.
 *
 * Incorporates Fitts's Law: movement time scales with log2(distance/width + 1),
 * so the number of steps increases for longer distances.
 *
 * @param start - Starting coordinates
 * @param end - Ending coordinates
 * @param steps - Number of intermediate points (0 = auto via Fitts's Law)
 * @param profile - Optional motor profile for per-session variation
 * @returns Array of path points with parameter t
 */
export function generateBezierPath(
  start: Point,
  end: Point,
  steps = 0,
  profile?: MotorProfile,
): PathPoint[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const speedMul = profile?.baseSpeed ?? 1.0;
  const tremorMul = profile?.tremor ?? 1.0;

  // Fitts's Law: time = a + b * log2(distance / width + 1)
  // We use this to auto-scale the number of steps for realism.
  if (steps <= 0) {
    const fittsTime = (150 + 120 * Math.log2(distance / 10 + 1)) * speedMul; // ms
    steps = Math.max(10, Math.round(fittsTime / 8)); // ~8ms per step (125 fps)
  }

  // Generate control points with random lateral offset (perpendicular to the line).
  // Offset magnitude is proportional to distance but capped for short moves.
  const spread = clamp(distance * 0.3, 20, 300);
  const angle = Math.atan2(dy, dx);
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);

  const offset1 = gaussianRandom(0, spread);
  const offset2 = gaussianRandom(0, spread);

  const p1: Point = {
    x: start.x + dx * 0.25 + perpX * offset1,
    y: start.y + dy * 0.25 + perpY * offset1,
  };
  const p2: Point = {
    x: start.x + dx * 0.75 + perpX * offset2,
    y: start.y + dy * 0.75 + perpY * offset2,
  };

  const path: PathPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    // Asymmetric velocity profile: 40% accel, 60% decel
    const linearT = i / steps;
    const easedT = asymmetricEase(linearT);

    const pt = bezierPoint(easedT, start, p1, p2, end);
    path.push({
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      t: Math.round(easedT * 1000) / 1000,
    });
  }

  // Add small jitter to intermediate points (micro-tremor simulation)
  const tremorStddev = 0.8 * tremorMul;
  for (let i = 1; i < path.length - 1; i++) {
    path[i].x += gaussianRandom(0, tremorStddev);
    path[i].y += gaussianRandom(0, tremorStddev);
    path[i].x = Math.round(path[i].x * 10) / 10;
    path[i].y = Math.round(path[i].y * 10) / 10;
  }

  return path;
}

// ─── Overshoot Logic ──────────────────────────────────────────────────────

/**
 * Determine whether an overshoot should occur based on movement distance,
 * and generate the overshoot + correction path if so.
 *
 * Overshoot probabilities (before overshootTendency multiplier):
 * - Distance < 100px:   10%
 * - Distance 100-400px: 25%
 * - Distance > 400px:   40%
 *
 * Overshoot amplitude: 5-15px past target along the approach direction.
 * Correction movement: 3-5x slower than approach speed.
 */
function generateOvershoot(
  target: Point,
  approachAngle: number,
  distance: number,
  profile?: MotorProfile,
): { overshootPath: PathPoint[]; correctionPath: PathPoint[] } | null {
  // Determine probability
  let baseProbability: number;
  if (distance < 100) baseProbability = 0.10;
  else if (distance <= 400) baseProbability = 0.25;
  else baseProbability = 0.40;

  const probability = clamp(baseProbability * (profile?.overshootTendency ?? 1.0), 0, 0.95);

  if (Math.random() > probability) return null;

  // Overshoot amplitude: 5-15px past target along the approach direction
  const amplitude = 5 + Math.random() * 10;
  const overshootPoint: Point = {
    x: target.x + Math.cos(approachAngle) * amplitude,
    y: target.y + Math.sin(approachAngle) * amplitude,
  };

  // Generate a short overshoot path (few steps, quick)
  const overshootPath = generateBezierPath(target, overshootPoint, 5, profile);

  // Correction path back to target: 3-5x more steps (slower)
  const correctionSlowdown = 3 + Math.random() * 2;
  const correctionSteps = Math.round(5 * correctionSlowdown);
  const correctionPath = generateBezierPath(overshootPoint, target, correctionSteps, profile);

  return { overshootPath, correctionPath };
}

// ─── HumanMouse Class ──────────────────────────────────────────────────────

export class HumanMouse {
  /** Tracks the last known cursor position. Initialized lazily to a random viewport position. */
  private lastPosition: Point | null = null;

  /** Per-session motor profile for consistent behavioral fingerprint. */
  private profile: MotorProfile;

  /** Timer handle for idle drift. */
  private idleDriftTimer: ReturnType<typeof setInterval> | null = null;

  /** Timestamp of last cursor movement (for idle drift threshold). */
  private lastMoveTime = 0;

  constructor() {
    this.profile = generateMotorProfile();
  }

  /**
   * Whether humanized mouse movement is enabled.
   * Returns false unless LEAP_HUMANIZE=true or LEAP_HUMANIZE=1 is set.
   */
  isEnabled(): boolean {
    return isHumanizeEnabled();
  }

  /**
   * Replace the current motor profile with a new random one.
   * Call this at session rotation boundaries to vary behavior.
   */
  setProfile(profile?: MotorProfile): void {
    this.profile = profile ?? generateMotorProfile();
  }

  /** Get the current motor profile (for inspection/testing). */
  getProfile(): MotorProfile {
    return { ...this.profile };
  }

  /**
   * Get the current cursor position. On first call, initializes to a
   * random position within a plausible viewport region (avoids the (0,0)
   * origin which is a known bot fingerprint).
   */
  private getStartPosition(): Point {
    if (!this.lastPosition) {
      this.lastPosition = {
        x: 400 + Math.random() * 400,  // 400-800
        y: 300 + Math.random() * 200,  // 300-500
      };
    }
    return this.lastPosition;
  }

  /**
   * Move the mouse along a human-like Bezier path to the target coordinates.
   * Each step along the path is dispatched as a CDP mousemove event with a
   * small inter-step delay to simulate real hand speed.
   *
   * Uses asymmetric 40/60 velocity profile, per-session motor profile,
   * and probabilistic overshoot with correction.
   *
   * No-op if humanization is disabled.
   */
  async moveTo(page: Page, x: number, y: number): Promise<void> {
    if (!this.isEnabled()) return;

    const start = this.getStartPosition();
    const end: Point = { x, y };

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const approachAngle = Math.atan2(dy, dx);

    // Main movement path
    const path = generateBezierPath(start, end, 0, this.profile);

    for (const pt of path) {
      await page.mouse.move(pt.x, pt.y);
      // ~8ms inter-step for natural pacing (matching 125fps assumption)
      await sleep(humanDelay(4, 12));
    }

    // Probabilistic overshoot + correction
    const overshoot = generateOvershoot(end, approachAngle, distance, this.profile);
    if (overshoot) {
      // Overshoot: move past the target
      for (const pt of overshoot.overshootPath) {
        await page.mouse.move(pt.x, pt.y);
        await sleep(humanDelay(4, 12));
      }
      // Correction: move back to target, 3-5x slower
      const correctionDelay = humanDelay(4, 12) * (3 + Math.random() * 2);
      for (const pt of overshoot.correctionPath) {
        await page.mouse.move(pt.x, pt.y);
        await sleep(correctionDelay);
      }
    }

    // Update last known position
    this.lastPosition = { x, y };
    this.lastMoveTime = Date.now();
  }

  /**
   * Move the mouse to the target, pause briefly (hover dwell), then click.
   * Simulates real human behavior: approach -> dwell -> click.
   *
   * No-op if humanization is disabled — falls through to normal click.
   */
  async humanClick(page: Page, x: number, y: number): Promise<void> {
    if (!this.isEnabled()) return;

    await this.moveTo(page, x, y);

    // Hover dwell: humans pause 50-200ms before clicking, modulated by motor profile
    const dwellMin = Math.round(50 * this.profile.pauseMultiplier);
    const dwellMax = Math.round(200 * this.profile.pauseMultiplier);
    await sleep(humanDelay(dwellMin, dwellMax));

    await page.mouse.click(x, y);

    // Update position after click
    this.lastPosition = { x, y };
    this.lastMoveTime = Date.now();
  }

  /**
   * Start idle cursor drift on a page. When the cursor has been parked
   * for >500ms, applies sine-wave-based micro-movements of +/-2.5px at
   * ~60Hz to prevent the "perfectly still cursor" signal that bot
   * detectors like DataDome look for.
   *
   * Uses a sum of sine waves at irrational frequency ratios to produce
   * Perlin-noise-like organic movement without requiring a full noise
   * library.
   *
   * Limitation: requires a Page reference and runs on an interval.
   * Call stopIdleDrift() when the page/session is destroyed.
   *
   * @param page - Playwright page instance to emit mouse events on
   */
  startIdleDrift(page: Page): void {
    if (this.idleDriftTimer) return; // already running

    const startTime = Date.now();

    this.idleDriftTimer = setInterval(async () => {
      // Only drift if cursor has been idle for >500ms
      if (Date.now() - this.lastMoveTime < 500) return;

      const pos = this.getStartPosition();
      const elapsed = (Date.now() - startTime) / 1000; // seconds

      // Sum of sine waves at irrational frequency ratios for organic motion.
      // Frequencies chosen so they don't produce repeating patterns.
      const driftX =
        Math.sin(elapsed * 1.17) * 1.2 +
        Math.sin(elapsed * 2.73) * 0.8 +
        Math.sin(elapsed * 0.41) * 0.5;
      const driftY =
        Math.sin(elapsed * 0.93) * 1.1 +
        Math.sin(elapsed * 2.19) * 0.9 +
        Math.sin(elapsed * 0.57) * 0.5;

      // Scale by motor profile tremor (shakier profiles = more drift)
      const scale = this.profile.tremor;
      const newX = pos.x + driftX * scale;
      const newY = pos.y + driftY * scale;

      try {
        await page.mouse.move(newX, newY);
      } catch {
        // Page may be closed — silently stop drift
        this.stopIdleDrift();
      }
    }, 16); // ~60Hz
  }

  /**
   * Stop idle cursor drift and clean up the interval timer.
   */
  stopIdleDrift(): void {
    if (this.idleDriftTimer) {
      clearInterval(this.idleDriftTimer);
      this.idleDriftTimer = null;
    }
  }
}

export const humanMouse = new HumanMouse();
export default humanMouse;
