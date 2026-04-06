// ─── Browser Launcher ──────────────���───────────────────────────────────────
//
// Dynamic browser launcher that switches between standard playwright-core
// and rebrowser-playwright-core based on the LEAP_REBROWSER env var.
//
// rebrowser-playwright-core is a patched fork that avoids Runtime.enable
// CDP detection — the #1 automation fingerprint. When LEAP_REBROWSER=true,
// we use it instead of standard playwright-core. If the package isn't
// installed, we log a warning and fall back gracefully.
//
// Usage:
//   const chromium = await getChromium();
//   const browser  = await chromium.launch();

import type { BrowserType, Browser } from "playwright-core";
import { logger } from "./logger.js";

// ─── Configuration ─────────────────���──────────────────────────────────────

const LEAP_REBROWSER = process.env.LEAP_REBROWSER === "true";

export { LEAP_REBROWSER };

// ─── Cached Imports ──────────────────���────────────────────────────────────

let cachedChromium: BrowserType<Browser> | null = null;

// ─── Public API ───────��────────────────────────────────────���──────────────

/**
 * Returns the `chromium` browser type from either rebrowser-playwright-core
 * (when LEAP_REBROWSER=true and installed) or standard playwright-core.
 * Result is cached after first resolution.
 */
export async function getChromium(): Promise<BrowserType<Browser>> {
  if (cachedChromium) return cachedChromium;

  if (LEAP_REBROWSER) {
    try {
      // Dynamic import — rebrowser-playwright-core mirrors playwright-core's API surface
      const mod = await import(/* @vite-ignore */ "rebrowser-playwright-core" as string);
      cachedChromium = mod.chromium as BrowserType<Browser>;
      logger.info("browser-launcher:rebrowser", {
        message: "Using rebrowser-playwright-core for enhanced stealth",
      });
      return cachedChromium;
    } catch {
      logger.warn("browser-launcher:rebrowser-fallback", {
        message:
          "rebrowser-playwright-core not installed. " +
          "Install with: npm i rebrowser-playwright-core. " +
          "Falling back to playwright-core.",
      });
    }
  }

  const mod = await import("playwright-core");
  cachedChromium = mod.chromium;
  return cachedChromium;
}
