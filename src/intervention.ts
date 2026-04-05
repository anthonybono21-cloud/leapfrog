// ─── Human Intervention Detection & Overlay ──────────────────────────────
//
// Detects when a browser page needs human intervention (CAPTCHAs, login walls,
// OAuth redirects, Cloudflare challenges) and provides a fullscreen @..@ overlay
// to guide the user.
//
// All functions return JavaScript strings for page.evaluate() or addInitScript().
// No DOM manipulation happens in Node — everything runs in the browser context.

// ─── Types ────────────────────────────────────────────────────────────────

export type InterventionType = 'captcha' | 'login' | 'oauth' | 'challenge' | 'manual';

export interface InterventionEvent {
  type: InterventionType;
  reason: string;
  elementSelector?: string;
  timestamp: number;
}

// ─── Detection Init Script (MutationObserver) ─────────────────────────────

/**
 * Returns JS to inject via page.addInitScript(). Sets up a MutationObserver
 * and a 2s periodic check that detects CAPTCHAs, login walls, OAuth redirects,
 * and Cloudflare challenges. When detected, sets window.__leapfrog_intervention.
 */
export function getDetectionInitScript(): string {
  return `(() => {
  if (window.__leapfrog_detection_active) return;
  window.__leapfrog_detection_active = true;
  window.__leapfrog_intervention = null;
  window.__leapfrog_intervention_resolved = false;

  const CAPTCHA_IFRAME_PATTERNS = [
    'hcaptcha',
    'challenges.cloudflare.com'
  ];

  const RECAPTCHA_CHALLENGE_PATTERNS = [
    'recaptcha/api2/anchor',
    'recaptcha/api2/bframe'
  ];

  const TEXT_PATTERNS = [
    /verify.*(human|not.*robot)/i,
    /complete.*captcha/i,
    /security.*check/i
  ];

  const CHALLENGE_SELECTORS = [
    'div#challenge-running',
    'div.cf-browser-verification'
  ];

  const OAUTH_URL_PATTERNS = [
    '/oauth/',
    '/authorize',
    '/login/oauth'
  ];

  function setIntervention(type, reason, selector) {
    if (window.__leapfrog_intervention) return;
    window.__leapfrog_intervention = {
      type: type,
      reason: reason,
      elementSelector: selector || null,
      timestamp: Date.now()
    };
  }

  function isIframeVisible(iframe) {
    return iframe.offsetWidth > 0 && iframe.offsetHeight > 0;
  }

  function isInvisibleRecaptcha(src) {
    try {
      const url = new URL(src, window.location.href);
      if (url.searchParams.get('size') === 'invisible') return true;
    } catch (e) {}
    return false;
  }

  function checkCaptchaIframes() {
    const iframes = document.querySelectorAll('iframe[src]');
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') || '';
      // Check non-recaptcha patterns (hcaptcha, cloudflare)
      for (const pattern of CAPTCHA_IFRAME_PATTERNS) {
        if (src.includes(pattern) && isIframeVisible(iframe)) {
          setIntervention('captcha', 'CAPTCHA detected', 'iframe[src*="' + pattern + '"]');
          return true;
        }
      }
      // Check recaptcha — only match actual challenge iframes, not scoring-only
      for (const pattern of RECAPTCHA_CHALLENGE_PATTERNS) {
        if (src.includes(pattern) && isIframeVisible(iframe) && !isInvisibleRecaptcha(src)) {
          setIntervention('captcha', 'CAPTCHA detected', 'iframe[src*="' + pattern + '"]');
          return true;
        }
      }
    }
    return false;
  }

  function checkTextPatterns() {
    const body = document.body;
    if (!body) return false;
    const text = body.innerText || '';
    for (const pattern of TEXT_PATTERNS) {
      if (pattern.test(text)) {
        setIntervention('captcha', 'Human verification text detected');
        return true;
      }
    }
    return false;
  }

  function checkChallengeElements() {
    for (const sel of CHALLENGE_SELECTORS) {
      if (document.querySelector(sel)) {
        setIntervention('challenge', 'Cloudflare challenge detected', sel);
        return true;
      }
    }
    return false;
  }

  function checkLoginForms() {
    const passwordInputs = document.querySelectorAll('form input[type="password"]');
    if (passwordInputs.length > 0) {
      const url = window.location.href.toLowerCase();
      const isLoginPage = url.includes('/login') || url.includes('/signin') || url.includes('/sign-in') || url.includes('/auth');
      if (!isLoginPage) {
        setIntervention('login', 'Unexpected login form detected', 'input[type="password"]');
        return true;
      }
    }
    return false;
  }

  function checkOAuthRedirects() {
    const url = window.location.href;
    for (const pattern of OAUTH_URL_PATTERNS) {
      if (url.includes(pattern)) {
        setIntervention('oauth', 'OAuth redirect detected');
        return true;
      }
    }
    return false;
  }

  function runAllChecks() {
    if (window.__leapfrog_intervention) return;
    checkCaptchaIframes() ||
    checkChallengeElements() ||
    checkOAuthRedirects() ||
    checkLoginForms() ||
    checkTextPatterns();
  }

  // Periodic fallback check every 2s
  const interval = setInterval(() => {
    if (window.__leapfrog_intervention_resolved) {
      clearInterval(interval);
      return;
    }
    runAllChecks();
  }, 2000);

  function checkIframeSrc(iframe) {
    const src = iframe.getAttribute('src') || '';
    for (const pattern of CAPTCHA_IFRAME_PATTERNS) {
      if (src.includes(pattern) && isIframeVisible(iframe)) {
        setIntervention('captcha', 'CAPTCHA detected', 'iframe[src*="' + pattern + '"]');
        return true;
      }
    }
    for (const pattern of RECAPTCHA_CHALLENGE_PATTERNS) {
      if (src.includes(pattern) && isIframeVisible(iframe) && !isInvisibleRecaptcha(src)) {
        setIntervention('captcha', 'CAPTCHA detected', 'iframe[src*="' + pattern + '"]');
        return true;
      }
    }
    return false;
  }

  // MutationObserver for fast detection of new iframes / challenge elements
  const observer = new MutationObserver((mutations) => {
    if (window.__leapfrog_intervention) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        // Check if added node is a captcha iframe
        if (node.tagName === 'IFRAME') {
          if (checkIframeSrc(node)) return;
        }
        // Check if added node matches challenge selectors
        for (const sel of CHALLENGE_SELECTORS) {
          if (node.matches && node.matches(sel)) {
            setIntervention('challenge', 'Cloudflare challenge detected', sel);
            return;
          }
        }
        // Check for captcha iframes inside added subtree
        const nestedIframes = node.querySelectorAll ? node.querySelectorAll('iframe[src]') : [];
        for (const iframe of nestedIframes) {
          if (checkIframeSrc(iframe)) return;
        }
      }
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Initial sweep
  runAllChecks();
})();`;
}

