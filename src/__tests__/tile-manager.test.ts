import { describe, it, expect, beforeEach } from "vitest";
import { TileManager } from "../tile-manager.js";

// ─── Unit Tests for Window Tiling ──────────────────────────────────────────
//
// Pure grid math — no browser needed.
// Integration tests with real CDP are in tile-integration.test.ts (optional).

describe("TileManager", () => {
  // ── calculateGrid ──────────────────────────────────────────────────

  describe("calculateGrid", () => {
    it("returns 1x1 for 0 or 1 window", () => {
      expect(TileManager.calculateGrid(0)).toEqual({ cols: 1, rows: 1 });
      expect(TileManager.calculateGrid(1)).toEqual({ cols: 1, rows: 1 });
    });

    it("returns 2x1 for 2 windows", () => {
      expect(TileManager.calculateGrid(2)).toEqual({ cols: 2, rows: 1 });
    });

    it("returns 3x1 for 3 windows (no wasted slot)", () => {
      expect(TileManager.calculateGrid(3)).toEqual({ cols: 3, rows: 1 });
    });

    it("returns 2x2 for 4 windows", () => {
      expect(TileManager.calculateGrid(4)).toEqual({ cols: 2, rows: 2 });
    });

    it("returns 3x2 for 5-6 windows", () => {
      expect(TileManager.calculateGrid(5)).toEqual({ cols: 3, rows: 2 });
      expect(TileManager.calculateGrid(6)).toEqual({ cols: 3, rows: 2 });
    });

    it("returns 3x3 for 7-9 windows", () => {
      expect(TileManager.calculateGrid(7)).toEqual({ cols: 3, rows: 3 });
      expect(TileManager.calculateGrid(9)).toEqual({ cols: 3, rows: 3 });
    });

    it("returns 4x3 for 10-12 windows", () => {
      expect(TileManager.calculateGrid(10)).toEqual({ cols: 4, rows: 3 });
      expect(TileManager.calculateGrid(12)).toEqual({ cols: 4, rows: 3 });
    });
  });

  // ── getTileBounds (grid layout) ────────────────────────────────────

  describe("getTileBounds (grid)", () => {
    const screen = { width: 1920, height: 1080 };
    const padding = 0; // no padding for simple math

    it("single window fills the screen", () => {
      const bounds = TileManager.getTileBounds(0, 1, screen, padding);
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
      expect(bounds.width).toBe(1920);
      expect(bounds.height).toBe(1080);
    });

    it("2 windows side by side", () => {
      const left = TileManager.getTileBounds(0, 2, screen, padding);
      const right = TileManager.getTileBounds(1, 2, screen, padding);

      expect(left.x).toBe(0);
      expect(left.width).toBe(960);
      expect(right.x).toBe(960);
      expect(right.width).toBe(960);
      // Both full height
      expect(left.height).toBe(1080);
      expect(right.height).toBe(1080);
    });

    it("4 windows in 2x2 grid", () => {
      const tl = TileManager.getTileBounds(0, 4, screen, padding);
      const tr = TileManager.getTileBounds(1, 4, screen, padding);
      const bl = TileManager.getTileBounds(2, 4, screen, padding);
      const br = TileManager.getTileBounds(3, 4, screen, padding);

      // Top row
      expect(tl).toEqual({ x: 0, y: 0, width: 960, height: 540 });
      expect(tr).toEqual({ x: 960, y: 0, width: 960, height: 540 });
      // Bottom row
      expect(bl).toEqual({ x: 0, y: 540, width: 960, height: 540 });
      expect(br).toEqual({ x: 960, y: 540, width: 960, height: 540 });
    });

    it("tiles don't overlap for 6 windows", () => {
      const tiles = Array.from({ length: 6 }, (_, i) =>
        TileManager.getTileBounds(i, 6, screen, padding),
      );

      // Check no overlap: for each pair, either horizontal or vertical separation
      for (let i = 0; i < tiles.length; i++) {
        for (let j = i + 1; j < tiles.length; j++) {
          const a = tiles[i];
          const b = tiles[j];
          const noOverlap =
            a.x + a.width <= b.x ||
            b.x + b.width <= a.x ||
            a.y + a.height <= b.y ||
            b.y + b.height <= a.y;
          expect(noOverlap).toBe(true);
        }
      }
    });
  });

  // ── getTileBounds with padding ─────────────────────────────────────

  describe("getTileBounds with padding", () => {
    const screen = { width: 1920, height: 1080 };
    const padding = 10;

    it("single window has padding on all sides", () => {
      const bounds = TileManager.getTileBounds(0, 1, screen, padding);
      expect(bounds.x).toBe(10); // left padding
      expect(bounds.y).toBe(10); // top padding
      // Width = (1920 - 10*2) / 1 = 1900
      expect(bounds.width).toBe(1900);
      expect(bounds.height).toBe(1060);
    });

    it("2 windows have gaps between them", () => {
      const left = TileManager.getTileBounds(0, 2, screen, padding);
      const right = TileManager.getTileBounds(1, 2, screen, padding);

      // left.x + left.width < right.x (gap between them)
      expect(right.x - (left.x + left.width)).toBe(padding);
    });
  });

  // ── getTileBounds (master-stack layout) ────────────────────────────

  describe("getTileBounds (master-stack)", () => {
    const screen = { width: 1920, height: 1080 };
    const padding = 0;

    it("primary window gets 60% width, full height", () => {
      const primary = TileManager.getTileBounds(0, 3, screen, padding, "master");
      expect(primary.x).toBe(0);
      expect(primary.y).toBe(0);
      expect(primary.width).toBe(1152); // floor(1920 * 0.6)
      expect(primary.height).toBe(1080);
    });

    it("stack windows share right 40%", () => {
      const s1 = TileManager.getTileBounds(1, 3, screen, padding, "master");
      const s2 = TileManager.getTileBounds(2, 3, screen, padding, "master");

      // Both on the right side
      expect(s1.x).toBe(Math.floor(1920 * 0.6));
      expect(s2.x).toBe(Math.floor(1920 * 0.6));
      // Split height equally
      expect(s1.height).toBe(540);
      expect(s2.height).toBe(540);
      // Stack vertically
      expect(s1.y).toBe(0);
      expect(s2.y).toBe(540);
    });

    it("single window in master mode fills screen", () => {
      // Master layout with 1 window should act like grid (full screen)
      const bounds = TileManager.getTileBounds(0, 1, screen, padding, "master");
      expect(bounds.width).toBe(1920);
      expect(bounds.height).toBe(1080);
    });
  });

  // ── getLaunchTileArgs ──────────────────────────────────────────────

  describe("getLaunchTileArgs", () => {
    it("returns window-position and window-size Chrome args", () => {
      const tm = new TileManager();
      (tm as any).enabled = true;
      (tm as any).screenSize = { width: 1920, height: 1080 };
      (tm as any).padding = 0;

      const args = tm.getLaunchTileArgs(0); // first session
      expect(args).toHaveLength(2);
      expect(args[0]).toMatch(/^--window-position=\d+,\d+$/);
      expect(args[1]).toMatch(/^--window-size=\d+,\d+$/);
    });

    it("uses fallback screen size when not detected", () => {
      const tm = new TileManager();
      (tm as any).enabled = true;
      (tm as any).padding = 0;
      // screenSize is null — should use fallback with menu bar offset (y=25, h=1055)

      const args = tm.getLaunchTileArgs(0);
      expect(args[0]).toBe("--window-position=0,25");
      expect(args[1]).toBe("--window-size=1920,1055");
    });
  });

  // ── isEnabled ──────────────────────────────────────────────────────

  describe("isEnabled", () => {
    it("is false by default", () => {
      const tm = new TileManager();
      expect(tm.isEnabled()).toBe(false);
    });

    it("is true after configure()", () => {
      const tm = new TileManager();
      tm.configure({ layout: "grid", padding: 8 });
      expect(tm.isEnabled()).toBe(true);
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("enforces minimum window dimensions", () => {
      // Tiny screen with many windows — should clamp to minimums
      const screen = { width: 800, height: 600 };
      const bounds = TileManager.getTileBounds(0, 9, screen, 0); // 3x3 on 800x600

      expect(bounds.width).toBeGreaterThanOrEqual(500);
      expect(bounds.height).toBeGreaterThanOrEqual(300);
    });

    it("removeSession cleans up windowId", () => {
      const tm = new TileManager();
      (tm as any).windowIds.set("s_abc123", 42);
      tm.removeSession("s_abc123");
      expect((tm as any).windowIds.has("s_abc123")).toBe(false);
    });
  });
});
