import type { Page } from "playwright-core";
import type { Session } from "./types.js";
export interface TileBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}
/** Global context from multi-terminal coordinator for cross-instance tiling. */
export interface MultiTileContext {
    globalTotal: number;
    slotIndex: Map<string, number>;
}
export type TileLayout = "grid" | "master";
/**
 * Usable screen area — the rectangle excluding menu bar, Dock, etc.
 * `x` and `y` are the top-left origin of the work area in screen coordinates.
 */
export interface ScreenWorkArea {
    x: number;
    y: number;
    width: number;
    height: number;
}
declare class TileManager {
    private enabled;
    private layout;
    private padding;
    private screenSize;
    private windowIds;
    configure(opts: {
        layout: TileLayout;
        padding: number;
        screenWidth?: number;
        screenHeight?: number;
    }): void;
    isEnabled(): boolean;
    getLayout(): TileLayout;
    getScreenSize(): {
        width: number;
        height: number;
    } | null;
    detectScreen(page: Page): Promise<ScreenWorkArea>;
    /**
     * macOS fallback: query visible frame via Python + AppKit.
     * Returns null on non-macOS or if the command fails.
     */
    /**
     * macOS: detect which screen the terminal is on via JXA (JavaScript for Automation).
     * Works with any number of monitors in any arrangement.
     * Falls back to the primary screen's main screen if terminal detection fails.
     */
    static detectScreenViaOsascript(): ScreenWorkArea | null;
    static calculateGrid(n: number): {
        cols: number;
        rows: number;
    };
    static getTileBounds(index: number, total: number, screen: {
        width: number;
        height: number;
        x?: number;
        y?: number;
    }, padding: number, layout?: TileLayout): TileBounds;
    private static getMasterStackBounds;
    getLaunchTileArgs(sessionCount: number, multiTile?: {
        globalTotal: number;
        globalIndex: number;
    }): string[];
    positionWindow(page: Page, sessionId: string): Promise<void>;
    positionWindowWithBounds(page: Page, sessionId: string, bounds: TileBounds): Promise<void>;
    reflowAll(sessions: Map<string, Session>, multiTile?: MultiTileContext): Promise<void>;
    raiseAllWindows(sessions: Map<string, Session>): Promise<void>;
    removeSession(sessionId: string): void;
}
export declare const tileManager: TileManager;
export { TileManager };