// ─── On-Demand Detection Check ────────────────────────────────────────────

/**
 * Returns JS for page.evaluate() that runs all detection checks immediately
 * and returns the result (or null if nothing detected).
 */
export function getDetectionCheckScript(): string {
  return `(() => {
  // If already detected by init script, return it
  if (window.__leapfrog_intervention) {
    return window.__leapfrog_intervention;
  }

  const CAPTCHA_IFRAME_PATTERNS = [
    'hcaptcha',
    'challenges.cloudflare.com'
  ];

  const RECAPTCHA_CHALLENGE_PATTERNS = [
    'recaptcha/api2/anchor',
    'recaptcha/api2/bframe'
  ];

  const TEXT_PATTERNS = [
    /verify.*(human|not.*robot)/i,
    /complete.*captcha/i,
    /security.*check/i
  ];

  const CHALLENGE_SELECTORS = [
    'div#challenge-running',
    'div.cf-browser-verification'
  ];

  const OAUTH_URL_PATTERNS = [
    '/oauth/',
    '/authorize',
    '/login/oauth'
  ];

  function isInvisibleRecaptcha(src) {
    try {
      const u = new URL(src, window.location.href);
      if (u.searchParams.get('size') === 'invisible') return true;
    } catch (e) {}
    return false;
  }

  // Check captcha iframes
  const iframes = document.querySelectorAll('iframe[src]');
  for (const iframe of iframes) {
    const src = iframe.getAttribute('src') || '';
    const visible = iframe.offsetWidth > 0 && iframe.offsetHeight > 0;
    if (!visible) continue;
    for (const pattern of CAPTCHA_IFRAME_PATTERNS) {
      if (src.includes(pattern)) {
        return { type: 'captcha', reason: 'CAPTCHA detected', elementSelector: 'iframe[src*="' + pattern + '"]', timestamp: Date.now() };
      }
    }
    for (const pattern of RECAPTCHA_CHALLENGE_PATTERNS) {
      if (src.includes(pattern) && !isInvisibleRecaptcha(src)) {
        return { type: 'captcha', reason: 'CAPTCHA detected', elementSelector: 'iframe[src*="' + pattern + '"]', timestamp: Date.now() };
      }
    }
  }

  // Check challenge elements
  for (const sel of CHALLENGE_SELECTORS) {
    if (document.querySelector(sel)) {
      return { type: 'challenge', reason: 'Cloudflare challenge detected', elementSelector: sel, timestamp: Date.now() };
    }
  }

  // Check OAuth redirects
  const url = window.location.href;
  for (const pattern of OAUTH_URL_PATTERNS) {
    if (url.includes(pattern)) {
      return { type: 'oauth', reason: 'OAuth redirect detected', elementSelector: null, timestamp: Date.now() };
    }
  }

  // Check login forms on unexpected pages
  const passwordInputs = document.querySelectorAll('form input[type="password"]');
  if (passwordInputs.length > 0) {
    const lower = url.toLowerCase();
    const isLoginPage = lower.includes('/login') || lower.includes('/signin') || lower.includes('/sign-in') || lower.includes('/auth');
    if (!isLoginPage) {
      return { type: 'login', reason: 'Unexpected login form detected', elementSelector: 'input[type="password"]', timestamp: Date.now() };
    }
  }

  // Check text patterns
  const body = document.body;
  if (body) {
    const text = body.innerText || '';
    const patterns = [
      /verify.*(human|not.*robot)/i,
      /complete.*captcha/i,
      /security.*check/i
    ];
    for (const p of patterns) {
      if (p.test(text)) {
        return { type: 'captcha', reason: 'Human verification text detected', elementSelector: null, timestamp: Date.now() };
      }
    }
  }

  return null;
})()`;
}

