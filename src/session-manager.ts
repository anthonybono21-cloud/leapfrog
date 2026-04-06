import type { Browser, BrowserContext, Page } from "playwright-core";
import { getChromium, resolveHeadedExecutablePath } from "./browser-launcher.js";
import type {
  Session,
  SessionCreateOptions,
  SessionInfo,
  SessionManagerConfig,
  ISessionManager,
  PoolStats,
} from "./types.js";
import { stealth } from "./stealth.js";
import { crashRecovery } from "./crash-recovery.js";
import { networkIntelligence } from "./network-intelligence.js";
import { tabManager } from "./tab-manager.js";
import { logger } from "./logger.js";
import { generateFingerprint } from "./humanize-fingerprint.js";
import { isHumanizeEnabled } from "./humanize-utils.js";
import { CdpConnector } from "./cdp-connector.js";
import { installSSRFRouteGuard } from "./ssrf.js";
import { tileManager } from "./tile-manager.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const DEFAULT_CONFIG: SessionManagerConfig = {
  maxSessions: 10,
  idleTimeoutMs: 30 * 60 * 1000,
  cleanupIntervalMs: 30 * 1000,
  defaultViewport: { width: 1280, height: 720 },
  headless: true,
};

// ── New env vars for v0.4.0 ────────────────────────────────────────────
const LEAP_HEADED = process.env.LEAP_HEADED === "true";
const LEAP_EXTENSIONS = process.env.LEAP_EXTENSIONS
  ? process.env.LEAP_EXTENSIONS.split(",").map((p) => p.trim()).filter(Boolean)
  : [];
const LEAP_PROFILES_DIR =
  process.env.LEAP_PROFILES_DIR ??
  path.join(os.homedir(), ".leapfrog", "chrome-profiles");
const LEAP_CDP_ENDPOINT = process.env.LEAP_CDP_ENDPOINT;
const LEAP_MAX_SESSIONS_PER_CLIENT = process.env.LEAP_MAX_SESSIONS_PER_CLIENT
  ? parseInt(process.env.LEAP_MAX_SESSIONS_PER_CLIENT, 10)
  : undefined;
const LEAP_STORAGE_PROFILES_DIR =
  process.env.LEAP_STORAGE_PROFILES_DIR ??
  path.join(os.homedir(), ".leapfrog", "profiles");

function generateId(): string {
  return "s_" + crypto.randomUUID().replace(/-/g, "").slice(0, 6);
}

export class SessionManager implements ISessionManager {
  private readonly config: SessionManagerConfig;
  private readonly sessions = new Map<string, Session>();
  private browser: Browser | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private totalCreated = 0;

