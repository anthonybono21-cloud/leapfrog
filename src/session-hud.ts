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


// ─── Scroll-to-Target ─────────────────────────────────────────────────────

/**
 * Zoom-to-target: two sync scripts with a Playwright waitForTimeout in between.
 * getScrollToTargetZoomIn zooms the page 2.5x and highlights the element.
 * getScrollToTargetZoomOut restores normal zoom.
 * The caller awaits a real delay between them so the human can see.
 */
export function getScrollToTargetZoomIn(selector: string): string {
  const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `(function() {
  var el = document.querySelector('${escaped}');
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  document.body.style.zoom = '2.5';
  el.scrollIntoView({ block: 'center' });
  el.style.outline = '3px solid #22c55e';
  el.style.outlineOffset = '4px';
  el.style.backgroundColor = 'rgba(34, 197, 94, 0.1)';
  return true;
})()`;
}

export function getScrollToTargetZoomOut(selector: string): string {
  const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `(function() {
  var el = document.querySelector('${escaped}');
  document.body.style.zoom = '1';
  if (el) {
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.backgroundColor = '';
    el.scrollIntoView({ block: 'center' });
  }
})()`;
}

/** Legacy single-call version (sync scroll only, no zoom). */
export function getScrollToTargetScript(selector: string): string {
  const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `(function() {
  var el = document.querySelector('${escaped}');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
})()`;
}
