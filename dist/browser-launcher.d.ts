import type { BrowserType, Browser } from "playwright-core";
declare const LEAP_REBROWSER: boolean;
export { LEAP_REBROWSER };
/**
 * Returns the `chromium` browser type from either rebrowser-playwright-core
 * (when LEAP_REBROWSER=true and installed) or standard playwright-core.
 * Result is cached after first resolution.
 */
/**
 * Resolve the full (non-headless-shell) Chromium executable path.
 * Playwright ships two binaries: chrome-headless-shell (default) and full chrome.
 * When launching headed, we MUST use the full binary or windows are invisible.
 */
export declare function resolveHeadedExecutablePath(): string | undefined;
export declare function getChromium(): Promise<BrowserType<Browser>>;
