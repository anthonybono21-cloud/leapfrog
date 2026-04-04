// ─── Window Tile Manager ──────────────────────────────────────────────────
//
// Auto-tiles headed browser windows in an organized grid on screen.
// Opt-in via LEAP_TILE=true|grid|master env var.
//
// Key design:
//   - Viewport (screenshot resolution) stays at 1280x720 regardless of tile size
//   - Screen detection via page.evaluate() on first headed session, cached
//   - Launch-time positioning via --window-position/--window-size Chrome args
//   - Runtime repositioning via CDP Browser.setWindowBounds for reflow
//   - All operations are non-fatal — failures log warnings, never throw
//

import type { Page } from "playwright-core";
import type { Session } from "./types.js";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TileBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TileLayout = "grid" | "master";

// ─── Tile Manager ──────────────────────────────────────────────────────────

class TileManager {
  private enabled = false;
  private layout: TileLayout = "grid";
  private padding = 8;
  private screenSize: { width: number; height: number } | null = null;
  private windowIds = new Map<string, number>();

  // ── Configuration ──────────────────────────────────────────────────

  configure(opts: { layout: TileLayout; padding: number }): void {
    this.enabled = true;
    this.layout = opts.layout;
    this.padding = opts.padding;
    logger.info("tile.configured", { layout: this.layout, padding: this.padding });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getLayout(): TileLayout {
    return this.layout;
  }

  getScreenSize(): { width: number; height: number } | null {
    return this.screenSize;
  }

  // ── Screen Detection ───────────────────────────────────────────────
  //
  // Lazily detects screen size from the first headed page.
  // Cached after first call. Falls back to 1920x1080 on failure.

  async detectScreen(page: Page): Promise<{ width: number; height: number }> {
    if (this.screenSize) return this.screenSize;

    try {
      this.screenSize = await page.evaluate(() => ({
        width: window.screen.availWidth,
        height: window.screen.availHeight,
      }));
      logger.info("tile.screen_detected", this.screenSize);
    } catch {
      this.screenSize = { width: 1920, height: 1080 };
      logger.warn("tile.screen_detection_failed", { fallback: this.screenSize });
    }

    return this.screenSize;
  }

  // ── Grid Calculation ───────────────────────────────────────────────
  //
  // Pure function: optimal grid for N windows.
  // cols = ceil(sqrt(n)), rows = ceil(n / cols)

  static calculateGrid(n: number): { cols: number; rows: number } {
    if (n <= 0) return { cols: 1, rows: 1 };
    if (n === 3) return { cols: 3, rows: 1 }; // 3 columns looks better than 2x2 with empty slot
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }

  // ── Tile Bounds ────────────────────────────────────────────────────
  //
  // Pure function: calculate pixel bounds for a tile at given index.

  static getTileBounds(
    index: number,
    total: number,
    screen: { width: number; height: number },
    padding: number,
    layout: TileLayout = "grid",
  ): TileBounds {
    if (layout === "master" && total > 1) {
      return TileManager.getMasterStackBounds(index, total, screen, padding);
    }

    const { cols, rows } = TileManager.calculateGrid(total);
    const col = index % cols;
    const row = Math.floor(index / cols);

    const tileW = Math.floor((screen.width - padding * (cols + 1)) / cols);
    const tileH = Math.floor((screen.height - padding * (rows + 1)) / rows);

    return {
      x: padding + col * (tileW + padding),
      y: padding + row * (tileH + padding),
      width: Math.max(tileW, 500), // Chrome minimum ~500px
      height: Math.max(tileH, 300), // Chrome minimum ~200px, but 300 is more usable
    };
  }

  // ── Master-Stack Layout ────────────────────────────────────────────
  //
  // Index 0 = primary (left 60%). Rest = stacked on right 40%.

  private static getMasterStackBounds(
    index: number,
    total: number,
    screen: { width: number; height: number },
    padding: number,
  ): TileBounds {
    const masterRatio = 0.6;
    const masterW = Math.floor(screen.width * masterRatio) - padding * 2;
    const stackW = Math.floor(screen.width * (1 - masterRatio)) - padding;
    const stackCount = total - 1;

    if (index === 0) {
      // Primary: left side, full height
      return {
        x: padding,
        y: padding,
        width: Math.max(masterW, 500),
        height: Math.max(screen.height - padding * 2, 300),
      };
    }

    // Stack: right side, evenly divided
    const stackIndex = index - 1;
    const stackH = Math.floor((screen.height - padding * (stackCount + 1)) / stackCount);

    return {
      x: Math.floor(screen.width * masterRatio) + padding,
      y: padding + stackIndex * (stackH + padding),
      width: Math.max(stackW, 500),
      height: Math.max(stackH, 300),
    };
  }

  // ── Launch Args ────────────────────────────────────────────────────
  //
  // Returns Chrome flags for window position/size at launch time.
  // Used for browser launch paths that build launchArgs[].

  getLaunchTileArgs(sessionCount: number): string[] {
    const screen = this.screenSize ?? { width: 1920, height: 1080 };
    const total = sessionCount + 1; // +1 for the session being created
    const index = sessionCount;     // 0-based, this is the newest

    const bounds = TileManager.getTileBounds(index, total, screen, this.padding, this.layout);

    return [
      `--window-position=${bounds.x},${bounds.y}`,
      `--window-size=${bounds.width},${bounds.height}`,
    ];
  }

  // ── CDP Window Positioning ─────────────────────────────────────────
  //
  // Positions a single window via CDP Browser.setWindowBounds.
  // Caches windowId for later reflow.

  async positionWindow(page: Page, sessionId: string): Promise<void> {
    if (!this.screenSize) return;

    // We don't know total/index here — caller should use reflowAll instead.
    // This is a low-level primitive; reflowAll calls it with correct bounds.
    logger.debug("tile.position_window", { sessionId });
  }

  async positionWindowWithBounds(page: Page, sessionId: string, bounds: TileBounds): Promise<void> {
    let cdp;
    try {
      cdp = await page.context().newCDPSession(page);
      const { windowId } = await cdp.send("Browser.getWindowForTarget") as { windowId: number };

      // Ensure window is in normal state before setting bounds
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: { windowState: "normal" },
      });

      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      });

      this.windowIds.set(sessionId, windowId);
      logger.debug("tile.positioned", { sessionId, windowId, ...bounds });
    } finally {
      if (cdp) await cdp.detach().catch(() => {});
    }
  }

  // ── Reflow All Windows ─────────────────────────────────────────────
  //
  // Recalculates grid for all sessions and repositions every window.
  // Uses Promise.allSettled so one failure doesn't block others.

  async reflowAll(sessions: Map<string, Session>): Promise<void> {
    if (!this.screenSize) return;

    const entries = Array.from(sessions.entries());
    const total = entries.length;
    if (total === 0) return;

    logger.info("tile.reflow", { total, layout: this.layout });

    // Position all windows (parallel for speed)
    const results = await Promise.allSettled(
      entries.map(async ([id, session], index) => {
        const bounds = TileManager.getTileBounds(index, total, this.screenSize!, this.padding, this.layout);

        // Get active page — prefer pages array if available, fall back to session.page
        const page = session.pages?.[session.activePageIndex ?? 0] ?? session.page;
        if (!page || page.isClosed()) return;

        await this.positionWindowWithBounds(page, id, bounds);
      }),
    );

    // Bring all windows to front (sequential to ensure z-order matches grid order)
    for (const [, session] of entries) {
      const page = session.pages?.[session.activePageIndex ?? 0] ?? session.page;
      if (page && !page.isClosed()) {
        await page.bringToFront().catch(() => {});
      }
    }

    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      logger.warn("tile.reflow_partial_failure", { total, failed });
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  removeSession(sessionId: string): void {
    this.windowIds.delete(sessionId);
  }
}

export const tileManager = new TileManager();
export { TileManager };