// ─── Overlay ──────────────────────────────────────────────────────────────

/**
 * Returns JS to inject the @..@ fullscreen overlay with a reason message
 * and a "Done" button. The overlay uses z-index 2147483647 (max 32-bit).
 */
export function getOverlayScript(reason: string): string {
  // Escape the reason for safe embedding in JS string literal
  const safeReason = reason.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');

  return `(() => {
  // Remove existing overlay if any
  const existing = document.getElementById('leapfrog-intervention-overlay');
  if (existing) existing.remove();
  const existingBar = document.getElementById('leapfrog-intervention-topbar');
  if (existingBar) existingBar.remove();

  // BUG-005: Prepend warning to document title for tab visibility
  if (!document.title.startsWith('\\u26a0\\ufe0f NEEDS HUMAN')) {
    document.title = '\\u26a0\\ufe0f NEEDS HUMAN \\u2014 ' + document.title;
  }

  // BUG-006: Persistent red top bar visible at any tile size
  const topBar = document.createElement('div');
  topBar.id = 'leapfrog-intervention-topbar';
  topBar.setAttribute('data-leapfrog', 'true');
  topBar.textContent = '\\u26a0\\ufe0f NEEDS HUMAN';
  topBar.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 100%',
    'height: 32px',
    'background: #ef4444',
    'color: white',
    'z-index: 2147483647',
    'font-size: 14px',
    'text-align: center',
    'line-height: 32px',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    'font-weight: 600',
    'letter-spacing: 0.02em',
    'pointer-events: none'
  ].join('; ');
  document.body.appendChild(topBar);
  document.body.style.marginTop = '32px';

  const overlay = document.createElement('div');
  overlay.id = 'leapfrog-intervention-overlay';
  overlay.setAttribute('data-leapfrog', 'true');
  overlay.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 100vw',
    'height: 100vh',
    'background: rgba(0, 0, 0, 0.85)',
    'z-index: 2147483647',
    'display: flex',
    'flex-direction: column',
    'align-items: center',
    'justify-content: center',
    'font-family: "SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
    'color: #22c55e',
    'pointer-events: auto'
  ].join('; ');

  // Eyes
  const eyes = document.createElement('div');
  eyes.setAttribute('data-leapfrog', 'true');
  eyes.textContent = '@..@';
  eyes.style.cssText = [
    'font-size: 64px',
    'line-height: 1',
    'letter-spacing: 0.05em',
    'margin-bottom: 24px',
    'user-select: none',
    'text-shadow: 0 0 20px rgba(34, 197, 94, 0.4)'
  ].join('; ');

  // Arrow pointing down (CSS triangle)
  const arrow = document.createElement('div');
  arrow.setAttribute('data-leapfrog', 'true');
  arrow.style.cssText = [
    'width: 0',
    'height: 0',
    'border-left: 16px solid transparent',
    'border-right: 16px solid transparent',
    'border-top: 24px solid #22c55e',
    'margin-bottom: 24px'
  ].join('; ');

  // Reason text
  const reasonEl = document.createElement('div');
  reasonEl.setAttribute('data-leapfrog', 'true');
  reasonEl.textContent = '${safeReason}';
  reasonEl.style.cssText = [
    'font-size: 20px',
    'color: #e2e8f0',
    'text-align: center',
    'max-width: 500px',
    'line-height: 1.5',
    'margin-bottom: 40px'
  ].join('; ');

  // Done button
  const btn = document.createElement('button');
  btn.id = 'leapfrog-intervention-done';
  btn.setAttribute('data-leapfrog', 'true');
  btn.textContent = 'Done';
  btn.style.cssText = [
    'font-family: inherit',
    'font-size: 18px',
    'font-weight: 600',
    'color: #000',
    'background: #22c55e',
    'border: none',
    'border-radius: 12px',
    'padding: 14px 48px',
    'cursor: pointer',
    'transition: background 0.15s ease, transform 0.1s ease',
    'outline: none'
  ].join('; ');

  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#16a34a';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#22c55e';
  });
  btn.addEventListener('mousedown', () => {
    btn.style.transform = 'scale(0.97)';
  });
  btn.addEventListener('mouseup', () => {
    btn.style.transform = 'scale(1)';
  });

  btn.addEventListener('click', () => {
    window.__leapfrog_intervention_resolved = true;
    window.__leapfrog_intervention = null;
    overlay.remove();
    // Clean up top bar
    const bar = document.getElementById('leapfrog-intervention-topbar');
    if (bar) bar.remove();
    document.body.style.marginTop = '';
    // Restore document title
    document.title = document.title.replace(/^\\u26a0\\ufe0f NEEDS HUMAN \\u2014 /, '');
  });

  overlay.appendChild(eyes);
  overlay.appendChild(arrow);
  overlay.appendChild(reasonEl);
  overlay.appendChild(btn);
  document.body.appendChild(overlay);
})();`;
}

