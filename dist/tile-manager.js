// ─── Window Tile Manager ──────────────────────────────────────────────────
//
// Auto-tiles headed browser windows in an organized grid on screen.
// Opt-in via LEAP_TILE=true|grid|master env var.
//
// Key design:
//   - Viewport (screenshot resolution) stays at 1280x720 regardless of tile size
//   - Screen detection via page.evaluate() on first headed session, cached
//   - Accounts for macOS menu bar, Dock, and work area offset
//   - Launch-time positioning via --window-position/--window-size Chrome args
//   - Runtime repositioning via CDP Browser.setWindowBounds for reflow
//   - z-order management via raiseAllWindows() for keeping tiles visible
//   - All operations are non-fatal — failures log warnings, never throw
//
import { execSync } from "child_process";
import { logger } from "./logger.js";
// ─── Tile Manager ──────────────────────────────────────────────────────────
class TileManager {
    enabled = false;
    layout = "grid";
    padding = 8;
    screenSize = null;
    windowIds = new Map();
    // ── Configuration ──────────────────────────────────────────────────
    configure(opts) {
        this.enabled = true;
        this.layout = opts.layout;
        this.padding = opts.padding;
        // Allow env-var-driven screen size to skip detection entirely
        if (opts.screenWidth && opts.screenHeight && opts.screenWidth > 0 && opts.screenHeight > 0) {
            this.screenSize = { x: 0, y: 0, width: opts.screenWidth, height: opts.screenHeight };
            logger.info("tile.screen_from_env", { width: opts.screenWidth, height: opts.screenHeight });
        }
        logger.info("tile.configured", { layout: this.layout, padding: this.padding });
    }
    isEnabled() {
        return this.enabled;
    }
    getLayout() {
        return this.layout;
    }
    getScreenSize() {
        return this.screenSize;
    }
    // ── Screen Detection ───────────────────────────────────────────────
    //
    // Lazily detects screen work area from the first headed page.
    // Uses page.evaluate() to get availLeft/availTop/availWidth/availHeight
    // which excludes menu bar and Dock on macOS.
    // Falls back to osascript (macOS) then hardcoded defaults.
    async detectScreen(page) {
        if (this.screenSize)
            return this.screenSize;
        // Best method (macOS): detect which screen the terminal is on via JXA.
        // This finds the correct monitor in multi-display setups.
        const jxaResult = TileManager.detectScreenViaOsascript();
        if (jxaResult) {
            this.screenSize = jxaResult;
            logger.info("tile.screen_detected_terminal", { ...this.screenSize });
            return this.screenSize;
        }
        try {
            // Best approach: maximize the window, then read its outer bounds.
            // A maximized window IS the usable screen area — accounts for menu bar,
            // dock, Retina scaling, notch, everything. No platform-specific hacks.
            const cdpSession = await page.context().newCDPSession(page);
            const { windowId } = await cdpSession.send("Browser.getWindowForTarget");
            // Maximize the window
            await cdpSession.send("Browser.setWindowBounds", {
                windowId,
                bounds: { windowState: "maximized" },
            });
            await page.waitForTimeout(200); // let the OS settle
            // Read the maximized bounds — this is our screen work area
            const { bounds } = await cdpSession.send("Browser.getWindowBounds", { windowId });
            if (bounds.width && bounds.height && bounds.width > 100 && bounds.height > 100) {
                this.screenSize = {
                    x: bounds.left ?? 0,
                    y: bounds.top ?? 0,
                    width: bounds.width,
                    height: bounds.height,
                };
                logger.info("tile.screen_detected_maximize", { ...this.screenSize });
                // Restore to normal state so it can be tiled
                await cdpSession.send("Browser.setWindowBounds", {
                    windowId,
                    bounds: { windowState: "normal" },
                });
            }
            else {
                throw new Error("Invalid maximized bounds");
            }
            await cdpSession.detach();
        }
        catch (err) {
            // Fallback: try screen.availWidth/availHeight
            try {
                this.screenSize = await page.evaluate(() => ({
                    x: window.screen.availLeft ?? 0,
                    y: window.screen.availTop ?? 0,
                    width: window.screen.availWidth,
                    height: window.screen.availHeight,
                }));
                logger.info("tile.screen_detected_avail", { ...this.screenSize });
            }
            catch {
                // Last resort: osascript or hardcoded
                this.screenSize = TileManager.detectScreenViaOsascript();
                if (this.screenSize) {
                    logger.info("tile.screen_detected_osascript", { ...this.screenSize });
                }
                else {
                    this.screenSize = { x: 0, y: 25, width: 1920, height: 1055 };
                    logger.warn("tile.screen_detection_failed", { fallback: this.screenSize });
                }
            }
        }
        return this.screenSize;
    }
    /**
     * macOS fallback: query visible frame via Python + AppKit.
     * Returns null on non-macOS or if the command fails.
     */
    /**
     * macOS: detect which screen the terminal is on via JXA (JavaScript for Automation).
     * Works with any number of monitors in any arrangement.
     * Falls back to the primary screen's main screen if terminal detection fails.
     */
    static detectScreenViaOsascript() {
        if (process.platform !== "darwin")
            return null;
        try {
            // JXA script: finds which NSScreen contains the frontmost terminal window.
            // Uses System Events for terminal position + NSScreen for display geometry.
            // Coordinate conversion: System Events uses top-left, NSScreen uses Cocoa bottom-left.
            // Primary screen height bridges the two: cocoaY = primaryH - topLeftY
            const script = `osascript -l JavaScript -e '
ObjC.import("AppKit");
var app = Application("System Events");
var pos, termX = 0, termY = 0;
try {
  var fp = app.processes.whose({frontmost: true})[0];
  pos = fp.windows[0].position();
  termX = pos[0]; termY = pos[1];
} catch(e) {}

var screens = $.NSScreen.screens;
var primaryH = screens.objectAtIndex(0).frame.size.height;
var cocoaTermY = primaryH - termY;

// Find the screen containing the terminal
for (var i = 0; i < screens.count; i++) {
  var f = screens.objectAtIndex(i).frame;
  var vf = screens.objectAtIndex(i).visibleFrame;
  if (termX >= f.origin.x && termX < f.origin.x + f.size.width &&
      cocoaTermY >= f.origin.y && cocoaTermY < f.origin.y + f.size.height) {
    var x = Math.round(vf.origin.x);
    var y = Math.round(primaryH - vf.origin.y - vf.size.height);
    var w = Math.round(vf.size.width);
    var h = Math.round(vf.size.height);
    x + " " + y + " " + w + " " + h;
  }
}

// Fallback: primary screen visible frame
var vf = screens.objectAtIndex(0).visibleFrame;
Math.round(vf.origin.x) + " " + Math.round(primaryH - vf.origin.y - vf.size.height) + " " + Math.round(vf.size.width) + " " + Math.round(vf.size.height);
'`;
            const result = execSync(script, { timeout: 5000, encoding: "utf-8" }).trim();
            const parts = result.split(/\s+/).map(Number);
            if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
                return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
            }
        }
        catch {
            // JXA not available or permission denied
        }
        return null;
    }
    // ── Grid Calculation ───────────────────────────────────────────────
    //
    // Pure function: optimal grid for N windows.
    // cols = ceil(sqrt(n)), rows = ceil(n / cols)
    static calculateGrid(n) {
        if (n <= 0)
            return { cols: 1, rows: 1 };
        if (n === 3)
            return { cols: 3, rows: 1 }; // 3 columns looks better than 2x2 with empty slot
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        return { cols, rows };
    }
    // ── Tile Bounds ────────────────────────────────────────────────────
    //
    // Pure function: calculate pixel bounds for a tile at given index.
    // `screen` can be a simple {width, height} (offset defaults to 0,0)
    // or a full ScreenWorkArea with x,y origin offset.
    static getTileBounds(index, total, screen, padding, layout = "grid") {
        const offsetX = screen.x ?? 0;
        const offsetY = screen.y ?? 0;
        if (layout === "master" && total > 1) {
            return TileManager.getMasterStackBounds(index, total, screen, padding);
        }
        const { cols, rows } = TileManager.calculateGrid(total);
        const col = index % cols;
        const row = Math.floor(index / cols);
        const tileW = Math.floor((screen.width - padding * (cols + 1)) / cols);
        const tileH = Math.floor((screen.height - padding * (rows + 1)) / rows);
        return {
            x: offsetX + padding + col * (tileW + padding),
            y: offsetY + padding + row * (tileH + padding),
            width: Math.max(tileW, 500), // Chrome minimum ~500px
            height: Math.max(tileH, 300), // Chrome minimum ~200px, but 300 is more usable
        };
    }
    // ── Master-Stack Layout ────────────────────────────────────────────
    //
    // Index 0 = primary (left 60%). Rest = stacked on right 40%.
    static getMasterStackBounds(index, total, screen, padding) {
        const offsetX = screen.x ?? 0;
        const offsetY = screen.y ?? 0;
        const masterRatio = 0.6;
        const masterW = Math.floor(screen.width * masterRatio) - padding * 2;
        const stackW = Math.floor(screen.width * (1 - masterRatio)) - padding;
        const stackCount = total - 1;
        if (index === 0) {
            // Primary: left side, full height
            return {
                x: offsetX + padding,
                y: offsetY + padding,
                width: Math.max(masterW, 500),
                height: Math.max(screen.height - padding * 2, 300),
            };
        }
        // Stack: right side, evenly divided
        const stackIndex = index - 1;
        const stackH = Math.floor((screen.height - padding * (stackCount + 1)) / stackCount);
        return {
            x: offsetX + Math.floor(screen.width * masterRatio) + padding,
            y: offsetY + padding + stackIndex * (stackH + padding),
            width: Math.max(stackW, 500),
            height: Math.max(stackH, 300),
        };
    }
    // ── Launch Args ────────────────────────────────────────────────────
    //
    // Returns Chrome flags for window position/size at launch time.
    // Uses work area offset so windows appear in the usable area.
    getLaunchTileArgs(sessionCount, multiTile) {
        const screen = this.screenSize ?? { x: 0, y: 25, width: 1920, height: 1055 };
        const total = multiTile?.globalTotal ?? (sessionCount + 1);
        const index = multiTile?.globalIndex ?? sessionCount;
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
    async positionWindow(page, sessionId) {
        if (!this.screenSize)
            return;
        // We don't know total/index here — caller should use reflowAll instead.
        // This is a low-level primitive; reflowAll calls it with correct bounds.
        logger.debug("tile.position_window", { sessionId });
    }
    async positionWindowWithBounds(page, sessionId, bounds) {
        let cdp;
        try {
            cdp = await page.context().newCDPSession(page);
            const { windowId } = await cdp.send("Browser.getWindowForTarget");
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
        }
        finally {
            if (cdp)
                await cdp.detach().catch(() => { });
        }
    }
    // ── Reflow All Windows ─────────────────────────────────────────────
    //
    // Recalculates grid for all sessions and repositions every window.
    // Uses Promise.allSettled so one failure doesn't block others.
    async reflowAll(sessions, multiTile) {
        if (!this.screenSize)
            return;
        const entries = Array.from(sessions.entries());
        if (entries.length === 0)
            return;
        // When multi-tile is active, use global count/indices so all instances
        // share one unified grid. Otherwise fall back to local session count.
        const total = multiTile?.globalTotal ?? entries.length;
        logger.info("tile.reflow", { total, local: entries.length, layout: this.layout });
        // Position all windows (parallel for speed)
        const results = await Promise.allSettled(entries.map(async ([id, session], localIndex) => {
            const index = multiTile?.slotIndex.get(id) ?? localIndex;
            const bounds = TileManager.getTileBounds(index, total, this.screenSize, this.padding, this.layout);
            // Get active page — prefer pages array if available, fall back to session.page
            const page = session.pages?.[session.activePageIndex ?? 0] ?? session.page;
            if (!page || page.isClosed())
                return;
            await this.positionWindowWithBounds(page, id, bounds);
        }));
        // Bring all windows to front after positioning
        await this.raiseAllWindows(sessions);
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
            logger.warn("tile.reflow_partial_failure", { total, failed });
        }
    }
    // ── Z-Order Management ─────────────────────────────────────────────
    //
    // Brings all tiled browser windows to front in grid order.
    // Sequential to ensure z-order matches grid order (first = bottom, last = top).
    // Call after reflow, or externally when windows get buried behind terminal.
    async raiseAllWindows(sessions) {
        const entries = Array.from(sessions.entries());
        if (entries.length === 0)
            return;
        logger.debug("tile.raise_all", { count: entries.length });
        for (const [, session] of entries) {
            const page = session.pages?.[session.activePageIndex ?? 0] ?? session.page;
            if (page && !page.isClosed()) {
                await page.bringToFront().catch(() => { });
            }
        }
    }
    // ── Cleanup ────────────────────────────────────────────────────────
    removeSession(sessionId) {
        this.windowIds.delete(sessionId);
    }
}
export const tileManager = new TileManager();
export { TileManager };
