import { chromium } from "playwright";
import type { Browser } from "playwright";
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

const DEFAULT_CONFIG: SessionManagerConfig = {
  maxSessions: 10,
  idleTimeoutMs: 30 * 60 * 1000,
  cleanupIntervalMs: 30 * 1000,
  defaultViewport: { width: 1280, height: 720 },
  headless: true,
};

function generateId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "s_";
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
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
    if (stealth.isEnabled()) {
      launchOpts.args = stealth.getLaunchArgs();
    }
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

    const browser = await this.ensureBrowser();

    const viewport = opts?.viewport ?? this.config.defaultViewport;

    // Build context options — merge stealth defaults
    const stealthOpts = stealth.isEnabled() ? stealth.getContextOptions(opts?.userAgent) : {};
    const contextOpts: Record<string, unknown> = { viewport, ...stealthOpts };

    if (opts?.userAgent) {
      contextOpts.userAgent = opts.userAgent;
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

    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();

    // Apply stealth init scripts to evade bot detection
    if (stealth.isEnabled()) {
      await stealth.applyToPage(page);
    }

    // Auto-dismiss browser dialogs (alert, confirm, prompt) to prevent session hangs
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));

    // BUG-009: Handle page crashes — mark session as unhealthy and attempt recovery
    page.on("crash", () => {
      logger.error("page.crashed", { contextId: context.constructor.name });
      // Attempt to create a replacement page in the same context
      context.newPage().then((newPage) => {
        // Find the session that owns this context
        for (const [, s] of this.sessions) {
          if (s.context === context) {
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
          if (s.context === context) {
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
      context,
      page,
      createdAt: now,
      lastUsedAt: now,
      refCounter: 0,
      refMap: new Map(),
      profilePath: opts?.profilePath,
    };

    this.sessions.set(id, session);
    this.totalCreated++;

    // Wire up network intelligence (auto-capture requests + console)
    networkIntelligence.attachToPage(page, session);

    // Wire up tab manager (auto-track new tabs/popups)
    tabManager.attachToContext(context, session);

    logger.info("session.created", { id, profilePath: opts?.profilePath });

    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
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

    try {
      await session.context.close();
    } catch {
      // Context may already be closed (browser crash, manual close) — safe to ignore
    }

    logger.info("session.destroyed", { id });
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

  getSessions(): Map<string, Session> {
    return this.sessions;
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
