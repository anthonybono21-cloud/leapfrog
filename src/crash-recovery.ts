// ─── Browser Crash Recovery Handler ───────────────────────────────────────
//
// Monitors browser health and provides session-level health checks.
// Standalone module — uses import type only for Playwright types.
// Logger integration is left to the caller (no cross-dependency).

import type { Browser, Page } from "playwright";
import type { Session } from "./types.js";

export interface HealthCheckResult {
  healthy: boolean;
  reason?: string;
}

const HEALTH_CHECK_TIMEOUT_MS = 3000;

export class CrashRecovery {
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
   * Quick health check for a single session.
   * Verifies the page is not closed and can still evaluate JavaScript.
   * Never throws — always returns a result object.
   */
  async healthCheck(session: Session): Promise<HealthCheckResult> {
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
}

export const crashRecovery = new CrashRecovery();
export default crashRecovery;
