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

// ─── Agent Eyes Init Script ───────────────────────────────────────────────

/**
 * Returns JS to inject cursor tracking + scroll indicator for headed sessions.
 * Always-on for headed mode — not gated by LEAP_HUD.
 * Zero Node.js overhead: listens to native DOM events dispatched by Playwright.
 */
export function getAgentEyesInitScript(): string {
  return `(function() {
  if (window.__leapfrog_eyes_initialized) return;
  window.__leapfrog_eyes_initialized = true;

  function init() {
    // ── CSS ──────────────────────────────────────────────────────────
    var style = document.createElement('style');
    style.setAttribute('data-leapfrog', 'true');
    style.textContent = \`
      #leapfrog-cursor {
        position: fixed;
        width: 28px;
        height: 28px;
        pointer-events: none;
        z-index: 2147483646;
        transition: left 0.04s linear, top 0.04s linear, opacity 0.3s ease;
        opacity: 0;
        filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4)) drop-shadow(0 0 8px rgba(34,197,94,0.3));
      }
      #leapfrog-cursor-ring {
        position: fixed;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: 2px solid rgba(34, 197, 94, 0.3);
        pointer-events: none;
        z-index: 2147483646;
        transform: translate(-50%, -50%);
        transition: left 0.08s ease-out, top 0.08s ease-out, opacity 0.3s ease;
        opacity: 0;
      }
      #leapfrog-scroll-indicator {
        position: fixed;
        right: 16px;
        top: 50%;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background: rgba(34, 197, 94, 0.7);
        color: #fff;
        font-size: 20px;
        line-height: 36px;
        text-align: center;
        pointer-events: none;
        z-index: 2147483646;
        opacity: 0;
        transition: opacity 0.15s ease-out;
        transform: translateY(-50%);
      }
    \`;
    (document.head || document.documentElement).appendChild(style);

    // ── Agent Cursor (dot + trailing ring) ──────────────────────────
    var cursor = document.createElement('div');
    cursor.id = 'leapfrog-cursor';
    cursor.setAttribute('data-leapfrog', 'true');
    cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L12 26L15 15L26 12L2 2Z" fill="#22c55e" stroke="#166534" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    (document.body || document.documentElement).appendChild(cursor);

    var ring = document.createElement('div');
    ring.id = 'leapfrog-cursor-ring';
    ring.setAttribute('data-leapfrog', 'true');
    (document.body || document.documentElement).appendChild(ring);

    var cursorTimeout;
    document.addEventListener('mousemove', function(e) {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
      cursor.style.opacity = '1';
      ring.style.left = e.clientX + 'px';
      ring.style.top = e.clientY + 'px';
      ring.style.opacity = '1';
      clearTimeout(cursorTimeout);
      cursorTimeout = setTimeout(function() {
        cursor.style.opacity = '0';
        ring.style.opacity = '0';
      }, 3000);
    }, true);

    // ── Scroll Indicator ────────────────────────────────────────────
    var scrollArrow = document.createElement('div');
    scrollArrow.id = 'leapfrog-scroll-indicator';
    scrollArrow.setAttribute('data-leapfrog', 'true');
    (document.body || document.documentElement).appendChild(scrollArrow);

    var scrollFadeTimeout;
    document.addEventListener('wheel', function(e) {
      scrollArrow.textContent = e.deltaY > 0 ? '\\u25BC' : '\\u25B2';
      scrollArrow.style.opacity = '1';
      clearTimeout(scrollFadeTimeout);
      scrollFadeTimeout = setTimeout(function() { scrollArrow.style.opacity = '0'; }, 400);
    }, true);
  }

  // Defer until body exists — init scripts can run before DOM is ready
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();`;
}

/** Legacy single-call version (sync scroll only, no zoom). */
export function getScrollToTargetScript(selector: string): string {
  const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `(function() {
  var el = document.querySelector('${escaped}');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
})()`;
}
