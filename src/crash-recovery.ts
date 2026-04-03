// ─── Browser Crash Recovery Handler ───────────────────────────────────────
//
// Monitors browser health, provides session-level health checks, handles
// page.on('crash') events, auto-recovery, and crash telemetry.
// Standalone module — uses import type only for Playwright types.
// Logger integration is left to the caller (no cross-dependency).

import type { Browser, Page, BrowserContext } from "playwright-core";
import type { Session } from "./types.js";

export interface HealthCheckResult {
  healthy: boolean;
  reason?: string;
}

export interface CrashLogEntry {
  sessionId: string;
  url: string;
  timestamp: number;
  error: string;
}

const HEALTH_CHECK_TIMEOUT_MS = 3000;

export class CrashRecovery {
  /** Crash telemetry — all page crashes during server lifetime */
  private crashLog: CrashLogEntry[] = [];

  /** Sessions marked as unhealthy after a page crash (pending recovery) */
  private unhealthySessions = new Set<string>();

  /**
   * Attach a disconnect handler to a Playwright Browser instance.
   * On unexpected disconnect (crash, kill, OOM), logs the event and
   * calls onCrash so the SessionManager can clear its state.
   */
  attachToBrowser(browser: Browser, onCrash: () => void): void {
    browser.on("disconnected", () => {
      // Write directly to stderr — no logger dependency
      const entry = {
        ts: new Date().toISOString(),
        level: "error",
        event: "browser.crashed",
        pid: process.pid,
        message: "Browser disconnected unexpectedly. Clearing all sessions.",
      };
      process.stderr.write(JSON.stringify(entry) + "\n");

      onCrash();
    });
  }

  /**
   * Attach a page.on('crash') handler to catch Akamai-style browser context
   * crashes. On crash: close the dead page, clean up the pool slot, log the
   * event with the URL that caused the crash, and mark the session unhealthy.
   *
   * @param page The Playwright page to monitor
   * @param session The session owning this page
   * @param onCrash Optional callback when crash is detected (e.g., for cleanup)
   */
  attachToPage(
    page: Page,
    session: Session,
    onCrash?: (sessionId: string) => void,
  ): void {
    page.on("crash", () => {
      let url = "";
      try {
        url = page.url();
      } catch {
        // Page may be too dead to get URL
        url = "(unknown — page unresponsive)";
      }

      const crashEntry: CrashLogEntry = {
        sessionId: session.id,
        url,
        timestamp: Date.now(),
        error: "Page crashed (renderer process died)",
      };

      this.crashLog.push(crashEntry);
      this.unhealthySessions.add(session.id);

      // Write directly to stderr — no logger dependency
      const logEntry = {
        ts: new Date().toISOString(),
        level: "error",
        event: "page.crashed",
        pid: process.pid,
        sessionId: session.id,
        url,
        message: "Page renderer crashed. Session marked unhealthy for auto-recovery.",
      };
      process.stderr.write(JSON.stringify(logEntry) + "\n");

      // Try to close the dead page (best-effort)
      page.close().catch(() => {});

      if (onCrash) {
        onCrash(session.id);
      }
    });
  }

  /**
   * Check if a session is marked as unhealthy (crashed but not yet recovered).
   */
  isUnhealthy(sessionId: string): boolean {
    return this.unhealthySessions.has(sessionId);
  }

  /**
   * Mark a session as recovered after auto-recovery creates a replacement page.
   */
  markRecovered(sessionId: string): void {
    this.unhealthySessions.delete(sessionId);
  }

