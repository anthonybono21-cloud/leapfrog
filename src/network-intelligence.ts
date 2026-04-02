import type { Page, Response, ConsoleMessage, Route } from "playwright";
import type { Session, NetworkEntry, ConsoleEntry, NetworkInterceptRule } from "./types.js";

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_NETWORK_ENTRIES = 200;
const MAX_CONSOLE_ENTRIES = 100;
const MAX_BODY_CAPTURE_BYTES = 10 * 1024; // 10KB

/** Content-types eligible for body capture */
const CAPTURABLE_CONTENT_TYPES = [
  "application/json",
  "text/plain",
  "text/html",
  "text/xml",
  "application/xml",
  "text/csv",
  "application/javascript",
  "text/javascript",
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function isCapturableContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return CAPTURABLE_CONTENT_TYPES.some((ct) => lower.startsWith(ct));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)}MB`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return (
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0") +
    ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

function pushToRingBuffer<T>(buffer: T[], entry: T, maxSize: number): void {
  if (buffer.length >= maxSize) {
    buffer.shift();
  }
  buffer.push(entry);
}

/**
 * Ensure session has initialized arrays for network intelligence.
 * Called defensively before any read/write to these fields since
 * session-manager.ts does not initialize them.
 */
function ensureSessionArrays(session: Session): void {
  if (!session.networkLog) session.networkLog = [];
  if (!session.consoleLog) session.consoleLog = [];
  if (!session.interceptRules) session.interceptRules = [];
}

const CONSOLE_LEVEL_MAP: Record<string, ConsoleEntry["level"]> = {
  log: "log",
  warning: "warn",
  error: "error",
  info: "info",
  debug: "debug",
};

// ─── Filter interfaces ───────────────────────────────────────────────────

export interface NetworkFilter {
  urlPattern?: string;
  method?: string;
  statusMin?: number;
  statusMax?: number;
  contentType?: string;
}

export interface ConsoleFilter {
  level?: string;
}

// ─── NetworkIntelligence ─────────────────────────────────────────────────

export class NetworkIntelligence {
  /**
   * Tracks active route handlers per session so we can unroute them.
   * Key = session.id, Value = Map of ruleId -> { urlPattern, handler }
   */
  private routeHandlers = new Map<
    string,
    Map<string, { urlPattern: string; handler: (route: Route) => Promise<void> }>
  >();

  // ── Attach listeners to a page ───────────────────────────────────

  /**
   * Wire up network and console capture on a page.
   * Call once when a session is created. Initializes the ring buffers
   * on the session and installs Playwright event listeners.
   */
  attachToPage(page: Page, session: Session): void {
    // Initialize arrays on the session
    ensureSessionArrays(session);

    // BUG-006: Track request start times via wall clock as a fallback
    // for when Playwright timing() returns zeros.
    const requestStartTimes = new Map<string, number>();
    page.on("request", (request) => {
      requestStartTimes.set(request.url() + request.method(), Date.now());
    });

    // --- Network response listener ---
    page.on("response", async (response: Response) => {
      try {
        const request = response.request();
        const timing = request.timing();

        // BUG-006: Duration calculation with multiple fallbacks.
        // 1. Prefer Playwright's built-in timing (responseEnd - requestStart)
        // 2. Fall back to (responseEnd - startTime) if requestStart is missing
        // 3. Final fallback: wall-clock delta from our request listener
        let duration = 0;
        if (timing.responseEnd > 0 && timing.requestStart > 0) {
          duration = Math.round(timing.responseEnd - timing.requestStart);
        } else if (timing.responseEnd > 0 && timing.startTime > 0) {
          duration = Math.round(timing.responseEnd - timing.startTime);
        } else {
          // Wall-clock fallback
          const key = request.url() + request.method();
          const wallStart = requestStartTimes.get(key);
          if (wallStart) {
            duration = Date.now() - wallStart;
            requestStartTimes.delete(key);
          }
        }

        const url = response.url();
        const status = response.status();
        const headers = response.headers();
        const contentType = headers["content-type"] ?? "";
        const contentLength = headers["content-length"];

        // Determine response size — prefer content-length header, fallback to body length
        let responseSize = contentLength ? parseInt(contentLength, 10) : 0;
        if (isNaN(responseSize)) responseSize = 0;

        // Optionally capture body for small JSON/text responses
        let responseBody: string | undefined;
        if (isCapturableContentType(contentType)) {
          // Check size hint before attempting body read
          const sizeHint = responseSize || MAX_BODY_CAPTURE_BYTES + 1;
          if (sizeHint <= MAX_BODY_CAPTURE_BYTES) {
            try {
              const body = await response.text();
              if (body.length <= MAX_BODY_CAPTURE_BYTES) {
                responseBody = body;
              }
              // Update size from actual body if content-length was missing
              if (!responseSize) {
                responseSize = body.length;
              }
            } catch {
              // Body may be unavailable (redirects, aborted) — skip silently
            }
          }
        }

        // If we still don't have a size, try reading the body just for size
        if (!responseSize && !responseBody) {
          try {
            const bodyBuf = await response.body();
            responseSize = bodyBuf.length;
          } catch {
            // Non-critical — leave as 0
          }
        }

        const entry: NetworkEntry = {
          timestamp: Date.now(),
          method: request.method(),
          url,
          status,
          contentType: contentType.split(";")[0].trim(),
          responseSize,
          duration,
          ...(responseBody !== undefined ? { responseBody } : {}),
        };

        // Defensive: ensure array exists (session may have been created before attach)
        if (!session.networkLog) session.networkLog = [];
        pushToRingBuffer(session.networkLog, entry, MAX_NETWORK_ENTRIES);
      } catch {
        // Network capture must never crash the server — swallow all errors
      }
    });

    // --- Console message listener ---
    page.on("console", (msg: ConsoleMessage) => {
      try {
        const rawType = msg.type();
        const level = CONSOLE_LEVEL_MAP[rawType] ?? "log";

        const entry: ConsoleEntry = {
          timestamp: Date.now(),
          level,
          text: msg.text(),
        };

        // Defensive: ensure array exists
        if (!session.consoleLog) session.consoleLog = [];
        pushToRingBuffer(session.consoleLog, entry, MAX_CONSOLE_ENTRIES);
      } catch {
        // Console capture must never crash the server
      }
    });
  }

  // ── Get network log (filtered, formatted) ────────────────────────

  /**
   * Returns network log entries as compact formatted text.
   * Supports filtering by URL pattern (regex or substring), HTTP method,
   * status code range, and content-type.
   */
  getNetworkLog(session: Session, filter?: NetworkFilter): string {
    const entries = session.networkLog ?? [];
    let filtered = entries;

    if (filter) {
      filtered = entries.filter((e) => {
        if (filter.urlPattern) {
          try {
            const regex = new RegExp(filter.urlPattern, "i");
            if (!regex.test(e.url)) return false;
          } catch {
            // Invalid regex — fall back to substring match
            if (!e.url.toLowerCase().includes(filter.urlPattern.toLowerCase()))
              return false;
          }
        }
        if (filter.method && e.method.toUpperCase() !== filter.method.toUpperCase()) {
          return false;
        }
        if (filter.statusMin !== undefined && e.status < filter.statusMin) {
          return false;
        }
        if (filter.statusMax !== undefined && e.status > filter.statusMax) {
          return false;
        }
        if (filter.contentType) {
          if (
            !e.contentType
              .toLowerCase()
              .includes(filter.contentType.toLowerCase())
          ) {
            return false;
          }
        }
        return true;
      });
    }

    if (filtered.length === 0) {
      return "(no matching network entries)";
    }

    return filtered
      .map((e) => {
        const parts = [
          e.method,
          String(e.status),
          e.url,
          `(${formatBytes(e.responseSize)})`,
          `${e.duration}ms`,
        ];
        if (e.responseBody !== undefined) {
          parts.push("[body captured]");
        }
        return parts.join(" ");
      })
      .join("\n");
  }

  // ── Get console log (filtered, formatted) ────────────────────────

  /**
   * Returns console log entries as compact formatted text.
   * Supports filtering by log level.
   */
  getConsoleLog(session: Session, filter?: ConsoleFilter): string {
    const entries = session.consoleLog ?? [];
    let filtered = entries;

    if (filter?.level) {
      const targetLevel = filter.level.toLowerCase();
      filtered = entries.filter((e) => e.level === targetLevel);
    }

    if (filtered.length === 0) {
      return "(no matching console entries)";
    }

    // Pad level labels to align output
    const maxLevelLen = 5; // "error" is longest

    return filtered
      .map((e) => {
        const levelStr = `[${e.level}]`.padEnd(maxLevelLen + 2);
        const timeStr = formatTimestamp(e.timestamp);
        return `${levelStr} ${timeStr} ${e.text}`;
      })
      .join("\n");
  }

  // ── Add intercept rule ───────────────────────────────────────────

  /**
   * Add a network intercept rule to a page.
   * - `block`: Aborts matching requests
   * - `log`: Lets requests through (captured by the response listener)
   * - `mock`: Returns a custom response with specified status, body, and content-type
   *
   * If a rule with the same ID already exists, it is replaced.
   */
  async addIntercept(
    page: Page,
    session: Session,
    rule: NetworkInterceptRule,
  ): Promise<void> {
    ensureSessionArrays(session);

    // Remove existing rule with same ID if present
    const rules = session.interceptRules!;
    if (rules.some((r) => r.id === rule.id)) {
      await this.removeIntercept(page, session, rule.id);
    }

    const handler = async (route: Route): Promise<void> => {
      try {
        switch (rule.action) {
          case "block":
            await route.abort("blockedbyclient");
            break;

          case "log":
            // Let the request through — the response listener will capture it
            await route.continue();
            break;

          case "mock": {
            if (!rule.mockResponse) {
              // No mock config — fall through
              await route.continue();
              break;
            }
            await route.fulfill({
              status: rule.mockResponse.status,
              contentType: rule.mockResponse.contentType,
              body: rule.mockResponse.body,
            });
            break;
          }
        }
      } catch {
        // Route may already be handled or page navigated away — ignore
        try {
          await route.continue();
        } catch {
          // Truly dead route — nothing to do
        }
      }
    };

    // Register the route with Playwright
    await page.route(rule.urlPattern, handler);

    // Track the handler so we can unroute later
    if (!this.routeHandlers.has(session.id)) {
      this.routeHandlers.set(session.id, new Map());
    }
    this.routeHandlers
      .get(session.id)!
      .set(rule.id, { urlPattern: rule.urlPattern, handler });

    // Store the rule on the session
    session.interceptRules!.push(rule);
  }

  // ── Remove intercept rule ────────────────────────────────────────

  /**
   * Remove a previously added intercept rule by ID.
   * Calls page.unroute() to deregister the Playwright route handler.
   */
  async removeIntercept(
    page: Page,
    session: Session,
    ruleId: string,
  ): Promise<void> {
    const sessionHandlers = this.routeHandlers.get(session.id);
    const entry = sessionHandlers?.get(ruleId);

    if (entry) {
      try {
        await page.unroute(entry.urlPattern, entry.handler);
      } catch {
        // Route may have already been removed — ignore
      }
      sessionHandlers!.delete(ruleId);
      if (sessionHandlers!.size === 0) {
        this.routeHandlers.delete(session.id);
      }
    }

    if (session.interceptRules) {
      session.interceptRules = session.interceptRules.filter(
        (r) => r.id !== ruleId,
      );
    }
  }

  // ── Clear logs ───────────────────────────────────────────────────

  /**
   * Clear captured logs.
   * @param type - Which logs to clear: 'network', 'console', or 'all' (default).
   */
  clearLogs(session: Session, type?: "network" | "console" | "all"): void {
    const target = type ?? "all";
    if (target === "network" || target === "all") {
      if (session.networkLog) session.networkLog.length = 0;
    }
    if (target === "console" || target === "all") {
      if (session.consoleLog) session.consoleLog.length = 0;
    }
  }

  // ── Cleanup when a session is destroyed ──────────────────────────

  /**
   * Remove tracked route handlers for a destroyed session.
   * Call this from your session destroy logic.
   */
  cleanupSession(sessionId: string): void {
    this.routeHandlers.delete(sessionId);
  }
}

// ─── Export singleton + class ─────────────────────────────────────────────

export const networkIntelligence = new NetworkIntelligence();
export default NetworkIntelligence;
