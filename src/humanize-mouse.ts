// ─── Humanized Mouse Movement ──────────────────────────────────────────────
//
// Bezier curve mouse paths with Fitts's Law timing, ease-in-out
// parameterization, and micro-tremor jitter. Ported from the validated
// humanize.js prototype (tested on 3090 box, statistically verified).
//
// Integration point: import { humanMouse } from "./humanize-mouse.js"
// then call humanMouse.moveTo(page, x, y) or humanMouse.humanClick(page, x, y)
// inside the act tool handler (src/index.ts) before Playwright actions.
//
// Standalone module — no cross-dependencies on other humanize modules.

import type { Page } from "playwright";
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
 * Generate a human-like mouse path between two points using a cubic Bezier curve.
 * Control points are randomly offset to simulate the natural arc of hand movement.
 * Point spacing is non-uniform — denser near start and end (ease-in-out).
 *
 * Incorporates Fitts's Law: movement time scales with log2(distance/width + 1),
 * so the number of steps increases for longer distances.
 *
 * @param start - Starting coordinates
 * @param end - Ending coordinates
 * @param steps - Number of intermediate points (0 = auto via Fitts's Law)
 * @returns Array of path points with parameter t
 */
export function generateBezierPath(start: Point, end: Point, steps = 0): PathPoint[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Fitts's Law: time = a + b * log2(distance / width + 1)
  // We use this to auto-scale the number of steps for realism.
  if (steps <= 0) {
    const fittsTime = 150 + 120 * Math.log2(distance / 10 + 1); // ms
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
    // Ease-in-out parameterization: slow at start and end, fast in middle
    const linearT = i / steps;
    const easedT = linearT < 0.5
      ? 2 * linearT * linearT
      : 1 - 2 * (1 - linearT) * (1 - linearT);

    const pt = bezierPoint(easedT, start, p1, p2, end);
    path.push({
      x: Math.round(pt.x * 10) / 10,
      y: Math.round(pt.y * 10) / 10,
      t: Math.round(easedT * 1000) / 1000,
    });
  }

  // Add small jitter to intermediate points (micro-tremor simulation)
  for (let i = 1; i < path.length - 1; i++) {
    path[i].x += gaussianRandom(0, 0.8);
    path[i].y += gaussianRandom(0, 0.8);
    path[i].x = Math.round(path[i].x * 10) / 10;
    path[i].y = Math.round(path[i].y * 10) / 10;
  }

  return path;
}

// ─── HumanMouse Class ──────────────────────────────────────────────────────

export class HumanMouse {
  /**
   * Whether humanized mouse movement is enabled.
   * Returns false unless LEAP_HUMANIZE=true or LEAP_HUMANIZE=1 is set.
   */
  isEnabled(): boolean {
    return isHumanizeEnabled();
  }

  /**
   * Move the mouse along a human-like Bezier path to the target coordinates.
   * Each step along the path is dispatched as a CDP mousemove event with a
   * small inter-step delay to simulate real hand speed.
   *
   * No-op if humanization is disabled.
   */
  async moveTo(page: Page, x: number, y: number): Promise<void> {
    if (!this.isEnabled()) return;

    // Get current mouse position via CDP (defaults to 0,0 if unknown)
    const start: Point = { x: 0, y: 0 };
    const end: Point = { x, y };

    const path = generateBezierPath(start, end);

    for (const pt of path) {
      await page.mouse.move(pt.x, pt.y);
      // ~8ms inter-step for natural pacing (matching 125fps assumption)
      await sleep(humanDelay(4, 12));
    }
  }

  /**
   * Move the mouse to the target, pause briefly (hover dwell), then click.
   * Simulates real human behavior: approach → dwell → click.
   *
   * No-op if humanization is disabled — falls through to normal click.
   */
  async humanClick(page: Page, x: number, y: number): Promise<void> {
    if (!this.isEnabled()) return;

    await this.moveTo(page, x, y);

    // Hover dwell: humans pause 50-200ms before clicking
    await sleep(humanDelay(50, 200));

    await page.mouse.click(x, y);
  }
}

export const humanMouse = new HumanMouse();
export default humanMouse;
