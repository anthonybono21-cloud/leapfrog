// ─── Anti-Bot Evasion ─────────────────────────────────────────────────────
//
// Stealth patches for headless Chromium to avoid bot detection.
// Three modes controlled by LEAP_STEALTH env var:
//
//   LEAP_STEALTH=true    (default) — full stealth: automation removal + identity faking
//   LEAP_STEALTH=passive — passive only: remove automation signals, do NOT fake identity
//   LEAP_STEALTH=false   — stealth completely disabled
//
// Passive mode was introduced because advanced fingerprinters (CreepJS) detect
// INCONSISTENCIES from identity faking (fake plugins, WebGL, platform, etc.)
// as "lies." A browser that simply removes automation signals without faking
// identity scores 0% lies / 0% bot, versus 33% lies / 20% bot with full stealth.
//
// Standalone module — no cross-dependencies on logger or session-manager.
//
// ─── Evasion Index ────────────────────────────────────────────────────────
//
// Category A — Automation Signal Removal (PASSIVE + ACTIVE):
//   These remove evidence that a browser is automated.
//   2. navigator.webdriver = true              → init script, re-applied every navigation
//  14. sourceurl stripping (Playwright injects sourceURL comments)
//  15. Runtime.enable CDP detection             → Error.prepareStackTrace filter
//   -  Playwright globals cleanup (__pwInitScripts, __playwright, etc.)
//   -  ChromeDriver property removal
//   -  framenavigated webdriver re-deletion listener
//
// Category B — Identity Faking (ACTIVE ONLY):
//   These create a fake identity. Advanced fingerprinters detect these as lies.
//   1. HeadlessChrome in Client Hints brands  → userAgentData override
//   4. SwiftShader WebGL vendor/renderer       → WebGL1/2 override
//   5. Connection RTT = 0                      → navigator.connection override
//   7. outerHeight === innerHeight             → fake chrome offset (85px)
//   8. 0 mime types                            → MimeTypeArray spoof
//   9. Platform mismatch with custom UA        → inferPlatformFromUA()
//  10. chrome.app emulation
//  11. iframe contentWindow protection
//  12. media codecs spoofing (canPlayType override)
//  13. document.hasFocus() override
//  16. Permissions.prototype.query override
//  17. AudioContext fingerprint noise
//  18. WebRTC IP filtering
//  19. Font enumeration spoofing
//   -  navigator.plugins spoofing (5 fake plugins)
//   -  navigator.languages override
//   -  navigator.hardwareConcurrency/deviceMemory spoofing
//   -  Notification.permission override
//   -  Canvas fingerprint noise (session-seeded PRNG)
//   -  chrome.runtime/loadTimes/csi emulation
//   -  Worker/SharedWorker UA leak prevention
//
// Already passing (do not touch):
//  - UA string looks like real Chrome 136
//  - window.chrome present, 5 plugins, languages correct
//  - No Selenium/PhantomJS markers (all 17 absent)
//  - DevTools Protocol not detected
//  - Canvas fingerprint consistent across iframes
//  - Battery API realistic

import type { Page } from "playwright-core";
import type { Fingerprint } from "./humanize-fingerprint.js";

export type StealthModeType = 'off' | 'passive' | 'active';

// ── rebrowser-patches integration note ────────────────────────────────────
// rebrowser-patches (https://github.com/nicedoc/rebrowser-patches) patches
// Playwright's CDP layer to avoid Runtime.enable detection. If we integrate
// it in the future, the entry point is:
//   1. Replace playwright-core import with rebrowser-playwright
//   2. Call `rebrowser.patch()` before any browser launch in session-manager
//   3. The CDP stealth script (getCdpStealthScript) would become redundant
// Evaluate as a dependency change in a dedicated PR — do not install inline.
// ──────────────────────────────────────────────────────────────────────────

