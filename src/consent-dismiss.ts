// ─── Consent Dismiss ──────────────────────────────────────────────────────
//
// Auto-detects and dismisses cookie/consent dialogs on web pages.
// Covers the top 10 consent frameworks plus generic text-matching fallback.
//
// All functions return JavaScript strings to inject via page.addInitScript()
// or page.evaluate(). This module has no side effects — the caller decides
// when and where to inject.
//
// Opt-in via LEAP_AUTO_CONSENT=true env var (caller checks, not this module).
//
// Per-domain cache: window.__leapfrog_consent_cache stores the winning
// selector for each domain. On revisit the cached selector fires first
// (instant dismissal, no 1.5s wait). Disk persistence is handled by
// domain-knowledge.ts — this module is session-scoped only.
//

// ─── Types ────────────────────────────────────────────────────────────────

export interface ConsentFramework {
  name: string;
  selectors: string[];
}

// ─── Selector Database ────────────────────────────────────────────────────

export const CONSENT_SELECTORS: ConsentFramework[] = [
  {
    name: "OneTrust",
    selectors: [
      "#onetrust-accept-btn-handler",
      ".onetrust-close-btn-handler",
    ],
  },
  {
    name: "CookieBot",
    selectors: [
      "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
      'a[id*="CybotCookiebot"][id*="Allow"]',
    ],
  },
  {
    name: "TrustArc",
    selectors: [
      ".truste-consent-required",
      "a.call",
      ".pdynamicbutton",
    ],
  },
  {
    name: "Quantcast",
    selectors: [
      '.qc-cmp2-summary-buttons button[mode="primary"]',
      ".qc-cmp-button",
    ],
  },
  {
    name: "Didomi",
    selectors: [
      "#didomi-notice-agree-button",
      ".didomi-continue-without-agreeing",
    ],
  },
  {
    name: "Cookielaw",
    selectors: [
      ".cc-compliance .cc-btn",
      ".cc-dismiss",
    ],
  },
  {
    name: "Osano",
    selectors: [
      ".osano-cm-accept-all",
    ],
  },
  {
    name: "Usercentrics",
    selectors: [
      'button[data-testid="uc-accept-all-button"]',
    ],
  },
  {
    name: "Generic banner",
    selectors: [
      '[class*="cookie"] button',
      '[class*="consent"] button',
      '[id*="cookie"] button',
    ],
  },
];

// ─── Terms/TOS Checkbox Selectors ────────────────────────────────────────
//
// Auto-check terms/privacy checkboxes during form interaction. These fire
// only when a form is being filled, not on page load (to avoid false positives).
// Successful selectors are recorded in domain knowledge for instant replay.

export const TERMS_SELECTORS: string[] = [
  'input[type="checkbox"][name*="terms"]',
  'input[type="checkbox"][name*="agree"]',
  'input[type="checkbox"][name*="accept"]',
  'input[type="checkbox"][name*="tos"]',
  'input[type="checkbox"][name*="privacy"]',
  'input[type="checkbox"][id*="terms"]',
  'input[type="checkbox"][id*="agree"]',
  'input[type="checkbox"][id*="accept"]',
  'input[type="checkbox"][id*="tos"]',
  'input[type="checkbox"][id*="policy"]',
];

/**
 * Returns JS to inject via page.evaluate() that auto-checks unchecked
 * terms/privacy/TOS checkboxes. Only targets form checkboxes whose labels
 * or names indicate legal agreements. Returns which selectors matched.
 */
export function getTermsAutoCheckScript(): string {
  return `(function() {
  var SELECTORS = ${JSON.stringify(TERMS_SELECTORS)};
  var checked = [];
  for (var i = 0; i < SELECTORS.length; i++) {
    var els = document.querySelectorAll(SELECTORS[i]);
    for (var j = 0; j < els.length; j++) {
      if (!els[j].checked) {
        els[j].checked = true;
        els[j].dispatchEvent(new Event('change', { bubbles: true }));
        checked.push(SELECTORS[i]);
      }
    }
  }
  return { checked: checked.length, selectors: checked };
})()`;
}