  /**
   * Auto-recover a crashed session by creating a replacement page in the same
   * browser context and re-applying stealth init scripts.
   *
   * @param session The session to recover
   * @param applyStealthFn Callback to re-apply stealth to the new page
   * @param rewireNetworkFn Callback to re-wire network intelligence
   * @returns The new replacement page, or null if recovery failed
   */
  async autoRecover(
    session: Session,
    applyStealthFn?: (page: Page) => Promise<void>,
    rewireNetworkFn?: (page: Page, session: Session) => void,
  ): Promise<Page | null> {
    if (!this.unhealthySessions.has(session.id)) {
      return null; // Not crashed — nothing to recover
    }

    try {
      const newPage = await session.context.newPage();

      // Re-apply stealth init scripts
      if (applyStealthFn) {
        await applyStealthFn(newPage);
      }

      // Re-wire network intelligence
      if (rewireNetworkFn) {
        rewireNetworkFn(newPage, session);
      }

      // Auto-dismiss dialogs on replacement page
      newPage.on("dialog", (dialog) => {
        dialog.dismiss().catch(() => {});
      });

      // Replace the crashed page reference in the session
      session.page = newPage;

      // Update pages array if tab manager initialized it
      if (session.pages) {
        // Find and replace the crashed page, or push new one
        const closedIdx = session.pages.findIndex((p) => {
          try { return p.isClosed(); } catch { return true; }
        });
        if (closedIdx >= 0) {
          session.pages[closedIdx] = newPage;
        } else {
          session.pages.push(newPage);
        }
      }

      // Attach crash handler to the new page too
      this.attachToPage(newPage, session);

      // Mark as recovered
      this.unhealthySessions.delete(session.id);

      const logEntry = {
        ts: new Date().toISOString(),
        level: "info",
        event: "page.crash_recovered",
        pid: process.pid,
        sessionId: session.id,
        message: "Replacement page created after crash. Session recovered.",
      };
      process.stderr.write(JSON.stringify(logEntry) + "\n");

      return newPage;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);

      const crashEntry: CrashLogEntry = {
        sessionId: session.id,
        url: "(recovery failed)",
        timestamp: Date.now(),
        error: `Auto-recovery failed: ${error}`,
      };
      this.crashLog.push(crashEntry);

      const logEntry = {
        ts: new Date().toISOString(),
        level: "error",
        event: "page.crash_recovery_failed",
        pid: process.pid,
        sessionId: session.id,
        error,
        message: "Failed to create replacement page. Session is dead.",
      };
      process.stderr.write(JSON.stringify(logEntry) + "\n");

      return null;
    }
  }

  /**
   * Quick health check for a single session.
   * Verifies the page is not closed and can still evaluate JavaScript.
   * Never throws — always returns a result object.
   */
  async healthCheck(session: Session): Promise<HealthCheckResult> {
    // Check if session is marked unhealthy from a crash
    if (this.unhealthySessions.has(session.id)) {
      return { healthy: false, reason: "Page crashed — pending auto-recovery" };
    }

    try {
      // Check if the page handle is already closed
      if (session.page.isClosed()) {
        return { healthy: false, reason: "Page is closed" };
      }

      // Try a trivial evaluate with a tight timeout
      await Promise.race([
        session.page.evaluate("1"),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Health check timed out")),
            HEALTH_CHECK_TIMEOUT_MS,
          ),
        ),
      ]);

      return { healthy: true };
    } catch (e: unknown) {
      const reason =
        e instanceof Error ? e.message : "Unknown health check failure";
      return { healthy: false, reason };
    }
  }

  /**
   * Run health checks on all sessions in parallel.
   * Returns a Map from session ID to health result.
   */
  async healthCheckAll(
    sessions: Map<string, Session>,
  ): Promise<Map<string, HealthCheckResult>> {
    const results = new Map<string, HealthCheckResult>();

    if (sessions.size === 0) return results;

    const entries = Array.from(sessions.entries());
    const checks = await Promise.allSettled(
      entries.map(([_id, session]) => this.healthCheck(session)),
    );

    for (let i = 0; i < entries.length; i++) {
      const [id] = entries[i];
      const outcome = checks[i];

      if (outcome.status === "fulfilled") {
        results.set(id, outcome.value);
      } else {
        // Promise.allSettled rejection — should not happen since healthCheck never throws,
        // but handle defensively
        results.set(id, {
          healthy: false,
          reason: outcome.reason?.message ?? "Health check promise rejected",
        });
      }
    }

    return results;
  }

  /**
   * Get the crash log — all page crashes during the current server lifetime.
   * Returns an array of {sessionId, url, timestamp, error} entries.
   */
  getCrashLog(): CrashLogEntry[] {
    return [...this.crashLog];
  }

  /**
   * Clear crash log (for testing or after log export).
   */
  clearCrashLog(): void {
    this.crashLog = [];
  }
}

export const crashRecovery = new CrashRecovery();
export default crashRecovery;
