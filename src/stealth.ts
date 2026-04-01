// ─── Anti-Bot Evasion ─────────────────────────────────────────────────────
//
// Stealth patches for headless Chromium to avoid bot detection.
// Enabled by default. Disable with HYDRA_STEALTH=false.
//
// Standalone module — no cross-dependencies on logger or session-manager.

import type { Page } from "playwright";

export class StealthMode {
  /**
   * Chromium launch args that reduce automation fingerprinting.
   */
  getLaunchArgs(): string[] {
    return [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
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
   * JavaScript to inject via page.addInitScript() that patches
   * common bot-detection vectors in the page's execution context.
   */
  getInitScript(): string {
    return `
      // ── Hide navigator.webdriver ──────────────────────────────────────
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      // ── Fake window.chrome object ─────────────────────────────────────
      if (!window.chrome) {
        Object.defineProperty(window, 'chrome', {
          value: {
            runtime: {
              onConnect: { addListener() {}, removeListener() {} },
              onMessage: { addListener() {}, removeListener() {} },
              connect() { return { onDisconnect: { addListener() {} } }; },
              sendMessage() {},
            },
            loadTimes() {
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
            },
            csi() {
              return {
                onloadT: Date.now(),
                pageT: Date.now() - performance.timing.navigationStart,
                startE: performance.timing.navigationStart,
                tran: 15,
              };
            },
          },
          configurable: true,
          writable: true,
        });
      }

      // ── Fix navigator.permissions.query for notifications ─────────────
      const originalQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (parameters) => {
        if (parameters.name === 'notifications') {
          return Promise.resolve({ state: Notification.permission, onchange: null });
        }
        return originalQuery(parameters);
      };

      // ── Fix navigator.plugins (headless reports 0) ────────────────────
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

      // ── Fix navigator.languages ───────────────────────────────────────
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });

      // ── Override navigator.platform ───────────────────────────────────
      Object.defineProperty(navigator, 'platform', {
        get: () => 'MacIntel',
        configurable: true,
      });

      // ── Patch navigator.hardwareConcurrency ───────────────────────────
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
      });

      // ── Patch navigator.deviceMemory ──────────────────────────────────
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
        configurable: true,
      });

      // ── Notification.permission returns 'default' ─────────────────────
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true,
      });

      // ── Remove ChromeDriver detection property ────────────────────────
      delete window.cdc_adoQpoasnfa76pfcZLmcfl_;

      // ── Canvas fingerprint noise ──────────────────────────────────────
      // Add subtle random noise (1-2 color channel changes) to toDataURL
      // to break canvas fingerprint matching without visible artifacts.
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
    `;
  }

  /**
   * Apply the stealth init script to a Playwright page.
   * Call this immediately after page creation, before navigating.
   */
  async applyToPage(page: Page): Promise<void> {
    await page.addInitScript(this.getInitScript());
  }

  /**
   * Whether stealth mode is enabled.
   * Returns true unless HYDRA_STEALTH=false is set.
   */
  isEnabled(): boolean {
    return process.env.HYDRA_STEALTH !== "false";
  }

  /**
   * BrowserContext options to merge into context creation.
   * Returns stealth-appropriate defaults (user agent, locale, timezone, headers).
   * Returns empty object if stealth is disabled or a custom user agent was provided.
   */
  getContextOptions(customUserAgent?: string): Record<string, unknown> {
    if (!this.isEnabled() || customUserAgent) {
      return {};
    }

    return {
      userAgent: this.getDefaultUserAgent(),
      locale: "en-US",
      timezoneId: "America/New_York",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    };
  }
}

export const stealth = new StealthMode();
export default stealth;