// ─── Text-Match Pattern ───────────────────────────────────────────────────

const TEXT_MATCH_REGEX = "/^\\s*(accept\\s*(all|cookies)?|i\\s*agree|agree|got\\s*it|ok)\\s*$/i";

// ─── Script Builders ──────────────────────────────────────────────────────

/**
 * Returns JS to inject via page.addInitScript().
 * After page load + 1.5s delay, attempts to dismiss consent dialogs.
 * Sets up a MutationObserver for lazily-loaded banners (auto-disconnects at 10s).
 */
export function getConsentDismissScript(): string {
  return `(function() {
  if (window.__leapfrog_consent_initialized) return;
  window.__leapfrog_consent_initialized = true;

  // ── Selector database ───────────────────────────────────────────────
  var FRAMEWORKS = ${JSON.stringify(CONSENT_SELECTORS)};
  var TEXT_RE = ${TEXT_MATCH_REGEX};

  // ── Cache ───────────────────────────────────────────────────────────
  if (!window.__leapfrog_consent_cache) {
    window.__leapfrog_consent_cache = {};
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute('data-leapfrog') === 'true') return false;
    var rect = el.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    var inViewport = rect.top < window.innerHeight && rect.bottom > 0
                  && rect.left < window.innerWidth && rect.right > 0;
    return inViewport;
  }

  function isOnPolicyPage() {
    var url = window.location.href.toLowerCase();
    return url.indexOf('cookie-policy') !== -1 || url.indexOf('privacy') !== -1;
  }

  function tryClick(el) {
    if (!el || !isVisible(el)) return false;
    el.click();
    return true;
  }

  // ── Core dismiss function ───────────────────────────────────────────

  window.__leapfrog_dismissConsent = function() {
    if (window.__leapfrog_consent_dismissed) {
      return { dismissed: false, selector: '', framework: 'already-dismissed' };
    }
    if (isOnPolicyPage()) {
      return { dismissed: false, selector: '', framework: 'policy-page-skip' };
    }

    var domain = window.location.hostname;

    // 1. Try cached selector first
    var cached = window.__leapfrog_consent_cache[domain];
    if (cached) {
      var cachedEl = document.querySelector(cached);
      if (tryClick(cachedEl)) {
        window.__leapfrog_consent_dismissed = true;
        return { dismissed: true, selector: cached, framework: 'cached' };
      }
    }

    // 2. Try framework-specific selectors
    for (var i = 0; i < FRAMEWORKS.length; i++) {
      var fw = FRAMEWORKS[i];
      for (var j = 0; j < fw.selectors.length; j++) {
        var sel = fw.selectors[j];
        try {
          var el = document.querySelector(sel);
          if (tryClick(el)) {
            window.__leapfrog_consent_cache[domain] = sel;
            window.__leapfrog_consent_dismissed = true;
            return { dismissed: true, selector: sel, framework: fw.name };
          }
        } catch (_) { /* invalid selector in this context, skip */ }
      }
    }

    // 3. Fall back to text matching on visible buttons/links
    //    Check both global candidates and elements inside modal dialogs
    //    (CNN and similar sites use styled-component modals with <a> links)
    var candidateSelectors = [
      'button', 'a[role="button"]', '[role="button"]', 'a',
      '[role="dialog"] button', '[role="dialog"] a',
      '.modal button', '.modal a',
      '[class*="modal"] button', '[class*="modal"] a'
    ];
    var candidates = document.querySelectorAll(candidateSelectors.join(', '));
    for (var k = 0; k < candidates.length; k++) {
      var c = candidates[k];
      if (c.getAttribute && c.getAttribute('data-leapfrog') === 'true') continue;
      var text = (c.textContent || '').trim();
      if (TEXT_RE.test(text) && isVisible(c)) {
        var matchSel = 'text:' + text;
        window.__leapfrog_consent_cache[domain] = matchSel;
        c.click();
        window.__leapfrog_consent_dismissed = true;
        return { dismissed: true, selector: matchSel, framework: 'GDPR Generic' };
      }
    }

    return { dismissed: false, selector: '', framework: 'none' };
  };

  // ── Auto-run after DOMContentLoaded + 1.5s ─────────────────────────

  function scheduleRun() {
    setTimeout(function() {
      window.__leapfrog_dismissConsent();
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleRun);
  } else {
    scheduleRun();
  }

  // ── MutationObserver for lazily-loaded banners ──────────────────────

  var observer = new MutationObserver(function(mutations) {
    if (window.__leapfrog_consent_dismissed) {
      observer.disconnect();
      return;
    }
    // Only re-check if nodes were actually added
    for (var m = 0; m < mutations.length; m++) {
      if (mutations[m].addedNodes.length > 0) {
        window.__leapfrog_dismissConsent();
        break;
      }
    }
  });

  function startObserver() {
    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    // Auto-disconnect after 10s to prevent memory leaks
    setTimeout(function() { observer.disconnect(); }, 10000);
  }

  if (document.body) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver);
  }

})();`;
}

