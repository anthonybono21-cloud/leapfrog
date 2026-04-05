// ─── Session HUD Overlay ──────────────────────────────────────────────────
//
// Injects a minimal visual HUD into browser pages: click ripple animation.
// All functions return JavaScript strings to evaluate in the browser context
// via page.addInitScript() or page.evaluate().
//
// Opt-in via LEAP_HUD=true env var (caller checks, not this module).
//
// Integration point: import { getHUDInitScript, ... } from "./session-hud.js"
//

import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export type HUDStatus = "active" | "loading" | "waiting" | "error" | "complete";

// ─── Color Map ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<HUDStatus, string> = {
  active: "#22c55e",
  loading: "#3b82f6",
  waiting: "#f59e0b",
  error: "#ef4444",
  complete: "#8b5cf6",
};

// ─── Init Script ───────────────────────────────────────────────────────────

/**
 * Returns the JavaScript string to inject via page.addInitScript().
 * Creates the ripple container, ripple CSS, and the click ripple function.
 */
export function getHUDInitScript(sessionName: string): string {
  logger.debug(`Generating HUD init script for session: ${sessionName}`);

  return `(function() {
  if (window.__leapfrog_hud_initialized) return;
  window.__leapfrog_hud_initialized = true;

  // ── CSS (ripple only) ────────────────────────────────────────────────
  var style = document.createElement('style');
  style.setAttribute('data-leapfrog', 'true');
  style.textContent = \`
    #leapfrog-ripple-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 2147483646;
      pointer-events: none;
      overflow: hidden;
    }

    @keyframes leapfrog-ripple {
      0% {
        width: 20px;
        height: 20px;
        opacity: 0.6;
      }
      100% {
        width: 80px;
        height: 80px;
        opacity: 0;
      }
    }

    .leapfrog-ripple {
      position: absolute;
      border-radius: 50%;
      background: rgba(34, 197, 94, 0.4);
      animation: leapfrog-ripple 0.6s ease-out forwards;
      pointer-events: none;
      transform: translate(-50%, -50%);
    }
  \`;
  document.head.appendChild(style);

  document.documentElement.setAttribute('data-leapfrog', 'true');

  // ── Ripple Container ─────────────────────────────────────────────────
  var rippleContainer = document.createElement('div');
  rippleContainer.id = 'leapfrog-ripple-container';
  rippleContainer.setAttribute('data-leapfrog', 'true');
  document.body.appendChild(rippleContainer);

  // ── Control Functions ────────────────────────────────────────────────
  window.__leapfrog_clickRipple = function(x, y) {
    var container = document.getElementById('leapfrog-ripple-container');
    if (!container) return;
    var ripple = document.createElement('div');
    ripple.className = 'leapfrog-ripple';
    ripple.setAttribute('data-leapfrog', 'true');
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    container.appendChild(ripple);
    ripple.addEventListener('animationend', function() { ripple.remove(); });
  };
})();`;
}

// ─── Live Update Scripts ───────────────────────────────────────────────────

/** Returns empty string (HUD status bar removed). Kept for API compatibility. */
export function getHUDUpdateScript(_status: HUDStatus, _label?: string): string {
  return "";
}

/** Returns JS for click ripple at coordinates. */
export function getClickRippleScript(x: number, y: number): string {
  return `window.__leapfrog_clickRipple && window.__leapfrog_clickRipple(${x}, ${y});`;
}

/** Returns empty string (agent cursor removed). Kept for API compatibility. */
export function getMoveCursorScript(_x: number, _y: number): string {
  return "";
}

/** Returns empty string (agent cursor removed). Kept for API compatibility. */
export function getToggleCursorScript(_visible: boolean): string {
  return "";
}

// ─── Scroll-to-Target ─────────────────────────────────────────────────────

/** Returns JS to smoothly scroll the viewport so the target element is centered. */
export function getScrollToTargetScript(selector: string): string {
  const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `(function() {
  var el = document.querySelector('${escaped}');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
})();`;
}