export class StealthMode {
  /**
   * Strip sourceURL comments from init script text.
   * Playwright injects `//# sourceURL=__playwright_evaluation_script__` into
   * eval'd scripts which bot detectors look for. This strips any sourceURL
   * or sourceMappingURL directives from our init scripts before injection.
   */
  private sanitizeSourceURL(script: string): string {
    return script.replace(/\/\/[#@]\s*source(Mapping)?URL\s*=\s*[^\n]*/g, '');
  }

  /**
   * Chromium launch args that reduce automation fingerprinting.
   *
   * In passive mode, only automation-hiding args are included.
   * In active mode, GPU-related args for WebGL faking are also added.
   */
  getLaunchArgs(): string[] {
    const mode = this.getMode();

    // Category A args — remove automation signals (passive + active)
    const args: string[] = [
      // P0 #2: Suppress navigator.webdriver at Blink level
      "--disable-blink-features=AutomationControlled",

      // BUG-003: Disable AutomationControlled feature flag to prevent
      // "HeadlessChrome" from appearing in Client Hints brands
      "--disable-features=AutomationControlled",

      // Standard headless-mode hardening
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
    ];

    // Category B args — GPU/identity faking (active only)
    if (mode === 'active') {
      // P1 #4: Force real GPU rendering instead of SwiftShader
      // SwiftShader shows "Google SwiftShader" in UNMASKED_VENDOR/RENDERER
      args.push("--use-gl=angle", "--use-angle=default");
    }

    return args;
  }

  /**
   * Realistic Chrome user agent string for macOS.
   */
  getDefaultUserAgent(): string {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
  }

  /**
   * Infer the correct navigator.platform value from a user-agent string.
   * Prevents P2 #9: platform mismatch when custom UA says Windows but
   * platform says MacIntel.
   */
  inferPlatformFromUA(ua: string): string {
    if (/Windows/i.test(ua)) return "Win32";
    if (/Macintosh|Mac OS X/i.test(ua)) return "MacIntel";
    if (/Linux/i.test(ua)) return "Linux x86_64";
    if (/CrOS/i.test(ua)) return "Linux x86_64";
    if (/Android/i.test(ua)) return "Linux armv8l";
    if (/iPhone|iPad/i.test(ua)) return "iPhone";
    return "MacIntel"; // safe default
  }

  /**
   * Returns a random delay in ms (200-500) for dialog auto-dismiss.
   * P1 #6: Instant dismiss (< 30ms) is a headless signal.
   * Call this from dialog handlers in session-manager and tab-manager.
   */
  getDialogDelay(): number {
    return 200 + Math.floor(Math.random() * 300);
  }

  /**
   * Derive the correct navigator.platform string from process.platform.
   * Used as the fallback when no UA string is available to infer from.
   */
  getPlatformFromProcess(): string {
    switch (process.platform) {
      case "win32":  return "Win32";
      case "darwin": return "MacIntel";
      case "linux":  return "Linux x86_64";
      default:       return "MacIntel";
    }
  }

  /**
   * Extract the Chrome major version number from a UA string.
   * Falls back to 136 (current default UA) if not found.
   */
  extractChromeMajorVersion(ua: string): number {
    const match = ua.match(/Chrome\/(\d+)\./);
    return match ? parseInt(match[1], 10) : 136;
  }

  /**
   * Generate a numeric seed from a string (simple djb2 hash).
   * Used to seed per-session PRNG for canvas/audio noise determinism.
   */
  private hashSeed(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  // ────────────────────────────────────────────────────────────────────────
  // Init Script — Split into Passive (Category A) and Active (Category B)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Category A: Passive init script — removes automation signals only.
   * These patches make an automated browser look like a non-automated browser
   * WITHOUT faking its identity. Safe against advanced fingerprinters like CreepJS
   * because they don't introduce detectable inconsistencies ("lies").
   *
   * Patches included:
   * - Playwright globals cleanup (__pwInitScripts, __playwright, etc.)
   * - navigator.webdriver deletion (P0 #2)
   * - ChromeDriver property removal
   * - sourceURL stripping (#14)
   */
  private getPassiveInitScript(): string {
    return `
      // ────────────────────────────────────────────────────────────────────
      // BUG FIX: __pwInitScripts race condition
      // Delete Playwright automation globals IMMEDIATELY at the top of the
      // very first init script. This closes the window where page JS or
      // subsequent init scripts could observe __pwInitScripts before the
      // separate cleanup script runs. Critical for v0.6.0 which adds 3+
      // more init scripts, widening the race window.
      // ────────────────────────────────────────────────────────────────────
      (function() {
        var globals = ['__pwInitScripts', '__playwright__binding__', '__playwright'];
        for (var i = 0; i < globals.length; i++) {
          try { delete window[globals[i]]; } catch(e) {}
          try {
            Object.defineProperty(window, globals[i], {
              get: function() { return undefined; },
              set: function() {},
              configurable: true,
            });
          } catch(e) {}
        }
      })();

      // ────────────────────────────────────────────────────────────────────
      // P0 #2: Hide navigator.webdriver
      // BUG-004: Use delete + defineProperty + prototype patch for full coverage.
      // Some detection scripts check the prototype directly or use 'in' operator.
      // The --disable-blink-features=AutomationControlled launch arg should
      // handle this, but QA found it does not always take effect. This
      // redundant override ensures webdriver is hidden on every navigation.
      // ────────────────────────────────────────────────────────────────────
      try {
        delete Object.getPrototypeOf(navigator).webdriver;
        delete Navigator.prototype.webdriver;
        delete navigator.webdriver;
      } catch (e) { /* already deleted or non-configurable */ }
      if ('webdriver' in navigator) {
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true,
            enumerable: false,
          });
        } catch (e) { /* best effort */ }
      }

      // ────────────────────────────────────────────────────────────────────
      // Remove ChromeDriver detection property
      // ────────────────────────────────────────────────────────────────────
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_;

      // ────────────────────────────────────────────────────────────────────
      // #14: sourceurl stripping
      // Playwright injects //# sourceURL= comments into evaluated scripts.
      // Detection sites look for these as automation fingerprints.
      // We override Error.prepareStackTrace to strip sourceURL references.
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const origPrepareStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = function(error, callSites) {
          if (origPrepareStackTrace) {
            return origPrepareStackTrace(error, callSites);
          }
          const stack = callSites
            .filter(site => {
              const filename = site.getFileName() || '';
              return !filename.startsWith('pptr:') &&
                     !filename.includes('__playwright') &&
                     !filename.includes('sourceURL');
            })
            .map(site => '    at ' + site.toString())
            .join('\\n');
          return error.toString() + '\\n' + stack;
        };
      })();
    `;
  }

  /**
   * Category B: Active init script — identity faking patches.
   * These create a fake browser identity (plugins, WebGL, platform, etc.).
   * Advanced fingerprinters like CreepJS can detect these as "lies" because
   * they create inconsistencies between reported and actual values.
   *
   * Only applied when LEAP_STEALTH=true (active mode, the default).
   *
   * Patches included:
   * - Session-seeded PRNG (mulberry32)
   * - Client Hints brands override (P0 #1)
   * - chrome.app/runtime/loadTimes/csi emulation (#10)
   * - Permissions.prototype.query override (P2 #16)
   * - navigator.plugins spoofing (5 fake plugins)
   * - MimeTypeArray spoof (P2 #8)
   * - navigator.languages override
   * - navigator.platform override (P2 #9)
   * - hardwareConcurrency/deviceMemory spoofing
   * - Notification.permission override
   * - WebGL vendor/renderer override (P1 #4)
   * - Connection RTT override (P1 #5)
   * - outerHeight/outerWidth fake (P2 #7)
   * - document.hasFocus() override (#13)
   * - Media codecs spoofing (#12)
   * - Canvas fingerprint noise (Phase 2.2)
   * - AudioContext fingerprint noise (P3 #17)
   * - WebRTC IP filtering (P3 #18)
   * - Font enumeration spoofing (P3 #19)
   * - iframe contentWindow protection (#11)
   * - Worker/SharedWorker UA leak prevention
   */
  private getActiveInitScript(platform: string, ua?: string, fingerprint?: Fingerprint, sessionSeed?: number): string {
    const chromeVersion = ua
      ? this.extractChromeMajorVersion(ua)
      : this.extractChromeMajorVersion(this.getDefaultUserAgent());

    // Phase 2.1/2.5: Use fingerprint values when available, otherwise defaults
    const webglVendor = fingerprint?.webgl?.vendor ?? 'Google Inc. (Apple)';
    const webglRenderer = fingerprint?.webgl?.renderer ?? 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)';
    const deviceMemory = fingerprint?.deviceMemory ?? 8;
    const hardwareConcurrency = fingerprint?.hardwareConcurrency ?? 8;

    // Phase 2.2/2.3: Session seed for deterministic PRNG (canvas + audio noise)
    const seed = sessionSeed ?? this.hashSeed(ua ?? 'default-session');

    return `
      // ────────────────────────────────────────────────────────────────────
      // Phase 2.2/2.3: Session-seeded PRNG (mulberry32)
      // Deterministic within a session — same canvas/audio operations produce
      // identical output. Prevents tampering detection from non-deterministic noise.
      // ────────────────────────────────────────────────────────────────────
      var __leapSeed = ${seed} >>> 0;
      function __leapRandom() {
        __leapSeed |= 0; __leapSeed = __leapSeed + 0x6D2B79F5 | 0;
        var t = Math.imul(__leapSeed ^ __leapSeed >>> 15, 1 | __leapSeed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      }

      // ────────────────────────────────────────────────────────────────────
      // P0 #1 + BUG-003 (consolidated): Client Hints brands override
      // Phase 2.6: Merged two overlapping patches into one clean replacement
      // of the entire NavigatorUAData interface.
      // ────────────────────────────────────────────────────────────────────
      if (navigator.userAgentData) {
        const cleanBrands = [
          { brand: "Chromium", version: "${chromeVersion}" },
          { brand: "Google Chrome", version: "${chromeVersion}" },
          { brand: "Not_A Brand", version: "24" },
        ];
        const cleanFullBrands = [
          { brand: "Chromium", version: "${chromeVersion}.0.0.0" },
          { brand: "Google Chrome", version: "${chromeVersion}.0.0.0" },
          { brand: "Not_A Brand", version: "24.0.0.0" },
        ];

        const cleanUAData = {
          brands: cleanBrands,
          mobile: false,
          platform: ${JSON.stringify(platform.startsWith("Win") ? "Windows" : platform.startsWith("Mac") ? "macOS" : platform.startsWith("Linux") ? "Linux" : "macOS")},
          getHighEntropyValues: function(hints) {
            return Promise.resolve({
              brands: cleanFullBrands,
              mobile: false,
              platform: this.platform,
              platformVersion: ${JSON.stringify(platform.startsWith("Win") ? "10.0.0" : platform.startsWith("Mac") ? "15.0.0" : "6.6.0")},
              architecture: "x86",
              bitness: "64",
              model: "",
              uaFullVersion: "${chromeVersion}.0.0.0",
              fullVersionList: cleanFullBrands,
              wow64: false,
            });
          },
          toJSON: function() {
            return {
              brands: cleanBrands,
              mobile: false,
              platform: this.platform,
            };
          },
        };

        Object.defineProperty(navigator, 'userAgentData', {
          get: () => cleanUAData,
          configurable: true,
        });
      }

      // ────────────────────────────────────────────────────────────────────
      // Fake window.chrome object (already passing — preserve)
      // Includes chrome.app emulation (puppeteer-stealth module #1)
      // ────────────────────────────────────────────────────────────────────
      if (!window.chrome) {
        Object.defineProperty(window, 'chrome', {
          value: {},
          configurable: true,
          writable: true,
        });
      }

      // #10: chrome.app emulation — real Chrome always has this object
      if (!window.chrome.app) {
        window.chrome.app = {
          isInstalled: false,
          InstallState: {
            DISABLED: 'disabled',
            INSTALLED: 'installed',
            NOT_INSTALLED: 'not_installed',
          },
          RunningState: {
            CANNOT_RUN: 'cannot_run',
            READY_TO_RUN: 'ready_to_run',
            RUNNING: 'running',
          },
          getDetails: function() { return null; },
          getIsInstalled: function() { return false; },
          installState: function(callback) {
            if (typeof callback === 'function') {
              callback('not_installed');
            }
            return 'not_installed';
          },
          runningState: function() { return 'cannot_run'; },
        };
      }

      // chrome.runtime — already passing, preserve exact shape
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          onConnect: { addListener() {}, removeListener() {} },
          onMessage: { addListener() {}, removeListener() {} },
          connect() { return { onDisconnect: { addListener() {} } }; },
          sendMessage() {},
        };
      }

      // chrome.loadTimes — already passing, preserve
      if (!window.chrome.loadTimes) {
        window.chrome.loadTimes = function() {
          return {
            commitLoadTime: Date.now() / 1000 - 2,
            connectionInfo: 'h2',
            finishDocumentLoadTime: Date.now() / 1000 - 0.5,
            finishLoadTime: Date.now() / 1000 - 0.1,
            firstPaintAfterLoadTime: 0,
            firstPaintTime: Date.now() / 1000 - 1.5,
            navigationType: 'Other',
            npnNegotiatedProtocol: 'h2',
            requestTime: Date.now() / 1000 - 2.5,
            startLoadTime: Date.now() / 1000 - 2,
            wasAlternateProtocolAvailable: false,
            wasFetchedViaSpdy: true,
            wasNpnNegotiated: true,
          };
        };
      }

      // chrome.csi — already passing, preserve
      if (!window.chrome.csi) {
        window.chrome.csi = function() {
          return {
            onloadT: Date.now(),
            pageT: Date.now() - performance.timing.navigationStart,
            startE: performance.timing.navigationStart,
            tran: 15,
          };
        };
      }

      // ────────────────────────────────────────────────────────────────────
      // P2: Comprehensive Permissions.prototype.query override
      // Bot detection scripts query various permissions and check for
      // unexpected throws or inconsistent states. Real browsers return
      // "prompt" for most permissions and "granted" for geolocation.
      // Defends against: CreepJS permissions fingerprint, FingerprintJS Pro
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const originalQuery = window.Permissions.prototype.query;
        const promptPermissions = [
          'notifications', 'push', 'midi', 'camera', 'microphone',
          'speaker', 'device-info', 'background-fetch', 'background-sync',
          'bluetooth', 'persistent-storage', 'ambient-light-sensor',
          'accelerometer', 'gyroscope', 'magnetometer', 'screen-wake-lock',
          'nfc', 'display-capture', 'idle-detection', 'periodic-background-sync'
        ];
        window.Permissions.prototype.query = function(desc) {
          if (promptPermissions.includes(desc.name)) {
            return Promise.resolve({ state: 'prompt', onchange: null });
          }
          if (desc.name === 'geolocation') {
            return Promise.resolve({ state: 'granted', onchange: null });
          }
          return originalQuery.call(this, desc);
        };
      })();

      // ────────────────────────────────────────────────────────────────────
      // Fix navigator.plugins (5 fake plugins)
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const fakePlugins = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
            { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          ];
          const pluginArray = Object.create(PluginArray.prototype);
          for (let i = 0; i < fakePlugins.length; i++) {
            const p = Object.create(Plugin.prototype);
            Object.defineProperties(p, {
              name: { value: fakePlugins[i].name, enumerable: true },
              filename: { value: fakePlugins[i].filename, enumerable: true },
              description: { value: fakePlugins[i].description, enumerable: true },
              length: { value: 0, enumerable: true },
            });
            pluginArray[i] = p;
          }
          Object.defineProperty(pluginArray, 'length', { value: fakePlugins.length });
          pluginArray.item = (index) => pluginArray[index] || null;
          pluginArray.namedItem = (name) => {
            for (let i = 0; i < fakePlugins.length; i++) {
              if (pluginArray[i].name === name) return pluginArray[i];
            }
            return null;
          };
          pluginArray.refresh = () => {};
          return pluginArray;
        },
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // P2 #8: Spoof MimeTypeArray (headless reports 0 mime types)
      // Real Chrome always has at least 2 PDF-related mime types.
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'mimeTypes', {
        get: () => {
          const fakeMimes = [
            { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: navigator.plugins[0] },
            { type: 'text/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: navigator.plugins[0] },
          ];
          const mimeArray = Object.create(MimeTypeArray.prototype);
          for (let i = 0; i < fakeMimes.length; i++) {
            const m = Object.create(MimeType.prototype);
            Object.defineProperties(m, {
              type: { value: fakeMimes[i].type, enumerable: true },
              suffixes: { value: fakeMimes[i].suffixes, enumerable: true },
              description: { value: fakeMimes[i].description, enumerable: true },
              enabledPlugin: { value: fakeMimes[i].enabledPlugin, enumerable: true },
            });
            mimeArray[i] = m;
            mimeArray[fakeMimes[i].type] = m;
          }
          Object.defineProperty(mimeArray, 'length', { value: fakeMimes.length });
          mimeArray.item = (index) => mimeArray[index] || null;
          mimeArray.namedItem = (name) => mimeArray[name] || null;
          return mimeArray;
        },
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // Fix navigator.languages
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // P2 #9: Override navigator.platform — uses UA-inferred value
      // Prevents mismatch when custom UA says Windows but platform says MacIntel.
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'platform', {
        get: () => ${JSON.stringify(platform)},
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // Phase 2.5: hardwareConcurrency from per-session fingerprint
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => ${hardwareConcurrency},
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // Phase 2.5: deviceMemory from per-session fingerprint
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => ${deviceMemory},
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // Notification.permission returns 'default'
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // P1 #4: WebGL vendor/renderer override (SwiftShader → real GPU)
      // Phase 2.1: WebGL vendor/renderer from per-session fingerprint (9 GPU models)
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const WEBGL_VENDOR = ${JSON.stringify(webglVendor)};
        const WEBGL_RENDERER = ${JSON.stringify(webglRenderer)};
        const UNMASKED_VENDOR_WEBGL = 0x9245;
        const UNMASKED_RENDERER_WEBGL = 0x9246;

        function patchWebGLContext(proto) {
          if (!proto) return;
          const origGetParameter = proto.getParameter;
          proto.getParameter = function(param) {
            if (param === UNMASKED_VENDOR_WEBGL) return WEBGL_VENDOR;
            if (param === UNMASKED_RENDERER_WEBGL) return WEBGL_RENDERER;
            return origGetParameter.call(this, param);
          };
        }

        if (typeof WebGLRenderingContext !== 'undefined') {
          patchWebGLContext(WebGLRenderingContext.prototype);
        }
        if (typeof WebGL2RenderingContext !== 'undefined') {
          patchWebGLContext(WebGL2RenderingContext.prototype);
        }
      })();

      // ────────────────────────────────────────────────────────────────────
      // P1 #5: Connection RTT = 0 → override navigator.connection
      // ────────────────────────────────────────────────────────────────────
      if (navigator.connection) {
        const connectionOverrides = {
          rtt: 50,
          downlink: 10,
          effectiveType: '4g',
          saveData: false,
        };
        for (const [key, value] of Object.entries(connectionOverrides)) {
          try {
            Object.defineProperty(navigator.connection, key, {
              get: () => value,
              configurable: true,
            });
          } catch (e) {
            // Some browsers seal this — graceful skip
          }
        }
      }

      // ────────────────────────────────────────────────────────────────────
      // P2 #7: outerHeight === innerHeight → headless has no chrome
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const chromeHeight = 85;
        const chromeWidth = 0;

        Object.defineProperty(window, 'outerHeight', {
          get: () => window.innerHeight + chromeHeight,
          configurable: true,
        });
        Object.defineProperty(window, 'outerWidth', {
          get: () => window.innerWidth + chromeWidth,
          configurable: true,
        });
      })();

      // ────────────────────────────────────────────────────────────────────
      // #13: document.hasFocus() override
      // ────────────────────────────────────────────────────────────────────
      Document.prototype.hasFocus = function() {
        return true;
      };

      // ────────────────────────────────────────────────────────────────────
      // #12: Media codecs spoofing (canPlayType override)
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const codecResponses = {
          'audio/mpeg': 'probably',
          'audio/wav': 'probably',
          'audio/ogg; codecs="vorbis"': 'probably',
          'audio/mp4; codecs="mp4a.40.2"': 'probably',
          'audio/webm; codecs="opus"': 'probably',
          'video/mp4; codecs="avc1.42E01E"': 'probably',
          'video/mp4; codecs="avc1.42E01E, mp4a.40.2"': 'probably',
          'video/webm; codecs="vp8"': 'probably',
          'video/webm; codecs="vp8, vorbis"': 'probably',
          'video/webm; codecs="vp9"': 'probably',
          'video/ogg; codecs="theora"': 'probably',
        };

        const origCanPlayType = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function(type) {
          if (codecResponses[type]) return codecResponses[type];
          return origCanPlayType.call(this, type);
        };
      })();

      // ────────────────────────────────────────────────────────────────────
      // Phase 2.2: Canvas fingerprint noise — session-seeded PRNG
      // ────────────────────────────────────────────────────────────────────
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        const ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          try {
            const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
            const data = imageData.data;
            var canvasSeed = ${seed} >>> 0;
            for (var ci = 0; ci < Math.min(data.length, 32); ci++) { canvasSeed = (canvasSeed + data[ci]) | 0; }
            function canvasRandom() {
              canvasSeed |= 0; canvasSeed = canvasSeed + 0x6D2B79F5 | 0;
              var t = Math.imul(canvasSeed ^ canvasSeed >>> 15, 1 | canvasSeed);
              t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
              return ((t ^ t >>> 14) >>> 0) / 4294967296;
            }
            for (let i = 0; i < Math.min(data.length, 64); i += 16) {
              const channel = i + Math.floor(canvasRandom() * 3);
              const delta = canvasRandom() > 0.5 ? 1 : -1;
              data[channel] = Math.max(0, Math.min(255, data[channel] + delta));
            }
            ctx.putImageData(imageData, 0, 0);
          } catch (e) {
            // SecurityError from cross-origin canvas — skip silently
          }
        }
        return origToDataURL.call(this, type, quality);
      };

      // ────────────────────────────────────────────────────────────────────
      // P3: AudioContext fingerprint noise — session-seeded PRNG
      // ────────────────────────────────────────────────────────────────────
      (function() {
        var audioSeed = ${seed} >>> 0;
        function audioRandom() {
          audioSeed |= 0; audioSeed = audioSeed + 0x6D2B79F5 | 0;
          var t = Math.imul(audioSeed ^ audioSeed >>> 15, 1 | audioSeed);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }

        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function(channel) {
          const data = originalGetChannelData.call(this, channel);
          if (this.length < 4096 && this.sampleRate === 44100) {
            audioSeed = (${seed} + channel * 7919) >>> 0;
            for (let i = 0; i < data.length; i++) {
              data[i] += (audioRandom() * 0.0002 - 0.0001);
            }
          }
          return data;
        };

        if (typeof AnalyserNode !== 'undefined') {
          const originalGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
          AnalyserNode.prototype.getFloatFrequencyData = function(array) {
            originalGetFloat.call(this, array);
            audioSeed = ${seed} >>> 0;
            for (let i = 0; i < array.length; i++) {
              array[i] += (audioRandom() * 0.1 - 0.05);
            }
          };
        }
      })();

      // ────────────────────────────────────────────────────────────────────
      // P3: WebRTC leak prevention
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const originalRTC = window.RTCPeerConnection;
        if (originalRTC) {
          window.RTCPeerConnection = function(config, constraints) {
            if (config && config.iceServers) {
              // Allow configured TURN servers
            } else {
              config = config || {};
              config.iceServers = [];
            }
            const pc = new originalRTC(config, constraints);
            const originalAddEvent = pc.addEventListener.bind(pc);
            pc.addEventListener = function(type, listener, options) {
              if (type === 'icecandidate') {
                const wrappedListener = function(event) {
                  if (event.candidate && event.candidate.candidate) {
                    if (/((10\\.)|(172\\.(1[6-9]|2\\d|3[01])\\.)|(192\\.168\\.))/.test(event.candidate.candidate)) {
                      return;
                    }
                  }
                  listener.call(this, event);
                };
                return originalAddEvent(type, wrappedListener, options);
              }
              return originalAddEvent(type, listener, options);
            };
            return pc;
          };
          window.RTCPeerConnection.prototype = originalRTC.prototype;
          Object.keys(originalRTC).forEach(function(key) {
            window.RTCPeerConnection[key] = originalRTC[key];
          });
        }
      })();

      // ────────────────────────────────────────────────────────────────────
      // P3: Font enumeration spoofing
      // ────────────────────────────────────────────────────────────────────
      (function() {
        var standardFonts = ['Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Lucida Console', 'Tahoma', 'Palatino Linotype'];
        if (document.fonts && document.fonts.check) {
          var originalCheck = document.fonts.check.bind(document.fonts);
          document.fonts.check = function(font, text) {
            var fontName = font.replace(/[\\d.]+px\\s*/, '').replace(/["']/g, '').trim();
            if (standardFonts.some(function(f) { return fontName.toLowerCase().includes(f.toLowerCase()); })) {
              return true;
            }
            var hash = 0;
            for (var i = 0; i < fontName.length; i++) {
              hash = ((hash << 5) - hash + fontName.charCodeAt(i)) | 0;
            }
            return (Math.abs(hash) % 100) < 70;
          };
        }
      })();

      // ────────────────────────────────────────────────────────────────────
      // #11: iframe contentWindow protection
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const origHTMLIFrameElement = Object.getOwnPropertyDescriptor(
          HTMLIFrameElement.prototype, 'contentWindow'
        );
        if (origHTMLIFrameElement && origHTMLIFrameElement.get) {
          Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get: function() {
              const win = origHTMLIFrameElement.get.call(this);
              if (win) {
                try {
                  if ('webdriver' in win.navigator) {
                    delete Object.getPrototypeOf(win.navigator).webdriver;
                  }
                } catch (e) {
                  // Cross-origin iframe — cannot access, which is fine
                }
              }
              return win;
            },
            configurable: true,
          });
        }
      })();

      // ────────────────────────────────────────────────────────────────────
      // BUG-3: Worker/SharedWorker UA leak prevention
      // ────────────────────────────────────────────────────────────────────
      (function() {
        var targetPlatform = ${JSON.stringify(platform)};

        function buildWorkerPreamble() {
          return 'Object.defineProperty(self.navigator, "webdriver", { get: function() { return undefined; }, configurable: true, enumerable: false });' +
            'try { Object.defineProperty(self.navigator, "platform", { get: function() { return "' + targetPlatform + '"; }, configurable: true }); } catch(e) {}';
        }

        if (typeof Worker !== 'undefined') {
          var OriginalWorker = Worker;
          var preamble = buildWorkerPreamble();
          window.Worker = function(scriptURL, options) {
            var url = String(scriptURL);
            var isModule = options && options.type === 'module';
            if (!isModule && !url.startsWith('blob:')) {
              try {
                var wrapperCode = preamble + ';importScripts("' + url.replace(/"/g, '\\\\"') + '");';
                var blob = new Blob([wrapperCode], { type: 'application/javascript' });
                var blobURL = URL.createObjectURL(blob);
                var worker = new OriginalWorker(blobURL, options);
                URL.revokeObjectURL(blobURL);
                return worker;
              } catch(e) {
                // Fall through to original constructor on any error
              }
            }
            return new OriginalWorker(scriptURL, options);
          };
          window.Worker.prototype = OriginalWorker.prototype;
          try {
            Object.defineProperty(window.Worker, 'length', { value: OriginalWorker.length });
            Object.defineProperty(window.Worker, 'name', { value: 'Worker' });
          } catch(e) {}
        }

        if (typeof SharedWorker !== 'undefined') {
          var OriginalSharedWorker = SharedWorker;
          var sharedPreamble = buildWorkerPreamble();
          window.SharedWorker = function(scriptURL, options) {
            var url = String(scriptURL);
            var nameOrOpts = options;
            var isModule = nameOrOpts && typeof nameOrOpts === 'object' && nameOrOpts.type === 'module';
            if (!isModule && !url.startsWith('blob:')) {
              try {
                var wrapperCode = sharedPreamble + ';importScripts("' + url.replace(/"/g, '\\\\"') + '");';
                var blob = new Blob([wrapperCode], { type: 'application/javascript' });
                var blobURL = URL.createObjectURL(blob);
                var worker = new OriginalSharedWorker(blobURL, nameOrOpts);
                URL.revokeObjectURL(blobURL);
                return worker;
              } catch(e) {}
            }
            return new OriginalSharedWorker(scriptURL, nameOrOpts);
          };
          window.SharedWorker.prototype = OriginalSharedWorker.prototype;
          try {
            Object.defineProperty(window.SharedWorker, 'length', { value: OriginalSharedWorker.length });
            Object.defineProperty(window.SharedWorker, 'name', { value: 'SharedWorker' });
          } catch(e) {}
        }
      })();
    `;
  }

  /**
   * JavaScript to inject via page.addInitScript() that patches
   * common bot-detection vectors in the page's execution context.
   *
   * This script runs BEFORE page JavaScript on every navigation,
   * including in iframes (Playwright propagates addInitScript to all frames).
   *
   * In passive mode, only Category A (automation signal removal) patches are applied.
   * In active mode, both Category A and Category B (identity faking) patches are applied.
   */
  getInitScript(platform?: string, ua?: string, fingerprint?: Fingerprint, sessionSeed?: number, modeOverride?: StealthModeType): string {
    const mode = modeOverride ?? this.getMode();
    if (mode === 'off') return '';

    // Passive patches always included (both passive and active modes)
    let script = this.getPassiveInitScript();

    // Active patches only in active mode
    if (mode === 'active') {
      const safePlatform = platform ?? this.getPlatformFromProcess();
      script += '\n' + this.getActiveInitScript(safePlatform, ua, fingerprint, sessionSeed);
    }

    return script;
  }

  /**
   * Remove Playwright-specific global variables that bot detection scripts
   * trivially check for. These are injected by Playwright's init script
   * mechanism and are dead giveaways of automation.
   */
  getPlaywrightGlobalsCleanupScript(): string {
    return `
      // ────────────────────────────────────────────────────────────────────
      // Phase 1.2: Delete Playwright automation globals
      // __pwInitScripts, __playwright__binding__, __playwright are injected
      // by Playwright's bootstrapper and are trivially detectable.
      // ────────────────────────────────────────────────────────────────────
      (function() {
        var globals = ['__pwInitScripts', '__playwright__binding__', '__playwright'];
        for (var i = 0; i < globals.length; i++) {
          try { delete window[globals[i]]; } catch(e) {}
          try {
            Object.defineProperty(window, globals[i], {
              get: function() { return undefined; },
              set: function() {},
              configurable: true,
            });
          } catch(e) {}
        }
      })();
    `;
  }

  /**
   * P1: Runtime.enable CDP detection bypass init script.
   * Default ON — disable with LEAP_CDP_STEALTH=false.
   *
   * When Playwright sends Runtime.enable via CDP, bot detection scripts
   * can observe Playwright/DevTools stack frames in Error.prepareStackTrace.
   * This patch intercepts prepareStackTrace and filters out any frames
   * originating from __playwright, pptr:, or devtools:// — making the
   * stack trace indistinguishable from a real browser.
   *
   * This is separate from the #14 sourceURL stripping patch because it
   * performs a deeper filter (also strips devtools:// frames) and is
   * opt-in due to potential debugging interference.
   *
   * Defends against: Patchright/rebrowser CDP detection, DataDome Runtime.enable check
   */
  getCdpStealthScript(): string {
    return `
      // ────────────────────────────────────────────────────────────────────
      // P1: Runtime.enable CDP detection bypass (default ON, LEAP_CDP_STEALTH=false to disable)
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const originalPrepareStackTrace = Error.prepareStackTrace;
        Error.prepareStackTrace = function(error, stack) {
          const filtered = stack.filter(function(frame) {
            const fileName = frame.getFileName() || '';
            return !fileName.includes('__playwright') &&
                   !fileName.includes('pptr:') &&
                   !fileName.includes('devtools://');
          });
          if (originalPrepareStackTrace) {
            return originalPrepareStackTrace(error, filtered);
          }
          return error.toString() + '\\n' + filtered.map(function(f) { return '    at ' + f.toString(); }).join('\\n');
        };
      })();
    `;
  }

  /**
   * Whether CDP stealth mode is enabled.
   * Default ON — disable with LEAP_CDP_STEALTH=false.
   * The Error.prepareStackTrace filter hides Playwright/DevTools stack frames
   * from bot detection scripts. Safe for production; only disable if you need
   * raw stack traces for debugging.
   */
  isCdpStealthEnabled(): boolean {
    return process.env.LEAP_CDP_STEALTH !== "false";
  }

  /**
   * Apply the stealth init script to a Playwright page.
   * Call this immediately after page creation, before navigating.
   *
   * Respects the current stealth mode:
   * - passive: applies only Category A patches (automation signal removal)
   * - active:  applies Category A + Category B (identity faking)
   *
   * Also applies:
   * - Playwright globals cleanup (__pwInitScripts, __playwright__binding__, __playwright)
   * - CDP stealth script (default ON, disable via LEAP_CDP_STEALTH=false)
   */
  async applyToPage(page: Page, userAgent?: string, fingerprint?: Fingerprint, modeOverride?: StealthModeType): Promise<void> {
    const mode = modeOverride ?? this.getMode();
    if (mode === 'off') return;

    // BUG-1 fix: Always infer platform from the UA string that the browser is actually using.
    const effectiveUA = userAgent ?? this.getDefaultUserAgent();
    const platform = this.inferPlatformFromUA(effectiveUA);

    // Derive a session seed from the fingerprint for deterministic PRNG (Phase 2.2/2.3)
    const sessionSeed = fingerprint
      ? this.hashSeed(fingerprint.userAgent + fingerprint.webgl.renderer)
      : this.hashSeed(userAgent ?? 'default-session');

    // Sanitize sourceURL comments from all init scripts before injection (Phase 1.3)
    await page.addInitScript(this.sanitizeSourceURL(
      this.getInitScript(platform, userAgent, fingerprint, sessionSeed, mode)
    ));

    // Remove trivially detectable Playwright globals that leak automation context
    await page.addInitScript(this.sanitizeSourceURL(
      this.getPlaywrightGlobalsCleanupScript()
    ));

    // P1: CDP stealth (default ON, disable via LEAP_CDP_STEALTH=false)
    // CDP stealth is Category A (automation signal removal) — applied in both modes
    if (this.isCdpStealthEnabled()) {
      await page.addInitScript(this.sanitizeSourceURL(
        this.getCdpStealthScript()
      ));
    }

    // P0 #2 post-navigation fix: Playwright re-adds navigator.webdriver AFTER
    // init scripts run. This listener deletes it after every frame load so both
    // `typeof navigator.webdriver === "undefined"` AND `'webdriver' in navigator === false`.
    // This is Category A — applied in both passive and active modes.
    page.on("framenavigated", async (frame) => {
      try {
        await frame.evaluate(() => {
          try {
            delete Object.getPrototypeOf(navigator).webdriver;
            delete (Navigator as any).prototype.webdriver;
            delete (navigator as any).webdriver;
          } catch (e) { /* cross-origin or already deleted */ }
        });
      } catch { /* frame may be detached */ }
    });
  }

  /**
   * Get the current stealth mode.
   *   'active'  — full stealth (automation removal + identity faking). Default.
   *   'passive' — remove automation signals only, no identity faking.
   *   'off'     — stealth completely disabled.
   */
  getMode(): StealthModeType {
    const val = process.env.LEAP_STEALTH?.toLowerCase();
    if (val === 'false' || val === 'off') return 'off';
    if (val === 'passive') return 'passive';
    if (val === 'auto') return 'active'; // auto mode: base is active, bandit overrides per-navigation
    return 'active'; // default — backwards compatible (true, unset, or any other value)
  }

  /**
   * Whether the stealth mode is bandit-driven (LEAP_STEALTH=auto).
   * When true, the EXP3 bandit selects the stealth mode per-domain
   * per-navigation instead of using a fixed mode.
   *
   * When LEAP_STEALTH is unset or explicitly set to true/passive/false,
   * the user's choice takes precedence and the bandit is advisory only
   * (it still records outcomes for learning, but doesn't override the mode).
   */
  isBanditMode(): boolean {
    const val = process.env.LEAP_STEALTH?.toLowerCase();
    return val === 'auto';
  }

  /**
   * Whether stealth mode is enabled (passive or active).
   * Returns true unless LEAP_STEALTH=false/off is set.
   * Backwards compatible — callers that only need to know "is stealth on at all?"
   * can keep using this method.
   */
  isEnabled(): boolean {
    return this.getMode() !== 'off';
  }

  /**
   * Build Sec-CH-UA header value from a Chrome version and platform.
   * Phase 2.4: These HTTP headers are sent BEFORE JS runs, so they must
   * be set via extraHTTPHeaders to stay in sync with the JS-side override.
   */
  buildSecChUaHeaders(chromeVersion: number, platform: string): Record<string, string> {
    let chPlatform = "macOS";
    if (platform.startsWith("Win")) chPlatform = "Windows";
    else if (platform.startsWith("Linux")) chPlatform = "Linux";

    return {
      "Sec-CH-UA": `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not_A Brand";v="24"`,
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": `"${chPlatform}"`,
    };
  }

  /**
   * BrowserContext options to merge into context creation.
   * Returns stealth-appropriate defaults (user agent, locale, timezone, headers).
   *
   * In passive mode, returns minimal options (locale/timezone for consistency)
   * but does NOT set a faked userAgent or Sec-CH-UA headers.
   *
   * In active mode, returns the full set including faked UA and headers.
   *
   * BUG-005 / P0 #3 FIX: When a custom user agent is provided, we still return
   * locale/timezone/extraHTTPHeaders — only the userAgent field is omitted.
   */
  getContextOptions(customUserAgent?: string, fingerprint?: Fingerprint): Record<string, unknown> {
    const mode = this.getMode();
    if (mode === 'off') {
      return {};
    }

    // Passive mode: minimal context options — no identity faking
    if (mode === 'passive') {
      return {
        locale: "en-US",
        timezoneId: "America/New_York",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9",
        },
      };
    }

    // Active mode: full stealth context options
    const ua = customUserAgent ?? this.getDefaultUserAgent();
    const chromeVersion = this.extractChromeMajorVersion(ua);
    const platform = this.inferPlatformFromUA(ua);

    // Phase 2.4: Sync Sec-CH-UA HTTP headers with fingerprint/UA
    const secChUaHeaders = this.buildSecChUaHeaders(chromeVersion, platform);

    const opts: Record<string, unknown> = {
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        ...secChUaHeaders,
      },
    };

    // Only set the default UA if no custom one was provided.
    // Custom UA is applied by session-manager after merging these options.
    if (!customUserAgent) {
      opts.userAgent = this.getDefaultUserAgent();
    }

    return opts;
  }
}

export const stealth = new StealthMode();
export default stealth;