// ─── Dismiss Overlay ──────────────────────────────────────────────────────

/**
 * Returns JS to remove the overlay without marking as resolved.
 * Useful when the caller wants to dismiss programmatically.
 */
export function getDismissScript(): string {
  return `(() => {
  const overlay = document.getElementById('leapfrog-intervention-overlay');
  if (overlay) overlay.remove();
  const bar = document.getElementById('leapfrog-intervention-topbar');
  if (bar) bar.remove();
  document.body.style.marginTop = '';
  document.title = document.title.replace(/^\\u26a0\\ufe0f NEEDS HUMAN \\u2014 /, '');
})()`;
}

// ─── Resolution Check ─────────────────────────────────────────────────────

/**
 * Returns JS for page.evaluate() that checks if the user clicked "Done".
 */
export function getResolutionCheckScript(): string {
  return `(() => {
  return !!window.__leapfrog_intervention_resolved;
})()`;
}

// ─── Fullscreen Takeover ──────────────────────────────────────────────────

/**
 * Returns JS that requests fullscreen via a callback the caller wires to CDP.
 * The actual CDP call (Browser.setWindowBounds) happens in index.ts, not here.
 */
export function getFullscreenScript(): string {
  return `(() => {
  if (typeof window.__leapfrog_requestFullscreen === 'function') {
    window.__leapfrog_requestFullscreen();
  }
})()`;
}

// ─── Parse Detection Result ───────────────────────────────────────────────

const VALID_TYPES = new Set<InterventionType>(['captcha', 'login', 'oauth', 'challenge', 'manual']);

/**
 * Parse and validate raw output from page.evaluate() of the detection scripts.
 * Returns a typed InterventionEvent or null if the input is invalid / empty.
 */
export function parseDetectionResult(raw: unknown): InterventionEvent | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  if (typeof obj.type !== 'string' || !VALID_TYPES.has(obj.type as InterventionType)) {
    return null;
  }

  if (typeof obj.reason !== 'string') return null;
  if (typeof obj.timestamp !== 'number') return null;

  return {
    type: obj.type as InterventionType,
    reason: obj.reason,
    elementSelector: typeof obj.elementSelector === 'string' ? obj.elementSelector : undefined,
    timestamp: obj.timestamp,
  };
}
