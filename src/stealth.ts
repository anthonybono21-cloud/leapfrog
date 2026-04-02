// ─── Anti-Bot Evasion ─────────────────────────────────────────────────────
//
// Stealth patches for headless Chromium to avoid bot detection.
// Enabled by default. Disable with LEAP_STEALTH=false.
//
// Standalone module — no cross-dependencies on logger or session-manager.
//
// ─── Evasion Index ────────────────────────────────────────────────────────
//
// P0 — Instant-kill vectors (detected by every fingerprint site)
//   1. HeadlessChrome in Client Hints brands  → launch args + userAgentData override
//   2. navigator.webdriver = true              → init script, re-applied every navigation
//   3. Custom UA disabling all stealth context → getContextOptions() fix
//
// P1 — High-signal vectors (caught by CreepJS, fingerprint-pro)
//   4. SwiftShader WebGL vendor/renderer       → launch args (--use-gl) + WebGL1/2 override
//   5. Connection RTT = 0                      → navigator.connection override
//   6. Alert auto-dismiss < 30ms               → getDialogDelay() helper (200-500ms)
//
// P2 — Medium-signal vectors (caught by advanced fingerprinters)
//   7. outerHeight === innerHeight             → fake chrome offset (85px)
//   8. 0 mime types                            → MimeTypeArray spoof
//   9. Platform mismatch with custom UA        → inferPlatformFromUA()
//
// Additional puppeteer-stealth evasions:
//  10. chrome.app emulation
//  11. iframe contentWindow protection (patches propagate to child frames)
//  12. media codecs spoofing (canPlayType override)
//  13. document.hasFocus() override (returns false in headless)
//  14. sourceurl stripping (Playwright injects sourceURL comments)
//
// Already passing (do not touch):
//  - UA string looks like real Chrome 136
//  - window.chrome present, 5 plugins, languages correct
//  - No Selenium/PhantomJS markers (all 17 absent)
//  - DevTools Protocol not detected
//  - Canvas fingerprint consistent across iframes
//  - Battery API realistic

import type { Page } from "playwright";

export class StealthMode {
  /**
   * Chromium launch args that reduce automation fingerprinting.
   *
   * --disable-blink-features=AutomationControlled  → hides navigator.webdriver at engine level
   * --use-gl=angle --use-angle=default              → use real GPU instead of SwiftShader (P1 #4)
   * --disable-features=ChromeWhatsNewUI             → prevent headless Chrome feature leaks
   */
  getLaunchArgs(): string[] {
    return [
      // P0 #2: Suppress navigator.webdriver at Blink level
      "--disable-blink-features=AutomationControlled",

      // P1 #4: Force real GPU rendering instead of SwiftShader
      // SwiftShader shows "Google SwiftShader" in UNMASKED_VENDOR/RENDERER
      "--use-gl=angle",
      "--use-angle=default",

      // Standard headless-mode hardening
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
    ];
  }

