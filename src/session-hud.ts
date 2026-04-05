// ─── Session HUD Overlay ──────────────────────────────────────────────────
//
// Injects a visual HUD into browser pages: color-coded border, status bar,
// click ripple, and agent cursor. All functions return JavaScript strings
// to evaluate in the browser context via page.addInitScript() or
// page.evaluate().
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
 * Creates DOM elements, CSS, and the window.__leapfrog_* control functions.
 */
export function getHUDInitScript(sessionName: string): string {
  logger.debug(`Generating HUD init script for session: ${sessionName}`);

  return `(function() {
  if (window.__leapfrog_hud_initialized) return;
  window.__leapfrog_hud_initialized = true;

  var STATUS_COLORS = ${JSON.stringify(STATUS_COLORS)};

  // ── CSS ──────────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.setAttribute('data-leapfrog', 'true');
  style.textContent = \`
    html[data-leapfrog-border] {
      border: 3px solid #22c55e;
      transition: border-color 0.3s ease;
      box-sizing: border-box;
    }

    #leapfrog-hud {
      position: fixed;
      bottom: 8px;
      left: 8px;
      background: rgba(0, 0, 0, 0.75);
      color: #fff;
      font: 12px/1.4 ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
      padding: 4px 10px;
      border-radius: 4px;
      z-index: 2147483647;
      pointer-events: none;
      user-select: none;
      white-space: nowrap;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }

    #leapfrog-hud .hud-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      margin-right: 6px;
      vertical-align: middle;
      transition: background-color 0.3s ease;
    }

    #leapfrog-cursor {
      position: fixed;
      width: 12px;
      height: 12px;
      z-index: 2147483647;
      pointer-events: none;
      transition: all 0.3s ease;
      transform: translate(-50%, -50%);
    }

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

  // ── Border ───────────────────────────────────────────────────────────
  document.documentElement.setAttribute('data-leapfrog-border', 'true');
  document.documentElement.setAttribute('data-leapfrog', 'true');

  // ── Status Bar ───────────────────────────────────────────────────────
  var hud = document.createElement('div');
  hud.id = 'leapfrog-hud';
  hud.setAttribute('data-leapfrog', 'true');
  hud.innerHTML = '<span class="hud-dot" style="background-color: ' + STATUS_COLORS.active + '"></span>'
    + '<span class="hud-session">${sessionName.replace(/'/g, "\\'")}</span>'
    + '<span class="hud-sep"> | </span>'
    + '<span class="hud-status">active</span>'
    + '<span class="hud-label"></span>';
  document.body.appendChild(hud);

  // ── Ripple Container ─────────────────────────────────────────────────
  var rippleContainer = document.createElement('div');
  rippleContainer.id = 'leapfrog-ripple-container';
  rippleContainer.setAttribute('data-leapfrog', 'true');
  document.body.appendChild(rippleContainer);

  // ── Agent Cursor ─────────────────────────────────────────────────────
  var cursor = document.createElement('div');
  cursor.id = 'leapfrog-cursor';
  cursor.setAttribute('data-leapfrog', 'true');
  cursor.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg">'
    + '<circle cx="6" cy="6" r="5" fill="#22c55e" stroke="#166534" stroke-width="1"/>'
    + '</svg>';
  cursor.style.left = '-100px';
  cursor.style.top = '-100px';
  cursor.style.display = 'none';
  document.body.appendChild(cursor);

  // ── Control Functions ────────────────────────────────────────────────
  window.__leapfrog_updateHUD = function(status, label) {
    var color = STATUS_COLORS[status] || STATUS_COLORS.active;
    document.documentElement.style.borderColor = color;

    var dot = document.querySelector('#leapfrog-hud .hud-dot');
    if (dot) dot.style.backgroundColor = color;

    var statusEl = document.querySelector('#leapfrog-hud .hud-status');
    if (statusEl) statusEl.textContent = status;

    var labelEl = document.querySelector('#leapfrog-hud .hud-label');
    if (labelEl) {
      labelEl.textContent = label ? ' — ' + label : '';
    }
  };

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

  window.__leapfrog_moveCursor = function(x, y) {
    var el = document.getElementById('leapfrog-cursor');
    if (!el) return;
    el.style.display = 'block';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  };

  window.__leapfrog_toggleCursor = function(visible) {
    var el = document.getElementById('leapfrog-cursor');
    if (!el) return;
    el.style.display = visible ? 'block' : 'none';
  };
})();`;
}

// ─── Live Update Scripts ───────────────────────────────────────────────────

/** Returns JS to execute via page.evaluate() for live status updates. */
export function getHUDUpdateScript(status: HUDStatus, label?: string): string {
  const escapedLabel = label ? label.replace(/\\/g, "\\\\").replace(/'/g, "\\'") : "";
  return `window.__leapfrog_updateHUD && window.__leapfrog_updateHUD('${status}', '${escapedLabel}');`;
}

/** Returns JS for click ripple at coordinates. */
export function getClickRippleScript(x: number, y: number): string {
  return `window.__leapfrog_clickRipple && window.__leapfrog_clickRipple(${x}, ${y});`;
}

/** Returns JS to move agent cursor to coordinates. */
export function getMoveCursorScript(x: number, y: number): string {
  return `window.__leapfrog_moveCursor && window.__leapfrog_moveCursor(${x}, ${y});`;
}

/** Returns JS to hide/show cursor. */
export function getToggleCursorScript(visible: boolean): string {
  return `window.__leapfrog_toggleCursor && window.__leapfrog_toggleCursor(${visible});`;
}