  constructor(config?: Partial<SessionManagerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Browser lifecycle ──────────────────────────────────────────────

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    // Previous browser crashed or was never launched — clean up only stale sessions
    // BUG-008: Only clear sessions whose contexts belong to the dead browser
    if (this.browser) {
      for (const [id, session] of this.sessions) {
        try {
          // If the context's browser is the crashed one, remove it
          if (session.context.browser() === this.browser) {
            this.sessions.delete(id);
            networkIntelligence.cleanupSession(id);
          }
        } catch {
          // Context access failed — it's dead, remove the session
          this.sessions.delete(id);
          networkIntelligence.cleanupSession(id);
        }
      }
      this.browser = null;
    }

    const launchOpts: Record<string, unknown> = { headless: this.config.headless };
    if (this.config.channel) {
      launchOpts.channel = this.config.channel;
    }
    const sharedArgs: string[] = [];
    if (stealth.isEnabled()) {
      sharedArgs.push(...stealth.getLaunchArgs());
    }
    // When shared browser is headed, add tiling args for first window position
    if (!this.config.headless && tileManager.isEnabled()) {
      sharedArgs.push(...tileManager.getLaunchTileArgs(0));
    }
    if (sharedArgs.length > 0) {
      launchOpts.args = sharedArgs;
    }
    const chromium = await getChromium();
    this.browser = await chromium.launch(launchOpts);
    logger.info("browser.launched", { headless: this.config.headless, channel: this.config.channel ?? "bundled", stealth: stealth.isEnabled() });

    // Attach crash recovery — clears only sessions belonging to the crashed browser
    // BUG-008: Don't wipe ALL sessions; only those on the dead browser
    const crashedBrowser = this.browser;
    crashRecovery.attachToBrowser(this.browser, () => {
      let cleared = 0;
      for (const [id, session] of this.sessions) {
        try {
          if (session.context.browser() === crashedBrowser) {
            this.sessions.delete(id);
            networkIntelligence.cleanupSession(id);
            cleared++;
          }
        } catch {
          // Context access failed — it's dead
          this.sessions.delete(id);
          networkIntelligence.cleanupSession(id);
          cleared++;
        }
      }
      logger.error("browser.crash_recovery", { sessionsLost: cleared, sessionsRemaining: this.sessions.size });
      this.browser = null;
    });

    this.startCleanupTimer();
    return this.browser;
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.sweepIdle().catch(() => {
        // Sweep errors are non-fatal — next tick will retry
      });
    }, this.config.cleanupIntervalMs);

    // Don't prevent Node from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ── Idle sweep ─────────────────────────────────────────────────────

  private async sweepIdle(): Promise<void> {
    // BUG-001: idleTimeoutMs === 0 disables the sweep entirely
    if (this.config.idleTimeoutMs <= 0) return;

    const now = Date.now();
    const expired: string[] = [];

    for (const [id, session] of this.sessions) {
      if (session.pinned) continue;
      if (now - session.lastUsedAt > this.config.idleTimeoutMs) {
        expired.push(id);
      }
    }

    await Promise.allSettled(expired.map((id) => this.destroySession(id)));
  }

  // ── Public API ─────────────────────────────────────────────────────

  async createSession(opts?: SessionCreateOptions): Promise<Session> {
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(
        `Session pool full (${this.config.maxSessions}/${this.config.maxSessions}). ` +
          `Destroy an existing session first.`
      );
    }

    // ── Per-client session limit ────────────────────────────────────
    if (opts?.clientId && LEAP_MAX_SESSIONS_PER_CLIENT !== undefined) {
      const clientCount = this.getClientSessionCount(opts.clientId);
      if (clientCount >= LEAP_MAX_SESSIONS_PER_CLIENT) {
        throw new Error(
          `Client session limit reached (${LEAP_MAX_SESSIONS_PER_CLIENT}/${LEAP_MAX_SESSIONS_PER_CLIENT}). ` +
            `Client "${opts.clientId}" must destroy an existing session first.`
        );
      }
    }

    // ── Resolve headed mode: per-session > env > config ─────────────
    const isHeaded = opts?.headed !== undefined
      ? opts.headed
      : LEAP_HEADED
        ? true
        : !this.config.headless;

    // ── CDP connect mode ────────────────────────────────────────────
    const cdpEndpoint = opts?.cdp ?? LEAP_CDP_ENDPOINT;
    let cdpConnected = false;
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let usePersistentProfile = false;

    if (cdpEndpoint) {
      // CDP mode: attach to running Chrome, don't launch
      browser = await CdpConnector.connect(cdpEndpoint);
      cdpConnected = true;
      // Use the first existing context, or create a new one
      const contexts = browser.contexts();
      context = contexts.length > 0 ? contexts[0] : await browser.newContext();
      logger.info("session.cdp_connected", { endpoint: cdpEndpoint });
    } else if (opts?.profile) {
      // ── Profile shorthand mode ──────────────────────────────────
      const safeName = opts.profile.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!safeName) throw new Error("Invalid profile name.");
      const profileDir = path.join(LEAP_PROFILES_DIR, safeName);

      // Check if profile exists
      let profileExists = false;
      try {
        await fs.access(profileDir);
        profileExists = true;
      } catch {
        // New profile — create the directory
        await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
      }

      // If profile is new, default to headed so user can log in
      const profileHeaded = opts.headed !== undefined
        ? opts.headed
        : profileExists
          ? isHeaded
          : true;

      // Merge extensions from env + opts
      const allExtensions = [...LEAP_EXTENSIONS, ...(opts?.extensions ?? [])];

      // Build launch args
      const launchArgs: string[] = [];
      if (stealth.isEnabled()) {
        launchArgs.push(...stealth.getLaunchArgs());
      }
      if (allExtensions.length > 0) {
        // Validate each extension path has manifest.json
        for (const extPath of allExtensions) {
          try {
            await fs.access(path.join(extPath, "manifest.json"));
          } catch {
            throw new Error(`Extension missing manifest.json: ${extPath}`);
          }
        }
        launchArgs.push(`--load-extension=${allExtensions.join(",")}`);
        launchArgs.push(`--disable-extensions-except=${allExtensions.join(",")}`);
        // Force new headless mode when headless with extensions
        if (!profileHeaded) {
          launchArgs.push("--headless=new");
        }
      }

      // ── Window tiling args ─────────────────────────────────────────
      if (tileManager.isEnabled() && profileHeaded) {
        launchArgs.push(...tileManager.getLaunchTileArgs(this.sessions.size));
      }

      // Check for saved cookie state JSON
      const profileStatePath = path.join(LEAP_STORAGE_PROFILES_DIR, `${safeName}.json`);
      let savedCookieState: { cookies: any[]; origins: any[] } | undefined;
      try {
        await fs.access(profileStatePath);
        const raw = await fs.readFile(profileStatePath, "utf-8");
        savedCookieState = JSON.parse(raw);
      } catch {
        // No saved state — start fresh
      }

      // FIX: Do NOT pass storageState to launchPersistentContext.
      // storageState + persistent context conflict: storageState overwrites
      // Chrome-native cookies with potentially empty Playwright-captured state.
      // Instead, launch clean and inject cookies after.
      const chromiumForProfile = await getChromium();
      // Force full Chromium binary for headed profile sessions
      const profileExePath = profileHeaded && !this.config.channel ? resolveHeadedExecutablePath() : undefined;
      context = await chromiumForProfile.launchPersistentContext(profileDir, {
        headless: !profileHeaded,
        viewport: opts?.viewport ?? this.config.defaultViewport,
        args: launchArgs.length > 0 ? launchArgs : undefined,
        ...(profileExePath ? { executablePath: profileExePath } : {}),
        ...(this.config.channel ? { channel: this.config.channel } : {}),
      });

      // Restore saved cookies AFTER context is created
      if (savedCookieState?.cookies?.length) {
        try {
          await context.addCookies(savedCookieState.cookies);
          logger.info("session.cookies_restored", { profile: safeName, count: savedCookieState.cookies.length });
        } catch (e: any) {
          logger.error("session.cookie_restore_failed", { profile: safeName, error: e.message });
        }
      }

      browser = context.browser()!;
      usePersistentProfile = true;
      logger.info("session.persistent_profile", { profile: safeName, profileDir, headed: profileHeaded, isNew: !profileExists, restoredCookies: savedCookieState?.cookies?.length ?? 0 });
    } else if (isHeaded && this.config.headless) {
      // ── Headed override on a headless server ─────────────────────
      // Can't reuse the shared headless browser — launch a separate headed one
      // Re-detect screen right before launch — at startup the frontmost window
      // may have been on a different screen than the terminal is now
      if (tileManager.isEnabled()) {
        tileManager.redetectScreen();
      }
      const launchArgs: string[] = [];
      if (stealth.isEnabled()) {
        launchArgs.push(...stealth.getLaunchArgs());
      }
      // Windows DPI: prevent Chromium from double-scaling window positions
      if (process.platform === 'win32') {
        launchArgs.push('--force-device-scale-factor=1');
      }
      // ── Window tiling args ─────────────────────────────────────────
      if (tileManager.isEnabled()) {
        launchArgs.push(...tileManager.getLaunchTileArgs(this.sessions.size));
      }
      const chromiumForHeaded = await getChromium();
      // Force the full Chromium binary — Playwright's headless shell cannot render GUI windows
      const headedExePath = this.config.channel ? undefined : resolveHeadedExecutablePath();
      browser = await chromiumForHeaded.launch({
        headless: false,
        ...(headedExePath ? { executablePath: headedExePath } : {}),
        ...(this.config.channel ? { channel: this.config.channel } : {}),
        ...(launchArgs.length > 0 ? { args: launchArgs } : {}),
      });
      logger.info("browser.launched_headed_override", { channel: this.config.channel ?? "bundled", args: launchArgs.filter(a => a.startsWith('--window')) });
    } else {
      // ── Standard mode ─────────────────────────────────────────────
      browser = await this.ensureBrowser();
    }

    const viewport = opts?.viewport ?? this.config.defaultViewport;

    // Determine if stealth applies: per-session flag overrides global env
    // KEY INSIGHT (Session 8 research): For persistent profile sessions, stealth
    // init scripts are counterproductive — they create fingerprint inconsistencies
    // that score WORSE than honest automation with real cookies/history.
    // Profile sessions rely on cookie state + browsing history for trust (reCAPTCHA v3
    // scores ~0.9 with Google cookies vs 0.1-0.3 with fresh profile).
    // Stealth launch ARGS are still applied (harmless at Chromium level), but init
    // script injection is skipped unless explicitly requested.
    const STEALTH_PROFILES = process.env.LEAP_STEALTH_PROFILES === "true";
    const useStealth = opts?.stealth !== undefined
      ? opts.stealth
      : usePersistentProfile && !STEALTH_PROFILES
        ? false  // Profile sessions: trust cookies over fingerprint spoofing
        : stealth.isEnabled();

    // Always generate a per-session fingerprint for stealth (WebGL, device props, PRNG seed).
    // When LEAP_HUMANIZE is enabled, it also controls UA/viewport/locale/timezone.
    const fp = generateFingerprint();

    // Build context options — merge stealth defaults with fingerprint for Sec-CH-UA sync (Phase 2.4)
    const stealthOpts = useStealth ? stealth.getContextOptions(opts?.userAgent, fp) : {};
    const contextOpts: Record<string, unknown> = { viewport, ...stealthOpts };

    // Apply humanized fingerprint when LEAP_HUMANIZE is enabled.
    // Fingerprint provides coherent browser identity (UA, viewport, locale, timezone, etc.)
    // that can be overridden by explicit user opts below.
    if (isHumanizeEnabled()) {
      if (!opts?.userAgent) {
        contextOpts.userAgent = fp.userAgent;
      }
      if (!opts?.viewport) {
        contextOpts.viewport = fp.viewport;
      }
      if (!opts?.locale) {
        contextOpts.locale = fp.languages[0]?.split("-")[0] ?? "en";
      }
      if (!opts?.timezoneId) {
        contextOpts.timezoneId = fp.timezone;
      }
      // Store fingerprint data for init script injection (WebGL, navigator properties)
      contextOpts._humanizeFingerprint = fp;
      logger.info("session.humanize_fingerprint", { userAgent: fp.userAgent, timezone: fp.timezone, screen: `${fp.screen.width}x${fp.screen.height}` });
    }

    if (opts?.userAgent) {
      contextOpts.userAgent = opts.userAgent;
    }

    // Extended context options for humanization
    if (opts?.locale) {
      contextOpts.locale = opts.locale;
    }
    if (opts?.timezoneId) {
      contextOpts.timezoneId = opts.timezoneId;
    }
    if (opts?.geolocation) {
      contextOpts.geolocation = opts.geolocation;
    }
    if (opts?.permissions) {
      contextOpts.permissions = opts.permissions;
    }
    if (opts?.colorScheme) {
      contextOpts.colorScheme = opts.colorScheme;
    }
    if (opts?.acceptDownloads !== undefined) {
      contextOpts.acceptDownloads = opts.acceptDownloads;
    }
    if (opts?.proxy) {
      contextOpts.proxy = opts.proxy;
    }

    if (opts?.storageState) {
      try {
        contextOpts.storageState = JSON.parse(opts.storageState);
      } catch {
        throw new Error("Invalid storageState JSON string");
      }
    } else if (opts?.profilePath) {
      contextOpts.storageState = opts.profilePath;
    }

    // Extract fingerprint before passing opts to Playwright (not a Playwright option)
    const humanizeFingerprint = contextOpts._humanizeFingerprint as ReturnType<typeof generateFingerprint> | undefined;
    delete contextOpts._humanizeFingerprint;

    // For CDP or persistent profile, context is already created above.
    // For standard mode, create a new context on the shared browser.
    if (!cdpConnected && !usePersistentProfile) {
      context = await browser!.newContext(contextOpts);
    }

    // At this point context is always assigned (CDP, profile, or standard mode)
    const ctx = context!;
    const page = usePersistentProfile
      ? (ctx.pages()[0] ?? await ctx.newPage())
      : await ctx.newPage();

    // Apply stealth init scripts to evade bot detection
    // Pass userAgent for platform inference (P2 #9) and fingerprint for
    // per-session WebGL/device/PRNG values (Phase 2.1-2.5)
    if (useStealth) {
      await stealth.applyToPage(page, opts?.userAgent, fp);
    }
    if (usePersistentProfile && !useStealth) {
      logger.info("session.stealth_skipped_for_profile", {
        profile: opts?.profile,
        reason: "Profile sessions use cookie trust instead of fingerprint spoofing",
      });
    }

    // Apply humanized fingerprint overrides (navigator, screen, WebGL properties)
    // Skip for profile sessions — injecting fake navigator/WebGL values on top of
    // a real Chrome profile creates detectable inconsistencies (FP-Inconsistent, ACM IMC 2025)
    if (humanizeFingerprint && !usePersistentProfile) {
      const fp = humanizeFingerprint;
      await page.addInitScript(`(() => {
        // Navigator property overrides
        Object.defineProperty(navigator, 'platform', { get: () => ${JSON.stringify(fp.platform)} });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => ${fp.deviceMemory} });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => ${fp.hardwareConcurrency} });
        Object.defineProperty(navigator, 'languages', { get: () => ${JSON.stringify(fp.languages)} });
        Object.defineProperty(navigator, 'cookieEnabled', { get: () => ${fp.cookieEnabled} });
        Object.defineProperty(navigator, 'pdfViewerEnabled', { get: () => ${fp.pdfViewerEnabled} });
        ${fp.doNotTrack !== null ? `Object.defineProperty(navigator, 'doNotTrack', { get: () => ${JSON.stringify(fp.doNotTrack)} });` : ''}
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => ${fp.maxTouchPoints} });

        // Screen property overrides
        Object.defineProperty(screen, 'width', { get: () => ${fp.screen.width} });
        Object.defineProperty(screen, 'height', { get: () => ${fp.screen.height} });
        Object.defineProperty(screen, 'colorDepth', { get: () => ${fp.colorDepth} });

        // WebGL renderer/vendor override
        const origGetParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {
          if (param === 0x9245) return ${JSON.stringify(fp.webgl.vendor)};   // UNMASKED_VENDOR_WEBGL
          if (param === 0x9246) return ${JSON.stringify(fp.webgl.renderer)}; // UNMASKED_RENDERER_WEBGL
          return origGetParameter.call(this, param);
        };
        if (typeof WebGL2RenderingContext !== 'undefined') {
          const origGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
          WebGL2RenderingContext.prototype.getParameter = function(param) {
            if (param === 0x9245) return ${JSON.stringify(fp.webgl.vendor)};
            if (param === 0x9246) return ${JSON.stringify(fp.webgl.renderer)};
            return origGetParameter2.call(this, param);
          };
        }

        // Device pixel ratio
        Object.defineProperty(window, 'devicePixelRatio', { get: () => ${fp.devicePixelRatio} });
      })();`);
    }

    // SSRF route guard — intercept ALL requests and block those targeting internal
    // IPs / reserved hostnames. Catches redirect chains (302 -> internal) BEFORE
    // the browser follows them, closing the TOCTOU gap in the post-nav check.
    await installSSRFRouteGuard(page);

    // Auto-dismiss browser dialogs (alert, confirm, prompt) to prevent session hangs
    // P1 #6: Add 200-500ms random delay — instant dismiss (< 30ms) is a headless signal
    page.on("dialog", (dialog) => {
      const delay = stealth.isEnabled() ? stealth.getDialogDelay() : 0;
      setTimeout(() => dialog.dismiss().catch(() => {}), delay);
    });

    // BUG-009: Handle page crashes — mark session as unhealthy and attempt recovery
    page.on("crash", () => {
      logger.error("page.crashed", { contextId: ctx.constructor.name });
      // Attempt to create a replacement page in the same context
      ctx.newPage().then((newPage) => {
        // Find the session that owns this context
        for (const [, s] of this.sessions) {
          if (s.context === ctx) {
            s.page = newPage;
            // Replace crashed page in pages array if tab manager initialized it
            if (s.pages) {
              const crashedIdx = s.pages.indexOf(page);
              if (crashedIdx >= 0) {
                s.pages[crashedIdx] = newPage;
              } else {
                s.pages.push(newPage);
              }
            }
            // Re-apply stealth to the new page
            if (stealth.isEnabled()) {
              stealth.applyToPage(newPage).catch(() => {});
            }
            // Re-install SSRF route guard on replacement page
            installSSRFRouteGuard(newPage).catch(() => {});
            // Re-wire network intelligence
            networkIntelligence.attachToPage(newPage, s);
            // Auto-dismiss dialogs on replacement page
            newPage.on("dialog", (d) => d.dismiss().catch(() => {}));
            logger.info("page.crash_recovered", { id: s.id });
            break;
          }
        }
      }).catch(() => {
        // Context itself may be dead — mark session for cleanup
        for (const [id, s] of this.sessions) {
          if (s.context === ctx) {
            logger.error("page.crash_recovery_failed", { id });
            this.sessions.delete(id);
            networkIntelligence.cleanupSession(id);
            break;
          }
        }
      });
    });

    // Generate a unique short ID
    let id: string;
    do {
      id = generateId();
    } while (this.sessions.has(id));

    const now = Date.now();
    const session: Session = {
      id,
      context: ctx,
      page,
      createdAt: now,
      lastUsedAt: now,
      refCounter: 0,
      refMap: new Map(),
      refFingerprints: new Map(),
      navGeneration: 0,
      refNavGeneration: 0,
      profilePath: opts?.profilePath,
      ...(opts?.profile ? { profileName: opts.profile.replace(/[^a-zA-Z0-9_-]/g, "") } : {}),
      ...(opts?.clientId ? { clientId: opts.clientId } : {}),
      ...(cdpConnected ? { cdpConnected: true } : {}),
    };

    this.sessions.set(id, session);
    this.totalCreated++;

    // Wire up network intelligence (auto-capture requests + console)
    networkIntelligence.attachToPage(page, session);

    // Wire up tab manager (auto-track new tabs/popups)
    tabManager.attachToContext(ctx, session);

    logger.info("session.created", { id, profilePath: opts?.profilePath });

    // ── Window tiling (CDP positioning + reflow) ───────────────────
    if (tileManager.isEnabled() && isHeaded && !cdpConnected) {
      try {
        await tileManager.detectScreen(page);
        await tileManager.reflowAll(this.sessions);
      } catch (e: any) {
        logger.warn("tile.reflow_failed", { error: e.message });
      }
    }

    // ── Auto-reflow on external close ──────────────────────────────
    // When the user manually closes a browser window (X button), clean up
    // the session and reflow remaining tiled windows. Without this, closing
    // a window leaves a gap in the grid that never fills.
    ctx.on("close", () => {
      if (!this.sessions.has(id)) return; // Already destroyed via Leapfrog
      logger.info("session.external_close", { id });
      this.sessions.delete(id);
      networkIntelligence.cleanupSession(id);
      tileManager.removeSession(id);

      // Reflow remaining windows to fill the gap
      if (tileManager.isEnabled() && this.sessions.size > 0) {
        tileManager.reflowAll(this.sessions).catch((e) => {
          logger.warn("tile.reflow_after_external_close_failed", { error: (e as Error).message });
        });
      }
    });

    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  findByName(name: string): Session | undefined {
    const lower = name.toLowerCase();
    for (const session of this.sessions.values()) {
      if (session.name && session.name.toLowerCase() === lower) {
        return session;
      }
    }
    return undefined;
  }

  touchSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastUsedAt = Date.now();
    }
  }

  async destroySession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session "${id}" not found — already destroyed or never existed.`);
    }

    this.sessions.delete(id);
    networkIntelligence.cleanupSession(id);
    tileManager.removeSession(id);

    // ── Auto-save cookies for profile sessions ──────────────────────
    // FIX: Use context.cookies() instead of context.storageState().
    // storageState() on persistent contexts returns empty cookies because
    // it only captures Playwright-injected cookies, not browser-native ones
    // set via navigation/HTTP headers. context.cookies() captures ALL cookies.
    if (session.profileName) {
      try {
        await fs.mkdir(LEAP_STORAGE_PROFILES_DIR, { recursive: true, mode: 0o700 });
        const profileStatePath = path.join(LEAP_STORAGE_PROFILES_DIR, `${session.profileName}.json`);
        const cookies = await session.context.cookies();
        const state = { cookies, origins: [] };
        await fs.writeFile(profileStatePath, JSON.stringify(state, null, 2), { mode: 0o600 });
        logger.info("session.profile_state_saved", { id, profile: session.profileName, path: profileStatePath, cookieCount: cookies.length });
      } catch (e: any) {
        // Non-fatal — log and continue with destroy
        logger.error("session.profile_state_save_failed", { id, profile: session.profileName, error: e.message });
      }
    }

    try {
      // For CDP-connected sessions, only close pages we opened — don't kill the external browser
      if (session.cdpConnected) {
        for (const p of session.context.pages()) {
          try { await p.close(); } catch { /* page may already be closed */ }
        }
      } else {
        await session.context.close();
      }
    } catch {
      // Context may already be closed (browser crash, manual close) — safe to ignore
    }

    logger.info("session.destroyed", { id, cdp: !!session.cdpConnected });

    // ── Reflow remaining tiled windows ─────────────────────────────
    if (tileManager.isEnabled() && this.sessions.size > 0) {
      tileManager.reflowAll(this.sessions).catch((e) => {
        logger.warn("tile.reflow_after_destroy_failed", { error: e.message });
      });
    }
  }

  async destroyAll(): Promise<void> {
    // Destroy all sessions first (closes contexts)
    await Promise.allSettled(
      [...this.sessions.keys()].map((id) => this.destroySession(id))
    );

    this.stopCleanupTimer();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Browser may already be gone
      }
      this.browser = null;
    }
  }

  listSessions(): SessionInfo[] {
    const result: SessionInfo[] = [];

    for (const session of this.sessions.values()) {
      let url = "";
      try {
        url = session.page.url();
      } catch {
        // Page may have crashed — return empty string
      }

      result.push({
        id: session.id,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        url,
        // page.title() is async in Playwright; this interface is sync.
        // Callers needing the title should use getSession(id).page.title().
        title: "",
        ...(session.profilePath ? { profilePath: session.profilePath } : {}),
        ...(session.name ? { name: session.name } : {}),
        ...(session.domain ? { domain: session.domain } : {}),
        ...(session.pinned ? { pinned: true } : {}),
      });
    }

    return result;
  }

  getStats(): PoolStats {
    return {
      active: this.sessions.size,
      maxSessions: this.config.maxSessions,
      totalCreated: this.totalCreated,
    };
  }

  getClientSessionCount(clientId: string): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.clientId === clientId) {
        count++;
      }
    }
    return count;
  }

  getSessions(): Map<string, Session> {
    return this.sessions;
  }

  /**
   * Rotate a session: destroy the old one and create a fresh session with
   * a new fingerprint and humanization enabled. Used by stealth escalation
   * when a site blocks the current session.
   *
   * Returns the new session and its active page, plus the URL the old session
   * was on (so the caller can navigate back).
   *
   * SAFETY: Never call this on profile/auth sessions — the caller must guard.
   */
  async rotateSession(oldSessionId: string): Promise<{
    session: Session;
    page: Page;
    previousUrl: string;
  }> {
    const oldSession = this.sessions.get(oldSessionId);
    if (!oldSession) {
      throw new Error(`Cannot rotate session "${oldSessionId}" — not found.`);
    }

    // Capture the URL we'll want to navigate back to
    let previousUrl = "about:blank";
    try {
      previousUrl = oldSession.page.url();
    } catch {
      /* page may be crashed */
    }

    // Preserve client ID for pool accounting
    const clientId = oldSession.clientId;

    // Destroy old session (saves profile state if applicable)
    await this.destroySession(oldSessionId);

    // Create fresh session with humanization enabled via env
    // The new session automatically gets a fresh fingerprint via generateFingerprint()
    const newSession = await this.createSession({
      stealth: true,
      clientId,
    });

    const page = tabManager.getActivePage(newSession);

    logger.info("session.rotated", {
      oldId: oldSessionId,
      newId: newSession.id,
      previousUrl,
    });

    return { session: newSession, page, previousUrl };
  }

  getResourceUsage(): { heapUsedMB: number; rssMB: number; sessionsActive: number; uptimeSeconds: number } {
    const mem = process.memoryUsage();
    return {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
      sessionsActive: this.sessions.size,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}

export default SessionManager;