/**
 * Returns JS that checks if a consent dialog is currently visible.
 * Evaluates to `{ detected: boolean, frameworks: string[] }`.
 */
export function getConsentDetectScript(): string {
  return `(function() {
  var FRAMEWORKS = ${JSON.stringify(CONSENT_SELECTORS)};
  var TEXT_RE = ${TEXT_MATCH_REGEX};
  var detected = [];

  function isVisible(el) {
    if (!el) return false;
    if (el.getAttribute && el.getAttribute('data-leapfrog') === 'true') return false;
    var rect = el.getBoundingClientRect();
    if (rect.height === 0 || rect.width === 0) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    return rect.top < window.innerHeight && rect.bottom > 0
        && rect.left < window.innerWidth && rect.right > 0;
  }

  for (var i = 0; i < FRAMEWORKS.length; i++) {
    var fw = FRAMEWORKS[i];
    for (var j = 0; j < fw.selectors.length; j++) {
      try {
        var el = document.querySelector(fw.selectors[j]);
        if (isVisible(el)) {
          detected.push(fw.name);
          break;
        }
      } catch (_) {}
    }
  }

  // Text fallback check — includes <a> tags and modal-scoped elements
  var candidateSelectors = [
    'button', 'a[role="button"]', '[role="button"]', 'a',
    '[role="dialog"] button', '[role="dialog"] a',
    '.modal button', '.modal a',
    '[class*="modal"] button', '[class*="modal"] a'
  ];
  var candidates = document.querySelectorAll(candidateSelectors.join(', '));
  for (var k = 0; k < candidates.length; k++) {
    var text = (candidates[k].textContent || '').trim();
    if (TEXT_RE.test(text) && isVisible(candidates[k])) {
      detected.push('GDPR Generic');
      break;
    }
  }

  return { detected: detected.length > 0, frameworks: detected };
})()`;
}

/**
 * Returns JS to manually trigger consent dismissal (for retry scenarios).
 * Resets the dismissed flag so the function runs fresh.
 */
export function getManualDismissScript(): string {
  return `(function() {
  window.__leapfrog_consent_dismissed = false;
  if (typeof window.__leapfrog_dismissConsent === 'function') {
    return window.__leapfrog_dismissConsent();
  }
  return { dismissed: false, selector: '', framework: 'not-initialized' };
})()`;
}

/**
 * Returns JS to cache a successful selector for a domain.
 * Used when the caller already knows what worked (e.g. from disk persistence).
 */
export function getCacheSelectorScript(domain: string, selector: string): string {
  const safeDomain = domain.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const safeSelector = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `(function() {
  if (!window.__leapfrog_consent_cache) {
    window.__leapfrog_consent_cache = {};
  }
  window.__leapfrog_consent_cache['${safeDomain}'] = '${safeSelector}';
  return true;
})()`;
}