  /**
   * Realistic Chrome user agent string for macOS.
   */
  getDefaultUserAgent(): string {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
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
   * JavaScript to inject via page.addInitScript() that patches
   * common bot-detection vectors in the page's execution context.
   *
   * This script runs BEFORE page JavaScript on every navigation,
   * including in iframes (Playwright propagates addInitScript to all frames).
   *
   * The `__LEAP_PLATFORM__` placeholder is replaced at apply-time with
   * the correct platform for the active user-agent.
   */
  getInitScript(platform?: string): string {
    const safePlatform = platform ?? "MacIntel";

    return `
      // ────────────────────────────────────────────────────────────────────
      // P0 #2: Hide navigator.webdriver
      // The --disable-blink-features=AutomationControlled launch arg should
      // handle this, but QA found it does not always take effect. This
      // redundant override ensures webdriver is hidden on every navigation.
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // P0 #1: Fix HeadlessChrome in Client Hints brands
      // navigator.userAgentData.brands and getHighEntropyValues() expose
      // "HeadlessChrome" — instant bot fingerprint on every detection site.
      // We replace the entire NavigatorUAData interface with clean values.
      // ────────────────────────────────────────────────────────────────────
      if (navigator.userAgentData) {
        const cleanBrands = [
          { brand: "Chromium", version: "131" },
          { brand: "Google Chrome", version: "131" },
          { brand: "Not_A Brand", version: "24" },
        ];
        const cleanFullBrands = [
          { brand: "Chromium", version: "131.0.6778.205" },
          { brand: "Google Chrome", version: "131.0.6778.205" },
          { brand: "Not_A Brand", version: "24.0.0.0" },
        ];

        const cleanUAData = {
          brands: cleanBrands,
          mobile: false,
          platform: ${JSON.stringify(safePlatform.startsWith("Win") ? "Windows" : safePlatform.startsWith("Mac") ? "macOS" : safePlatform.startsWith("Linux") ? "Linux" : "macOS")},
          getHighEntropyValues: function(hints) {
            return Promise.resolve({
              brands: cleanFullBrands,
              mobile: false,
              platform: this.platform,
              platformVersion: "15.0.0",
              architecture: "x86",
              bitness: "64",
              model: "",
              uaFullVersion: "131.0.6778.205",
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
      // Fix navigator.permissions.query for notifications (already passing)
      // ────────────────────────────────────────────────────────────────────
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery(parameters);
      };

      // ────────────────────────────────────────────────────────────────────
      // Fix navigator.plugins (already passing — 5 fake plugins)
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
      // Fix navigator.languages (already passing)
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
        get: () => ${JSON.stringify(safePlatform)},
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // Patch navigator.hardwareConcurrency (already passing)
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // Patch navigator.deviceMemory (already passing)
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // Notification.permission returns 'default' (already passing)
      // ────────────────────────────────────────────────────────────────────
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true,
      });

      // ────────────────────────────────────────────────────────────────────
      // Remove ChromeDriver detection property (already passing)
      // ────────────────────────────────────────────────────────────────────
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_;

      // ────────────────────────────────────────────────────────────────────
      // P1 #4: WebGL vendor/renderer override (SwiftShader → real GPU)
      // Headless Chromium uses SwiftShader which reports:
      //   UNMASKED_VENDOR  = "Google Inc. (Google)"
      //   UNMASKED_RENDERER = "ANGLE (Google, Google SwiftShader, OpenGL ES)"
      // Real Chrome on macOS reports ANGLE with the actual GPU.
      // We override getParameter for both WebGL1 and WebGL2 contexts.
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const WEBGL_VENDOR = 'Google Inc. (Apple)';
        const WEBGL_RENDERER = 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)';
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

        // Patch WebGL1
        if (typeof WebGLRenderingContext !== 'undefined') {
          patchWebGLContext(WebGLRenderingContext.prototype);
        }
        // Patch WebGL2
        if (typeof WebGL2RenderingContext !== 'undefined') {
          patchWebGLContext(WebGL2RenderingContext.prototype);
        }
      })();

      // ────────────────────────────────────────────────────────────────────
      // P1 #5: Connection RTT = 0 → override navigator.connection
      // Headless Chromium reports RTT of 0 and downlink of 0, which is
      // impossible for a real network connection.
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
      // Real browsers have ~85px of chrome (toolbar, tab bar, etc).
      // outerWidth is also slightly larger in real browsers.
      // ────────────────────────────────────────────────────────────────────
      (function() {
        const chromeHeight = 85;
        const chromeWidth = 0; // outerWidth usually matches on macOS

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
      // Returns false in headless — real browsers always return true
      // when the page is in the foreground.
      // ────────────────────────────────────────────────────────────────────
      Document.prototype.hasFocus = function() {
        return true;
      };

      // ────────────────────────────────────────────────────────────────────
      // #12: Media codecs spoofing (canPlayType override)
      // Headless may report different codec support. Ensure common codecs
      // return 'probably' or 'maybe' as real Chrome does.
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
      // Canvas fingerprint noise (already passing — preserve)
      // Add subtle random noise (1-2 color channel changes) to toDataURL
      // to break canvas fingerprint matching without visible artifacts.
      // ────────────────────────────────────────────────────────────────────
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
        const ctx = this.getContext('2d');
        if (ctx && this.width > 0 && this.height > 0) {
          try {
            const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
            const data = imageData.data;
            // Perturb a few pixels by +/- 1 in random channels
            for (let i = 0; i < Math.min(data.length, 64); i += 16) {
              const channel = i + Math.floor(Math.random() * 3); // R, G, or B
              const delta = Math.random() > 0.5 ? 1 : -1;
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
      // #11: iframe contentWindow protection
      // Ensure that stealth patches propagate properly to iframes.
      // Detection sites create iframes and check if navigator.webdriver
      // is present in the child context.
      // We intercept contentWindow access and ensure our patches apply.
      // ────────────────────────────────────────────────────────────────────
      (function() {
        // Proxy contentWindow to patch newly created iframes
        const origHTMLIFrameElement = Object.getOwnPropertyDescriptor(
          HTMLIFrameElement.prototype, 'contentWindow'
        );
        if (origHTMLIFrameElement && origHTMLIFrameElement.get) {
          Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get: function() {
              const win = origHTMLIFrameElement.get.call(this);
              if (win) {
                try {
                  // Patch webdriver in iframe context
                  if (Object.getOwnPropertyDescriptor(win.navigator, 'webdriver') === undefined ||
                      win.navigator.webdriver !== undefined) {
                    Object.defineProperty(win.navigator, 'webdriver', {
                      get: () => undefined,
                      configurable: true,
                    });
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
          // Filter out Playwright-injected sourceURL frames
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
   * Apply the stealth init script to a Playwright page.
   * Call this immediately after page creation, before navigating.
   *
   * Accepts an optional userAgent to infer the correct platform value
   * for navigator.platform (prevents P2 #9 mismatch).
   */
  async applyToPage(page: Page, userAgent?: string): Promise<void> {
    const platform = userAgent
      ? this.inferPlatformFromUA(userAgent)
      : "MacIntel";
    await page.addInitScript(this.getInitScript(platform));
  }

  /**
   * Whether stealth mode is enabled.
   * Returns true unless LEAP_STEALTH=false is set.
   */
  isEnabled(): boolean {
    return process.env.LEAP_STEALTH !== "false";
  }

  /**
   * BrowserContext options to merge into context creation.
   * Returns stealth-appropriate defaults (user agent, locale, timezone, headers).
   *
   * P0 #3 FIX: When a custom user agent is provided, we still return
   * locale/timezone/extraHTTPHeaders — only the userAgent field is omitted.
   * Previously, ANY custom UA caused this method to return {} which
   * disabled all stealth context options.
   */
  getContextOptions(customUserAgent?: string): Record<string, unknown> {
    if (!this.isEnabled()) {
      return {};
    }

    const opts: Record<string, unknown> = {
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
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
