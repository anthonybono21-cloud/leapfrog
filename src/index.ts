#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as dns from "dns/promises";
import * as net from "net";
import { SessionManager } from "./session-manager.js";
import { SnapshotEngine } from "./snapshot-engine.js";
import { networkIntelligence } from "./network-intelligence.js";
import { tabManager } from "./tab-manager.js";
import { crashRecovery } from "./crash-recovery.js";
import { logger } from "./logger.js";
import { createRequire } from "module";
import { humanMouse } from "./humanize-mouse.js";
import { humanTyping } from "./humanize-typing.js";
import { humanScroll } from "./humanize-scroll.js";
import { thinkPause } from "./humanize-pause.js";
import { isHumanizeEnabled } from "./humanize-utils.js";
import { ScriptExecutor } from "./script-executor.js";
import { CdpConnector } from "./cdp-connector.js";
import { SnapshotDiffer } from "./snapshot-differ.js";
import { ApiIntelligence } from "./api-intelligence.js";
import { PageClassifier } from "./page-classifier.js";
import { HarnessIntelligence, formatHarnessOutput } from "./harness-intelligence.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };
import type { Session } from "./types.js";

// ─── Config ─────────────────────────────────────────────────────────────────

const MAX_SESSIONS = Number(process.env.LEAP_MAX_SESSIONS ?? 15);
// BUG-001: Default to 30 min; allow LEAP_IDLE_TIMEOUT=0 to disable sweep entirely
const IDLE_TIMEOUT_MS = Number(process.env.LEAP_IDLE_TIMEOUT ?? 30 * 60 * 1000);
if (!Number.isFinite(MAX_SESSIONS) || MAX_SESSIONS < 1) throw new Error("Invalid LEAP_MAX_SESSIONS");
if (!Number.isFinite(IDLE_TIMEOUT_MS) || IDLE_TIMEOUT_MS < 0) throw new Error("Invalid LEAP_IDLE_TIMEOUT");
const HEADLESS = process.env.LEAP_HEADLESS !== "false";
const CHANNEL = process.env.LEAP_CHANNEL || undefined; // "chrome" to use installed Chrome
const MAX_SNAPSHOT_CHARS = 10000;
const ALLOW_JS = process.env.LEAP_ALLOW_JS !== "false";
const ALLOW_EXECUTE = process.env.LEAP_ALLOW_EXECUTE !== "false";
const LEAP_PROFILES_DIR = process.env.LEAP_PROFILES_DIR ?? path.join(os.homedir(), ".leapfrog", "chrome-profiles");

const sessions = new SessionManager({
  maxSessions: MAX_SESSIONS,
  idleTimeoutMs: IDLE_TIMEOUT_MS,
  headless: HEADLESS,
  channel: CHANNEL,
});

const snapEngine = new SnapshotEngine();

// Hook API intelligence into network response listener
networkIntelligence.onResponse((session, url, method, status, headers, body, duration, resourceType, requestHeaders, requestBody) => {
  ApiIntelligence.capture(session, url, method, status, headers, body, duration, resourceType, requestHeaders, requestBody);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function err(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

function requireSession(sessionId: string): Session {
  const s = sessions.getSession(sessionId);
  if (!s) throw new Error(`Session "${sessionId}" not found. Use session_list to see active sessions.`);
  sessions.touchSession(sessionId);
  return s;
}

function getPage(session: Session) {
  return tabManager.getActivePage(session);
}

async function snapAndFormat(session: Session, opts?: { selector?: string; maxChars?: number }): Promise<string> {
  const page = getPage(session);
  const result = await snapEngine.snapshot(page, session, {
    interactiveOnly: true,
    maxChars: opts?.maxChars ?? MAX_SNAPSHOT_CHARS,
    selector: opts?.selector,
  });

  // Mark refs as fresh — they match the current nav generation
  session.refNavGeneration = session.navGeneration ?? 0;

  const url = page.url();
  let title = "";
  try { title = await page.title(); } catch { /* */ }

  return `[${session.id}] ${title}\n${url}\n${result.nodeCount} elements\n\n${result.text}`;
}

const PROFILE_DIR = path.join(os.homedir(), ".leapfrog", "profiles");

// ─── SSRF Protection ───────────────────────────────────────────────────────

const BLOCKED_IP_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^::1$/, /^fc00:/, /^fe80:/, /^fd/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // P0-2: CGNAT range 100.64.0.0/10
  /^198\.1[89]\./, // P0-2: Benchmarking range 198.18.0.0/15
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

function isInternalIP(ip: string): boolean {
  return BLOCKED_IP_RANGES.some((r) => r.test(ip));
}

/**
 * Parse octal IP notation like 0177.0.0.1 → 127.0.0.1
 * Returns null if not a valid octal IP.
 */
function parseOctalIP(hostname: string): string | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^0?\d+$/.test(part)) return null;
    const n = part.startsWith('0') && part.length > 1 ? parseInt(part, 8) : parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return nums.join('.');
}

/**
 * P0-2: Parse hex IP notation like 0x7f000001 → 127.0.0.1
 * Returns null if not a valid hex IP.
 */
function parseHexIP(hostname: string): string | null {
  if (!/^0x[0-9a-fA-F]+$/.test(hostname)) return null;
  const num = parseInt(hostname, 16);
  if (isNaN(num) || num < 0 || num > 0xFFFFFFFF) return null;
  return [
    (num >>> 24) & 0xFF,
    (num >>> 16) & 0xFF,
    (num >>> 8) & 0xFF,
    num & 0xFF,
  ].join('.');
}

/**
 * Parse decimal IP notation like 2130706433 → 127.0.0.1
 * Returns null if not a valid decimal IP.
 */
function parseDecimalIP(hostname: string): string | null {
  if (!/^\d+$/.test(hostname)) return null;
  const num = parseInt(hostname, 10);
  if (isNaN(num) || num < 0 || num > 0xFFFFFFFF) return null;
  return [
    (num >>> 24) & 0xFF,
    (num >>> 16) & 0xFF,
    (num >>> 8) & 0xFF,
    num & 0xFF,
  ].join('.');
}

async function checkSSRF(hostname: string): Promise<string | null> {
  // Blocked hostname check (localhost etc.)
  if (BLOCKED_HOSTNAMES.has(hostname.toLowerCase())) {
    return `Blocked: ${hostname} is a reserved hostname.`;
  }

  // IPv6 bracket notation: [::1] → ::1
  let normalizedHost = hostname;
  if (normalizedHost.startsWith('[') && normalizedHost.endsWith(']')) {
    normalizedHost = normalizedHost.slice(1, -1);
  }

  // Direct IP check
  if (net.isIP(normalizedHost)) {
    if (isInternalIP(normalizedHost)) return `Blocked: ${hostname} is an internal IP address.`;
    return null;
  }

  // P0-2: Hex IP notation: 0x7f000001 → 127.0.0.1
  const hexResolved = parseHexIP(normalizedHost);
  if (hexResolved) {
    if (isInternalIP(hexResolved)) return `Blocked: ${hostname} resolves to internal IP ${hexResolved} (hex notation).`;
    return null;
  }

  // Octal IP notation: 0177.0.0.1 → 127.0.0.1
  const octalResolved = parseOctalIP(normalizedHost);
  if (octalResolved) {
    if (isInternalIP(octalResolved)) return `Blocked: ${hostname} resolves to internal IP ${octalResolved} (octal notation).`;
    return null;
  }

  // Decimal IP notation: 2130706433 → 127.0.0.1
  const decimalResolved = parseDecimalIP(normalizedHost);
  if (decimalResolved) {
    if (isInternalIP(decimalResolved)) return `Blocked: ${hostname} resolves to internal IP ${decimalResolved} (decimal notation).`;
    return null;
  }

  // DNS resolution check (catches DNS rebinding)
  try {
    const addresses = await dns.resolve4(normalizedHost);
    for (const addr of addresses) {
      if (isInternalIP(addr)) {
        return `Blocked: ${hostname} resolves to internal IP ${addr}.`;
      }
    }
  } catch {
    // DNS failure — let the browser handle it (will show its own error)
  }
  return null;
}

// ─── Server ─────────────────────────────────────────────────────────────────

const server = new McpServer(
  { name: "leapfrog", version: pkg.version },
  { capabilities: { tools: {} } },
);

// ─── session_create ─────────────────────────────────────────────────────────

server.registerTool(
  "session_create",
  {
    title: "Create Browser Session",
    description:
      "Create a new isolated browser session with its own cookies and state. " +
      "Returns a short session ID (e.g. s_k3m7x1) to pass to all other tools. " +
      "Each session is a separate BrowserContext — no cookie leakage between sessions. " +
      `Pool limit: ${MAX_SESSIONS} concurrent sessions. ` +
      "Sessions auto-expire after 30 minutes of inactivity. Use keep-alive pattern (periodic navigate or snapshot) for long-running sessions.",
    inputSchema: z.object({
      profilePath: z
        .string()
        .optional()
        .describe("Path to a Playwright storageState JSON file for pre-authenticated sessions."),
      viewport: z
        .object({ width: z.number(), height: z.number() })
        .optional()
        .describe("Custom viewport. Default: 1280x720."),
      userAgent: z.string().optional().describe("Custom user agent string."),
      locale: z.string().optional().describe("Browser locale (e.g. 'en-US', 'fr-FR')."),
      timezoneId: z.string().optional().describe("Timezone ID (e.g. 'America/New_York', 'Europe/London')."),
      geolocation: z
        .object({
          latitude: z.number(),
          longitude: z.number(),
          accuracy: z.number().optional(),
        })
        .optional()
        .describe("Geolocation to emulate."),
      permissions: z
        .array(z.string())
        .optional()
        .describe("Permissions to grant (e.g. ['geolocation', 'notifications'])."),
      colorScheme: z
        .enum(["light", "dark", "no-preference"])
        .optional()
        .describe("Preferred color scheme."),
      acceptDownloads: z
        .boolean()
        .optional()
        .describe("Whether to accept downloads. Default: true."),
      stealth: z
        .boolean()
        .optional()
        .describe("Enable/disable stealth mode for this session. Default: true (uses global setting)."),
      proxy: z
        .object({
          server: z.string().describe("Proxy server URL (e.g. 'http://proxy:8080', 'socks5://proxy:1080')."),
          username: z.string().optional().describe("Proxy auth username."),
          password: z.string().optional().describe("Proxy auth password."),
          bypass: z.string().optional().describe("Comma-separated domains to bypass proxy (e.g. 'localhost,.example.com')."),
        })
        .optional()
        .describe("Per-session proxy configuration. Each session can use a different proxy."),
      profile: z
        .string()
        .optional()
        .describe("Profile shorthand name (e.g. 'github', 'gmail'). Uses persistent Chrome profile at ~/.leapfrog/chrome-profiles/{name}/."),
      headed: z
        .boolean()
        .optional()
        .describe("Run browser with visible UI for this session. Overrides LEAP_HEADED env var."),
      extensions: z
        .array(z.string())
        .optional()
        .describe("Paths to unpacked Chrome extensions to load."),
      cdp: z
        .string()
        .optional()
        .describe("CDP endpoint URL to connect to a running Chrome instance (e.g. 'http://localhost:9222')."),
      clientId: z
        .string()
        .optional()
        .describe("Client identifier for per-client pool partitioning. Used with LEAP_MAX_SESSIONS_PER_CLIENT."),
    }).strict(),
  },
  async ({ profilePath, viewport, userAgent, locale, timezoneId, geolocation, permissions, colorScheme, acceptDownloads, stealth, proxy, profile, headed, extensions, cdp, clientId }) => {
    try {
      // Validate profilePath stays within the profiles directory
      if (profilePath) {
        const resolved = path.resolve(profilePath);
        if (!resolved.startsWith(path.resolve(PROFILE_DIR))) {
          return err(`profilePath must be within ${PROFILE_DIR}`);
        }
        try {
          await fs.access(resolved);
        } catch {
          return err(`Profile not found: ${resolved}`);
        }
      }
      const session = await sessions.createSession({
        profilePath, viewport, userAgent,
        locale, timezoneId, geolocation, permissions, colorScheme, acceptDownloads, stealth, proxy,
        profile, headed, extensions, cdp, clientId,
      });
      const stats = sessions.getStats();
      return ok(
        `Session created: ${session.id}\n` +
        `Pool: ${stats.active}/${stats.maxSessions} active`,
      );
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── session_list ───────────────────────────────────────────────────────────

server.registerTool(
  "session_list",
  {
    title: "List Browser Sessions",
    description: "List all active browser sessions with their URLs and idle times.",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    const list = sessions.listSessions();
    const stats = sessions.getStats();

    if (list.length === 0) {
      return ok(`No active sessions. (${stats.totalCreated} total created)`);
    }

    const now = Date.now();
    const lines = list.map((s) => {
      const idle = Math.round((now - s.lastUsedAt) / 1000);
      return `${s.id}  ${s.url || "(blank)"}  idle ${idle}s`;
    });

    return ok(
      `${stats.active}/${stats.maxSessions} sessions\n\n` +
      lines.join("\n"),
    );
  },
);

// ─── session_destroy ────────────────────────────────────────────────────────

server.registerTool(
  "session_destroy",
  {
    title: "Destroy Browser Session",
    description: "Close and clean up a browser session. Frees a pool slot.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID to destroy."),
    }).strict(),
  },
  async ({ sessionId }) => {
    // Clean up module-level state for the session
    SnapshotDiffer.clearSession(sessionId);
    ApiIntelligence.clearSession(sessionId);
    HarnessIntelligence.clearSession(sessionId);
    await sessions.destroySession(sessionId);
    const stats = sessions.getStats();
    return ok(`Destroyed ${sessionId}. Pool: ${stats.active}/${stats.maxSessions}`);
  },
);

// ─── session_save_profile ───────────────────────────────────────────────────

server.registerTool(
  "session_save_profile",
  {
    title: "Save Session Profile",
    description:
      "Save a session's cookies and auth state to disk. " +
      "Use this after logging in to a site so future sessions can restore that login. " +
      "Pass the returned profile path to session_create's profilePath to reuse it.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID to save."),
      name: z.string().describe("Profile name (e.g. 'google', 'github'). Overwrites if exists."),
    }).strict(),
  },
  async ({ sessionId, name }) => {
    try {
      // Sanitize profile name — alphanumeric, dash, underscore only
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!safeName) return err("Invalid profile name. Use alphanumeric, dash, or underscore characters.");
      const session = requireSession(sessionId);
      await fs.mkdir(PROFILE_DIR, { recursive: true, mode: 0o700 });
      const filepath = path.resolve(PROFILE_DIR, `${safeName}.json`);
      if (!filepath.startsWith(path.resolve(PROFILE_DIR))) {
        return err("Invalid profile path.");
      }
      const state = await session.context.storageState();
      await fs.writeFile(filepath, JSON.stringify(state, null, 2), { mode: 0o600 });
      return ok(`Profile saved: ${filepath}\nUse with session_create profilePath="${filepath}"`);
    } catch (e: any) {
      return err(`Save failed: ${e.message}`);
    }
  },
);

// ─── session_list_profiles ──────────────────────────────────────────────────

server.registerTool(
  "session_list_profiles",
  {
    title: "List Saved Profiles",
    description: "List all saved authentication profiles.",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    try {
      await fs.mkdir(PROFILE_DIR, { recursive: true });
      const files = await fs.readdir(PROFILE_DIR);
      const profiles = files.filter((f) => f.endsWith(".json"));
      if (profiles.length === 0) return ok("No saved profiles.");

      const lines = profiles.map((f) => {
        const name = f.replace(".json", "");
        return `${name}  →  ${path.join(PROFILE_DIR, f)}`;
      });
      return ok(lines.join("\n"));
    } catch (e: any) {
      return err(`List failed: ${e.message}`);
    }
  },
);

// ─── Auto-Challenge Solver ──────────────────────────────────────────────────

const CHALLENGE_BUTTON_PATTERNS = /^(continue|continue shopping|i'm not a robot|accept|verify|i am human|submit|proceed)$/i;

async function attemptChallengeResolve(page: ReturnType<typeof getPage>, session: Session, confidence: number): Promise<string | null> {
  try {
    // Strategy 1: Look for a single primary button with challenge-related text
    const buttons = await page.locator('button, [role="button"], input[type="submit"]').all();
    for (const btn of buttons) {
      try {
        const text = (await btn.textContent())?.trim() ?? "";
        const value = (await btn.getAttribute("value"))?.trim() ?? "";
        if (CHALLENGE_BUTTON_PATTERNS.test(text) || CHALLENGE_BUTTON_PATTERNS.test(value)) {
          await btn.click();
          await page.waitForTimeout(1000);
          // Re-snapshot to check if challenge resolved
          const reSnap = await snapEngine.snapshot(page, session, { interactiveOnly: true, maxChars: MAX_SNAPSHOT_CHARS });
          session.refNavGeneration = session.navGeneration ?? 0;
          const url = page.url();
          let title = "";
          try { title = await page.title(); } catch { /* */ }
          const reClass = PageClassifier.classify({ url, snapshotText: reSnap.text });
          if (reClass.type !== 'challenge') {
            return `[CHALLENGE RESOLVED] Auto-clicked challenge button. Page is now accessible.\n\n[${session.id}] ${title}\n${url}\n${reSnap.nodeCount} elements\n\n${reSnap.text}\n\n[page: ${reClass.type} (${Math.round(reClass.confidence * 100)}%)]`;
          }
          // Still a challenge after clicking
          return `[CHALLENGE] Bot challenge detected (${Math.round(confidence * 100)}%). Auto-clicked button but challenge persists. Manual intervention may be required.\n\n[${session.id}] ${title}\n${url}\n${reSnap.nodeCount} elements\n\n${reSnap.text}`;
        }
      } catch { /* skip individual button errors */ }
    }

    // Strategy 2: Look for a checkbox
    const checkbox = page.locator('input[type="checkbox"]').first();
    try {
      if (await checkbox.isVisible({ timeout: 500 })) {
        await checkbox.click();
        await page.waitForTimeout(1000);
        const reSnap = await snapEngine.snapshot(page, session, { interactiveOnly: true, maxChars: MAX_SNAPSHOT_CHARS });
        session.refNavGeneration = session.navGeneration ?? 0;
        const url = page.url();
        let title = "";
        try { title = await page.title(); } catch { /* */ }
        const reClass = PageClassifier.classify({ url, snapshotText: reSnap.text });
        if (reClass.type !== 'challenge') {
          return `[CHALLENGE RESOLVED] Auto-clicked challenge checkbox. Page is now accessible.\n\n[${session.id}] ${title}\n${url}\n${reSnap.nodeCount} elements\n\n${reSnap.text}\n\n[page: ${reClass.type} (${Math.round(reClass.confidence * 100)}%)]`;
        }
        return `[CHALLENGE] Bot challenge detected (${Math.round(confidence * 100)}%). Auto-clicked checkbox but challenge persists. Manual intervention may be required.\n\n[${session.id}] ${title}\n${url}\n${reSnap.nodeCount} elements\n\n${reSnap.text}`;
      }
    } catch { /* checkbox not found or not visible */ }

    // Strategy 3: No simple action found
    // Return null to let the caller output the normal page with classification
    return null;
  } catch {
    return null;
  }
}

// ─── navigate ───────────────────────────────────────────────────────────────

server.registerTool(
  "navigate",
  {
    title: "Navigate & Snapshot",
    description:
      "Navigate to a URL and return a compact accessibility snapshot with @eN refs. " +
      "Refs like @e1, @e2 can be passed directly to the 'act' tool — no CSS selectors needed. " +
      "Snapshots are ~200-500 tokens (vs 15,000 with Playwright MCP).",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      url: z.string().describe("Full URL including https://"),
      waitUntil: z
        .enum(["load", "domcontentloaded", "networkidle"])
        .default("load")
        .describe("Wait strategy. Use networkidle for SPAs."),
    }).strict(),
  },
  async ({ sessionId, url, waitUntil }) => {
    try {
      // Block dangerous URL schemes
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return err(`Invalid URL: ${url}`);
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return err(`Blocked URL scheme: ${parsed.protocol} — only http/https allowed.`);
      }

      // SSRF protection — block internal IPs and cloud metadata
      const ssrfBlock = await checkSSRF(parsed.hostname);
      if (ssrfBlock) {
        logger.warn("security.ssrf_blocked", { url, hostname: parsed.hostname });
        return err(ssrfBlock);
      }

      const startTime = Date.now();
      const session = requireSession(sessionId);
      const page = getPage(session);
      await page.goto(url, { waitUntil });

      // P0 #2: Delete navigator.webdriver post-navigation. Playwright re-adds it
      // via CDP after init scripts run, so we must clean up after goto completes.
      try {
        await page.evaluate(() => {
          try {
            delete (Object.getPrototypeOf(navigator) as any).webdriver;
            delete (Navigator.prototype as any).webdriver;
            delete (navigator as any).webdriver;
          } catch { /* non-configurable or already deleted */ }
        });
      } catch { /* page may have navigated away */ }

      // P0-2: Post-navigation SSRF check — catch 302 redirects to internal IPs
      const finalUrl = page.url();
      try {
        const finalParsed = new URL(finalUrl);
        if (finalParsed.hostname !== parsed.hostname) {
          const redirectBlock = await checkSSRF(finalParsed.hostname);
          if (redirectBlock) {
            logger.warn("security.ssrf_redirect_blocked", { url, finalUrl, hostname: finalParsed.hostname });
            await page.goto("about:blank");
            return err(`Redirect blocked: ${url} redirected to ${finalUrl} — ${redirectBlock}`);
          }
        }
      } catch { /* final URL parse error is non-fatal */ }

      // Bump nav generation — any refs from before this navigation are now stale
      session.navGeneration = (session.navGeneration ?? 0) + 1;
      session.refMap.clear();
      // Reset API captures for the new page
      ApiIntelligence.clearSession(sessionId);

      // Take initial snapshot
      const snapResult = await snapEngine.snapshot(page, session, {
        interactiveOnly: true,
        maxChars: MAX_SNAPSHOT_CHARS,
      });
      session.refNavGeneration = session.navGeneration ?? 0;

      // SPA detection: if 0 interactive elements, wait for JS rendering
      let spaWarning = "";
      if (snapResult.nodeCount === 0) {
        try {
          await page.waitForSelector(
            'input, button, a, select, [role="button"], [role="link"], [role="textbox"]',
            { timeout: 5000 },
          );
          // Re-snapshot with the rendered content
          const reSnap = await snapEngine.snapshot(page, session, {
            interactiveOnly: true,
            maxChars: MAX_SNAPSHOT_CHARS,
          });
          session.refNavGeneration = session.navGeneration ?? 0;
          // Use the re-snapshot result for output
          const pageUrl = page.url();
          let title = "";
          try { title = await page.title(); } catch { /* */ }

          // Page classification
          let classificationLine = "";
          try {
            let meta: { ogType?: string; jsonLdType?: string; robots?: string; description?: string } | undefined;
            try {
              meta = await page.evaluate(() => {
                const og = document.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? undefined;
                const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? undefined;
                const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? undefined;
                let jsonLdType: string | undefined;
                const ld = document.querySelector('script[type="application/ld+json"]');
                if (ld) { try { const parsed = JSON.parse(ld.textContent ?? ""); jsonLdType = parsed["@type"]; } catch { /* */ } }
                return { ogType: og, jsonLdType, robots, description: desc };
              });
            } catch { /* meta extraction is best-effort */ }
            const classification = PageClassifier.classify({ url: pageUrl, snapshotText: reSnap.text, meta });
            classificationLine = `\n\n[page: ${classification.type} (${Math.round(classification.confidence * 100)}%)]`;

            // Auto-challenge solver (Fix 5)
            if (classification.type === 'challenge') {
              const challengeResult = await attemptChallengeResolve(page, session, classification.confidence);
              if (challengeResult) {
                const duration = Date.now() - startTime;
                HarnessIntelligence.recordToolCall(sessionId, 'navigate', { url }, `Navigated to ${url} (${reSnap.nodeCount} elements, challenge resolved)`, duration);
                return ok(challengeResult);
              }
            }
          } catch { /* classification is best-effort */ }

          const duration = Date.now() - startTime;
          HarnessIntelligence.recordToolCall(sessionId, 'navigate', { url }, `Navigated to ${url} (${reSnap.nodeCount} elements)`, duration);
          return ok(`[${session.id}] ${title}\n${pageUrl}\n${reSnap.nodeCount} elements\n\n${reSnap.text}${classificationLine}`);
        } catch {
          // Timeout — no interactive elements appeared
          spaWarning = "\n\n[SPA] Page returned 0 elements. Auto-waited 5s but no interactive elements appeared. Page may be loading — try snapshot() in a moment.";
        }
      }

      // Build output from initial snapshot
      const pageUrl = page.url();
      let title = "";
      try { title = await page.title(); } catch { /* */ }
      let output = `[${session.id}] ${title}\n${pageUrl}\n${snapResult.nodeCount} elements\n\n${snapResult.text}`;

      // Page classification + challenge solver
      try {
        let meta: { ogType?: string; jsonLdType?: string; robots?: string; description?: string } | undefined;
        try {
          meta = await page.evaluate(() => {
            const og = document.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? undefined;
            const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? undefined;
            const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? undefined;
            let jsonLdType: string | undefined;
            const ld = document.querySelector('script[type="application/ld+json"]');
            if (ld) { try { const parsed = JSON.parse(ld.textContent ?? ""); jsonLdType = parsed["@type"]; } catch { /* */ } }
            return { ogType: og, jsonLdType, robots, description: desc };
          });
        } catch { /* meta extraction is best-effort */ }
        const classification = PageClassifier.classify({ url: pageUrl, snapshotText: snapResult.text, meta });
        output += `\n\n[page: ${classification.type} (${Math.round(classification.confidence * 100)}%)]`;

        // Auto-challenge solver (Fix 5)
        if (classification.type === 'challenge') {
          const challengeResult = await attemptChallengeResolve(page, session, classification.confidence);
          if (challengeResult) {
            const duration = Date.now() - startTime;
            HarnessIntelligence.recordToolCall(sessionId, 'navigate', { url }, `Navigated to ${url} (${snapResult.nodeCount} elements, challenge resolved)`, duration);
            return ok(challengeResult);
          }
        }
      } catch { /* classification is best-effort */ }

      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'navigate', { url }, `Navigated to ${url} (${snapResult.nodeCount} elements)`, duration);
      return ok(output + spaWarning);
    } catch (e: any) {
      return err(`Navigate failed: ${e.message}`);
    }
  },
);

// ─── snapshot ───────────────────────────────────────────────────────────────

server.registerTool(
  "snapshot",
  {
    title: "Page Snapshot",
    description:
      "Re-snapshot the current page for fresh @eN refs. " +
      "Use after 'act' when you need to re-orient, or scope to a region with 'selector'. " +
      "Use 'selector' to dramatically reduce tokens (e.g. 'form', '#results').",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      selector: z.string().optional().describe("CSS selector to scope snapshot to a page region."),
      maxChars: z.number().int().default(MAX_SNAPSHOT_CHARS).describe("Max output chars."),
    }).strict(),
  },
  async ({ sessionId, selector, maxChars }) => {
    try {
      const startTime = Date.now();
      const session = requireSession(sessionId);
      const page = getPage(session);

      // Take the snapshot
      const snapResult = await snapEngine.snapshot(page, session, {
        interactiveOnly: true,
        maxChars: maxChars ?? MAX_SNAPSHOT_CHARS,
        selector,
      });

      // Mark refs as fresh — they match the current nav generation
      session.refNavGeneration = session.navGeneration ?? 0;

      const url = page.url();
      let title = "";
      try { title = await page.title(); } catch { /* */ }

      let output = `[${session.id}] ${title}\n${url}\n${snapResult.nodeCount} elements\n\n${snapResult.text}`;

      // Incremental diff: compare with previous snapshot
      const diff = SnapshotDiffer.diff(session.id, url, snapResult);
      if (!diff.isFirst && diff.changeCount >= 0) {
        output += `\n\n${diff.diffText}`;
      }

      // Page classification
      try {
        let meta: { ogType?: string; jsonLdType?: string; robots?: string; description?: string } | undefined;
        try {
          meta = await page.evaluate(() => {
            const og = document.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? undefined;
            const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? undefined;
            const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? undefined;
            let jsonLdType: string | undefined;
            const ld = document.querySelector('script[type="application/ld+json"]');
            if (ld) {
              try {
                const parsed = JSON.parse(ld.textContent ?? "");
                jsonLdType = parsed["@type"];
              } catch { /* */ }
            }
            return { ogType: og, jsonLdType, robots, description: desc };
          });
        } catch { /* meta extraction is best-effort */ }

        const classification = PageClassifier.classify({
          url,
          snapshotText: snapResult.text,
          meta,
        });
        output += `\n\n[page: ${classification.type} (${Math.round(classification.confidence * 100)}%)]`;
      } catch { /* classification is best-effort */ }

      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'snapshot', { selector }, `Snapshot: ${snapResult.nodeCount} elements`, duration);

      return ok(output);
    } catch (e: any) {
      return err(`Snapshot failed: ${e.message}`);
    }
  },
);

// ─── act ────────────────────────────────────────────────────────────────────

server.registerTool(
  "act",
  {
    title: "Browser Action",
    description:
      "Perform a browser interaction: click, fill, type, check, select, press key, scroll, hover, mousemove, drag, upload, resize, back, forward. " +
      "Use @eN refs from navigate/snapshot as the target (e.g. '@e2'). CSS selectors also work. " +
      "drag: requires target (source) and target2 (destination). upload: requires target (file input) and filePaths. " +
      "resize: requires width and height (no target needed). holdDuration: for click, holds mouse down for N ms (long-press). " +
      "Returns a fresh snapshot if the page navigated, or just the action result if it didn't.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      action: z
        .enum(["click", "dblclick", "fill", "type", "check", "uncheck", "select", "press", "scroll", "hover", "mousemove", "drag", "upload", "resize", "back", "forward"])
        .describe("Interaction to perform."),
      target: z
        .string()
        .optional()
        .describe("@eN ref or CSS selector. Required for click, fill, type, check, select, hover."),
      value: z
        .string()
        .optional()
        .describe("Text for fill/type, option value for select."),
      key: z.string().optional().describe("Key name for press (e.g. 'Enter', 'Tab', 'Control+a')."),
      scrollDirection: z
        .enum(["up", "down", "left", "right"])
        .optional()
        .describe("Scroll direction. Default: down."),
      scrollAmount: z.number().int().optional().describe("Pixels to scroll. Default: 300."),
      typeDelay: z
        .number()
        .optional()
        .describe("Delay in ms between keystrokes for action='type'. Enables human-like typing speed."),
      x: z.number().optional().describe("X coordinate for mousemove action."),
      y: z.number().optional().describe("Y coordinate for mousemove action."),
      target2: z
        .string()
        .optional()
        .describe("Drop destination for drag action. @eN ref or CSS selector."),
      filePaths: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe("File path(s) for upload action. Single string or array of strings."),
      width: z.number().int().optional().describe("Viewport width for resize action."),
      height: z.number().int().optional().describe("Viewport height for resize action."),
      holdDuration: z.number().int().min(0).max(10000).optional().describe("Hold duration in ms for click action (long-press). Uses mouse.down() + wait + mouse.up()."),
    }).strict(),
  },
  async ({ sessionId, action, target, value, key, scrollDirection, scrollAmount, typeDelay, x, y, target2, filePaths, width, height, holdDuration }) => {
    try {
      const startTime = Date.now(); // P0-3: track duration for recordToolCall
      const session = requireSession(sessionId);
      const page = getPage(session);
      const urlBefore = page.url();

      // Harness Intelligence: capture pre-state for outcome detection
      // P0-1: Save refs BEFORE try so they're restored in finally even if snapshot() throws.
      // Without this, refs from navigate's snapshot are destroyed before act can use them.
      let preSnapshotText = "";
      const savedRefMap = new Map(session.refMap);
      const savedRefCounter = session.refCounter;
      const savedRefNavGen = session.refNavGeneration;
      try {
        const preSnap = await snapEngine.snapshot(page, session, { interactiveOnly: true, maxChars: MAX_SNAPSHOT_CHARS });
        preSnapshotText = preSnap.text;
        HarnessIntelligence.capturePreState(session.id, urlBefore, preSnapshotText);
      } catch { /* pre-state capture is best-effort */ }
      finally {
        // P0-1: Always restore refs so act's resolve() can still find them
        session.refMap = savedRefMap;
        session.refCounter = savedRefCounter;
        session.refNavGeneration = savedRefNavGen;
      }

      // Resolve target to a Playwright locator (with stale-ref detection)
      const resolve = (ref: string) => {
        if (ref.startsWith("@e")) {
          if ((session.navGeneration ?? 0) > (session.refNavGeneration ?? 0)) {
            throw new Error(
              `Ref ${ref} is stale — the page has navigated since the last snapshot. Take a new snapshot to get updated refs.`,
            );
          }
          const selector = session.refMap.get(ref);
          if (!selector) throw new Error(`Ref ${ref} not found. Take a fresh snapshot.`);
          return page.locator(selector);
        }
        return page.locator(ref); // CSS selectors don't go stale
      };

      switch (action) {
        case "click":
        case "dblclick":
        case "hover": {
          if (!target) return err(`'${action}' requires a target`);
          const loc = resolve(target);
          if (action === "click") {
            await thinkPause.beforeAction("click");
            if (holdDuration) {
              // Long-press: mouse down, wait, mouse up
              try {
                const box = await loc.boundingBox();
                if (!box) {
                  throw new Error(`Element not found or not visible for target '${target}' — cannot perform long-press. Verify the selector or take a fresh snapshot.`);
                }
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down();
                await page.waitForTimeout(holdDuration);
                await page.mouse.up();
              } catch (e: any) {
                throw new Error(`holdDuration click failed on '${target}': ${e.message}`);
              }
            } else if (isHumanizeEnabled()) {
              // Humanized click: Bezier move to target center, dwell, then click
              const box = await loc.boundingBox();
              if (box) {
                const cx = box.x + box.width / 2;
                const cy = box.y + box.height / 2;
                await humanMouse.humanClick(page, cx, cy);
              } else {
                await loc.click();
              }
            } else {
              await loc.click();
            }
          } else if (action === "dblclick") {
            await thinkPause.beforeAction("click");
            await loc.dblclick();
          } else {
            // hover
            await thinkPause.beforeAction("click");
            if (isHumanizeEnabled()) {
              const box = await loc.boundingBox();
              if (box) {
                const cx = box.x + box.width / 2;
                const cy = box.y + box.height / 2;
                await humanMouse.moveTo(page, cx, cy);
              } else {
                await loc.hover();
              }
            } else {
              await loc.hover();
            }
          }
          break;
        }
        case "fill": {
          if (!target || value === undefined) return err("'fill' requires target and value");
          await thinkPause.beforeAction("type");
          await resolve(target).fill(value);
          break;
        }
        case "type": {
          if (!target || value === undefined) return err("'type' requires target and value");
          await thinkPause.beforeAction("type");
          if (isHumanizeEnabled()) {
            // Focus the element first, then use humanized keystroke timing
            await resolve(target).click();
            await humanTyping.typeText(page, value);
          } else {
            const typeOpts: { delay?: number } = {};
            if (typeDelay !== undefined) typeOpts.delay = typeDelay;
            await resolve(target).pressSequentially(value, typeOpts);
          }
          break;
        }
        case "check":
        case "uncheck": {
          if (!target) return err(`'${action}' requires a target`);
          await thinkPause.beforeAction("click");
          if (action === "check") await resolve(target).check();
          else await resolve(target).uncheck();
          break;
        }
        case "select": {
          if (!target || value === undefined) return err("'select' requires target and value");
          await thinkPause.beforeAction("click");
          await resolve(target).selectOption(value);
          break;
        }
        case "press": {
          if (!key) return err("'press' requires a key");
          await page.keyboard.press(key);
          break;
        }
        case "scroll": {
          await thinkPause.beforeAction("scroll");
          if (target) {
            await resolve(target).scrollIntoViewIfNeeded();
          } else {
            const dir = scrollDirection ?? "down";
            const px = scrollAmount ?? 300;
            if (isHumanizeEnabled()) {
              // Humanized momentum scroll
              const deltaY = dir === "down" ? px : dir === "up" ? -px : 0;
              const deltaX = dir === "right" ? px : dir === "left" ? -px : 0;
              if (deltaY !== 0) {
                await humanScroll.scroll(page, deltaY);
              } else if (deltaX !== 0) {
                // Horizontal scroll — humanScroll handles vertical only, fall back to wheel
                await page.mouse.wheel(deltaX, 0);
              }
            } else {
              const deltaX = dir === "right" ? px : dir === "left" ? -px : 0;
              const deltaY = dir === "down" ? px : dir === "up" ? -px : 0;
              await page.mouse.wheel(deltaX, deltaY);
            }
          }
          break;
        }
        case "mousemove": {
          if (x === undefined || y === undefined) return err("'mousemove' requires x and y coordinates");
          if (isHumanizeEnabled()) {
            await humanMouse.moveTo(page, x, y);
          } else {
            await page.mouse.move(x, y);
          }
          break;
        }
        case "drag": {
          if (!target) return err("'drag' requires a target (source element)");
          if (!target2) return err("'drag' requires target2 (drop destination)");
          const source = resolve(target);
          const dest = resolve(target2);
          await source.dragTo(dest);
          break;
        }
        case "upload": {
          if (!target) return err("'upload' requires a target (file input element)");
          if (!filePaths) return err("'upload' requires filePaths");
          const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
          await resolve(target).setInputFiles(paths);
          break;
        }
        case "resize": {
          if (width === undefined || height === undefined) return err("'resize' requires width and height");
          await page.setViewportSize({ width, height });
          break;
        }
        case "back":
          await page.goBack();
          break;
        case "forward":
          await page.goForward();
          break;
      }

      // If the URL changed, return a full snapshot of the new page
      const urlAfter = page.url();

      // Harness Intelligence: analyze post-action state
      let harnessOutput = "";
      try {
        const postSnap = await snapEngine.snapshot(page, session, { interactiveOnly: true, maxChars: MAX_SNAPSHOT_CHARS });
        const harnessState = HarnessIntelligence.analyzePostAction(
          session.id, action, target, value, urlAfter, postSnap.text,
        );
        // Only append harness output if there's something noteworthy
        if (harnessState.outcome !== "SUCCESS" || harnessState.loopWarning || harnessState.stuckWarning) {
          harnessOutput = "\n\n" + formatHarnessOutput(harnessState);
        }
      } catch { /* harness analysis is best-effort */ }

      // P0-3: Record act tool call in session memory
      const actDuration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'act', { action, target, value }, `${action}${target ? ` ${target}` : ''}`, actDuration);

      if (urlAfter !== urlBefore) {
        try { await page.waitForLoadState("load", { timeout: 5000 }); } catch { /* timeout ok */ }
        const text = await snapAndFormat(session);
        return ok(`[navigated → ${urlAfter}]\n\n${text}${harnessOutput}`);
      }

      // Same page — brief confirmation
      return ok(`Done: ${action}${target ? ` ${target}` : ""}${value ? ` "${value}"` : ""}${harnessOutput}`);
    } catch (e: any) {
      return err(`Action failed: ${e.message}`);
    }
  },
);

// ─── screenshot ─────────────────────────────────────────────────────────────

server.registerTool(
  "screenshot",
  {
    title: "Screenshot",
    description: "Capture a screenshot of the current page. Returns the image inline as base64. Optionally save to disk with savePath.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      fullPage: z.boolean().default(false).describe("Capture full scrollable page."),
      selector: z.string().optional().describe("CSS selector to capture a specific element."),
      savePath: z.string().optional().describe("Optional file path to save the screenshot to disk. If omitted, image is returned inline only."),
    }).strict(),
  },
  async ({ sessionId, fullPage, selector, savePath }) => {
    try {
      const startTime = Date.now(); // P0-3
      const session = requireSession(sessionId);
      const page = getPage(session);

      let imageBuffer: Buffer;
      if (selector) {
        imageBuffer = await page.locator(selector).screenshot();
      } else {
        imageBuffer = await page.screenshot({ fullPage });
      }

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/png" }> = [];

      if (savePath) {
        await fs.mkdir(path.dirname(savePath), { recursive: true });
        await fs.writeFile(savePath, imageBuffer);
        content.push({ type: "text" as const, text: `Saved: ${savePath}` });
      }

      content.push({ type: "image" as const, data: imageBuffer.toString("base64"), mimeType: "image/png" as const });

      // P0-3: Record screenshot tool call in session memory
      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'screenshot', { fullPage, selector, savePath }, `Screenshot captured${savePath ? ` → ${savePath}` : ''}`, duration);

      return { content };
    } catch (e: any) {
      return err(`Screenshot failed: ${e.message}`);
    }
  },
);

// ─── extract ────────────────────────────────────────────────────────────────

server.registerTool(
  "extract",
  {
    title: "Extract Data",
    description:
      "Extract data from the page without a full snapshot. " +
      "Types: text (visible text), html (markup), title, url, js (evaluate JavaScript). " +
      "Use target with @eN or CSS selector for element-specific extraction.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      type: z
        .enum(["text", "html", "title", "url", "js"])
        .default("text")
        .describe("What to extract."),
      target: z.string().optional().describe("@eN ref or CSS selector. Omit for page-level."),
      js: z.string().optional().describe("JavaScript expression for type='js'."),
      maxChars: z.number().int().default(5000).describe("Max output characters."),
    }).strict(),
  },
  async ({ sessionId, type, target, js, maxChars }) => {
    try {
      const startTime = Date.now(); // P0-3
      const session = requireSession(sessionId);
      const page = getPage(session);
      let result: string;

      const resolve = (ref: string) => {
        if (ref.startsWith("@e")) {
          if ((session.navGeneration ?? 0) > (session.refNavGeneration ?? 0)) {
            throw new Error(
              `Ref ${ref} is stale — the page has navigated since the last snapshot. Take a new snapshot to get updated refs.`,
            );
          }
          const sel = session.refMap.get(ref);
          if (!sel) throw new Error(`Ref ${ref} not found.`);
          return page.locator(sel);
        }
        return page.locator(ref); // CSS selectors don't go stale
      };

      switch (type) {
        case "title":
          result = await page.title();
          break;
        case "url":
          result = page.url();
          break;
        case "js": {
          if (!js) return err("type='js' requires a js expression.");
          if (!ALLOW_JS) return err("JavaScript evaluation is disabled. Set LEAP_ALLOW_JS=true to enable.");
          let val: unknown;
          try {
            val = await Promise.race([
              page.evaluate(js),
              new Promise((_, reject) => setTimeout(() => reject(new Error("JS evaluation timed out (10s)")), 10000)),
            ]);
          } catch (evalErr: any) {
            return err(`JS eval failed: ${evalErr.message}`);
          }
          if (val === undefined || val === null) {
            result = String(val);
          } else {
            result = typeof val === "string" ? val : JSON.stringify(val, null, 2);
          }
          break;
        }
        case "text": {
          if (target) {
            const el = resolve(target);
            result = await el.evaluate((node: Element) => {
              const clone = node.cloneNode(true) as Element;
              clone.querySelectorAll('script, style, noscript, template, [hidden], [aria-hidden="true"]').forEach(e => e.remove());
              return (clone as HTMLElement).innerText?.trim() ?? clone.textContent?.trim() ?? "";
            });
          } else {
            result = await page.evaluate(() => {
              const clone = document.body.cloneNode(true) as HTMLElement;
              clone.querySelectorAll('script, style, noscript, template, [hidden], [aria-hidden="true"]').forEach(e => e.remove());
              return clone.innerText?.trim() ?? "";
            });
          }
          break;
        }
        case "html": {
          if (target) {
            result = await resolve(target).innerHTML();
          } else {
            result = await page.content();
          }
          break;
        }
      }

      if (result.length > maxChars) {
        result = result.substring(0, maxChars) + "\n... (truncated)";
      }

      // P0-3: Record extract in session memory
      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'extract', { type, target }, `Extract ${type}: ${result.slice(0, 80)}`, duration);

      return ok(result || "(empty)");
    } catch (e: any) {
      return err(`Extract failed: ${e.message}`);
    }
  },
);

// ─── pool_status ────────────────────────────────────────────────────────────

server.registerTool(
  "pool_status",
  {
    title: "Pool Status & Resources",
    description: "Show pool stats, resource usage (memory, uptime), and all active session summaries. Shows per-session idle time. Sessions approaching 30-minute idle timeout should be refreshed or saved.",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    const stats = sessions.getStats();
    const resources = sessions.getResourceUsage();
    const list = sessions.listSessions();

    const lines = [
      `Sessions: ${stats.active}/${stats.maxSessions} (${stats.totalCreated} total created)`,
      `Memory: ${resources.heapUsedMB}MB heap / ${resources.rssMB}MB RSS`,
      `Uptime: ${resources.uptimeSeconds}s`,
    ];

    if (list.length > 0) {
      lines.push("", "Active sessions:");
      const now = Date.now();
      for (const s of list) {
        const idle = Math.round((now - s.lastUsedAt) / 1000);
        lines.push(`  ${s.id}  ${s.url || "(blank)"}  idle ${idle}s`);
      }
    }

    return ok(lines.join("\n"));
  },
);

// ─── network_log ───────────────────────────────────────────────────────────

server.registerTool(
  "network_log",
  {
    title: "Network Log",
    description:
      "View captured HTTP requests/responses for a session. " +
      "Shows method, status, URL, size, and timing. " +
      "Filter by URL pattern, method, status range, or content-type. " +
      "Network capture starts automatically when a session is created.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      urlPattern: z.string().optional().describe("Regex or substring to filter URLs."),
      method: z.string().optional().describe("HTTP method filter (GET, POST, etc)."),
      statusMin: z.number().int().optional().describe("Minimum status code (e.g. 400 for errors)."),
      statusMax: z.number().int().optional().describe("Maximum status code."),
      contentType: z.string().optional().describe("Content-type filter (e.g. 'json')."),
    }).strict(),
  },
  async ({ sessionId, urlPattern, method, statusMin, statusMax, contentType }) => {
    try {
      const session = requireSession(sessionId);
      const text = networkIntelligence.getNetworkLog(session, {
        urlPattern, method, statusMin, statusMax, contentType,
      });
      return ok(text);
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── console_log ──────────────────────────────────────────────────────────

server.registerTool(
  "console_log",
  {
    title: "Console Log",
    description:
      "View captured browser console messages (log, warn, error, info, debug). " +
      "Console capture starts automatically when a session is created. " +
      "Use level filter to focus on errors or warnings.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      level: z.string().optional().describe("Filter by level: error, warn, log, info, debug."),
    }).strict(),
  },
  async ({ sessionId, level }) => {
    try {
      const session = requireSession(sessionId);
      const text = networkIntelligence.getConsoleLog(session, { level });
      return ok(text);
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── network_intercept ────────────────────────────────────────────────────

server.registerTool(
  "network_intercept",
  {
    title: "Network Intercept",
    description:
      "Add or remove network intercept rules. " +
      "Block requests (ads, trackers), mock API responses, or log specific traffic. " +
      "Use action='remove' with ruleId to remove an existing rule.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      action: z.enum(["block", "log", "mock", "remove"]).describe("Intercept action."),
      ruleId: z.string().describe("Unique rule ID. Use for adding and removing rules."),
      urlPattern: z.string().optional().describe("URL glob pattern to match (e.g. '**/analytics/**'). Required for block/log/mock."),
      mockStatus: z.number().int().optional().describe("HTTP status for mock responses."),
      mockBody: z.string().optional().describe("Response body for mock responses."),
      mockContentType: z.string().optional().describe("Content-type for mock responses. Default: application/json."),
    }).strict(),
  },
  async ({ sessionId, action, ruleId, urlPattern, mockStatus, mockBody, mockContentType }) => {
    try {
      const startTime = Date.now();
      const session = requireSession(sessionId);
      const page = getPage(session);

      if (action === "remove") {
        await networkIntelligence.removeIntercept(page, session, ruleId);
        const duration = Date.now() - startTime;
        HarnessIntelligence.recordToolCall(sessionId, 'network_intercept', { action, ruleId }, `Removed intercept rule: ${ruleId}`, duration);
        return ok(`Removed intercept rule: ${ruleId}`);
      }

      if (!urlPattern) return err("urlPattern is required for block/log/mock actions.");

      const rule = {
        id: ruleId,
        urlPattern,
        action: action as "block" | "log" | "mock",
        ...(action === "mock" ? {
          mockResponse: {
            status: mockStatus ?? 200,
            body: mockBody ?? "{}",
            contentType: mockContentType ?? "application/json",
          },
        } : {}),
      };

      await networkIntelligence.addIntercept(page, session, rule);
      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'network_intercept', { action, ruleId, urlPattern }, `Intercept rule added: ${ruleId} → ${action} ${urlPattern}`, duration);
      return ok(`Intercept rule added: ${ruleId} → ${action} ${urlPattern}`);
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── wait_for ─────────────────────────────────────────────────────────────

server.registerTool(
  "wait_for",
  {
    title: "Smart Wait",
    description:
      "Wait for a condition before proceeding. " +
      "Supports: element visible, text appears, network idle, URL navigation, JS expression truthy. " +
      "Returns a fresh snapshot after the wait completes.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      condition: z.enum(["element", "text", "network_idle", "navigation", "js"]).describe("What to wait for."),
      target: z.string().optional().describe("@eN ref or CSS selector (for element/text conditions)."),
      text: z.string().optional().describe("Text to find (for text condition) or URL pattern (for navigation)."),
      js: z.string().optional().describe("JS expression that should return truthy (for js condition)."),
      timeout: z.number().int().default(10000).describe("Max wait time in ms. Default 10000, max 30000."),
    }).strict(),
  },
  async ({ sessionId, condition, target, text, js, timeout }) => {
    try {
      const startTime = Date.now();
      const session = requireSession(sessionId);
      if (condition === "js" && !ALLOW_JS) {
        return err("JavaScript evaluation is disabled. Set LEAP_ALLOW_JS=true to enable.");
      }
      const page = getPage(session);
      await tabManager.waitFor(page, session, { type: condition, target, text, js, timeout });
      const snap = await snapAndFormat(session);
      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'wait_for', { condition, target, text }, `Wait complete: ${condition}`, duration);
      return ok(`Wait complete: ${condition}\n\n${snap}`);
    } catch (e: any) {
      return err(`Wait failed: ${e.message}`);
    }
  },
);

// ─── tabs_list ────────────────────────────────────────────────────────────

server.registerTool(
  "tabs_list",
  {
    title: "List Tabs",
    description:
      "List all open tabs in a session. Shows index, URL, title, and which tab is active. " +
      "New tabs (popups, OAuth windows) are automatically tracked.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
    }).strict(),
  },
  async ({ sessionId }) => {
    try {
      const session = requireSession(sessionId);
      const tabs = await tabManager.listTabs(session);
      if (tabs.length === 0) return ok("No open tabs.");

      const lines = tabs.map((t) => {
        const active = t.isActive ? " *active*" : "";
        return `[${t.index}]${active} ${t.url} "${t.title}"`;
      });
      return ok(lines.join("\n"));
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── tab_switch ───────────────────────────────────────────────────────────

server.registerTool(
  "tab_switch",
  {
    title: "Switch Tab",
    description:
      "Switch to a different tab by index. Use -1 to switch to the most recently opened tab (useful for popups). " +
      "Returns a snapshot of the newly active tab.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      tabIndex: z.number().int().describe("Tab index to switch to. -1 for last (most recent) tab."),
    }).strict(),
  },
  async ({ sessionId, tabIndex }) => {
    try {
      const startTime = Date.now();
      const session = requireSession(sessionId);
      tabManager.switchTab(session, tabIndex);
      const snap = await snapAndFormat(session);
      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'tab_switch', { tabIndex }, `Switched to tab ${tabIndex}`, duration);
      return ok(`Switched to tab ${tabIndex}\n\n${snap}`);
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── tab_close ────────────────────────────────────────────────────────────

server.registerTool(
  "tab_close",
  {
    title: "Close Tab",
    description:
      "Close a tab by index. Defaults to the active tab. Cannot close the last remaining tab. " +
      "Returns a snapshot of the new active tab.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      tabIndex: z.number().int().optional().describe("Tab index to close. Omit to close the active tab."),
    }).strict(),
  },
  async ({ sessionId, tabIndex }) => {
    try {
      const startTime = Date.now();
      const session = requireSession(sessionId);
      await tabManager.closeTab(session, tabIndex);
      const snap = await snapAndFormat(session);
      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'tab_close', { tabIndex }, `Tab closed`, duration);
      return ok(`Tab closed.\n\n${snap}`);
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── session_health ───────────────────────────────────────────────────────

server.registerTool(
  "session_health",
  {
    title: "Session Health Check",
    description:
      "Check if a session is healthy (browser connected, page responsive). " +
      "Omit sessionId to check all sessions. Quick diagnostic for debugging.",
    inputSchema: z.object({
      sessionId: z.string().optional().describe("Session ID. Omit to check all."),
    }).strict(),
  },
  async ({ sessionId }) => {
    try {
      if (sessionId) {
        const session = requireSession(sessionId);
        const result = await crashRecovery.healthCheck(session);
        return ok(`${sessionId}: ${result.healthy ? "healthy" : `unhealthy — ${result.reason}`}`);
      }

      // Check all sessions
      const allSessions = sessions.getSessions();
      if (allSessions.size === 0) return ok("No active sessions.");

      const results = await crashRecovery.healthCheckAll(allSessions);
      const lines: string[] = [];
      for (const [id, result] of results) {
        lines.push(`${id}: ${result.healthy ? "healthy" : `unhealthy — ${result.reason}`}`);
      }
      return ok(lines.join("\n"));
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── add_init_script ─────────────────────────────────────────────────────

server.registerTool(
  "add_init_script",
  {
    title: "Add Init Script",
    description:
      "Inject JavaScript that runs before every page load in a session. " +
      "Persists across navigations (Playwright built-in behavior). " +
      "Use for fingerprint overrides, custom stealth patches, or page instrumentation.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      script: z.string().describe("JavaScript code to inject. Runs in page context before any page scripts."),
    }).strict(),
  },
  async ({ sessionId, script }) => {
    try {
      const startTime = Date.now();
      const session = requireSession(sessionId);
      // Apply to all current pages in the session
      const pages = session.context.pages();
      for (const page of pages) {
        await page.addInitScript(script);
      }
      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'add_init_script', { script: script.slice(0, 80) }, `Init script added (${pages.length} page(s))`, duration);
      return ok(`Init script added to session ${sessionId} (${pages.length} page(s)). Will persist across navigations.`);
    } catch (e: any) {
      return err(`addInitScript failed: ${e.message}`);
    }
  },
);

// ─── batch_actions ────────────────────────────────────────────────────────

const BatchActionSchema = z.object({
  action: z
    .enum(["click", "dblclick", "fill", "type", "check", "uncheck", "select", "press", "scroll", "hover", "mousemove", "back", "forward"])
    .describe("Interaction to perform."),
  target: z.string().optional().describe("@eN ref or CSS selector."),
  value: z.string().optional().describe("Text for fill/type, option value for select."),
  key: z.string().optional().describe("Key name for press."),
  scrollDirection: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction."),
  scrollAmount: z.number().int().optional().describe("Pixels to scroll."),
  typeDelay: z.number().optional().describe("Delay in ms between keystrokes for type."),
  x: z.number().optional().describe("X coordinate for mousemove."),
  y: z.number().optional().describe("Y coordinate for mousemove."),
  delayAfter: z.number().optional().describe("Delay in ms to wait after this action completes."),
}).strict();

server.registerTool(
  "batch_actions",
  {
    title: "Batch Actions",
    description:
      "Execute multiple browser actions sequentially in a single MCP call. " +
      "Eliminates round-trip overhead for humanization sequences (e.g. Bezier mouse paths, typed text with delays). " +
      "Each action can have an optional delayAfter (ms) to pause between steps. " +
      "Returns a single result with the outcome of each action.",
    inputSchema: z.object({
      sessionId: z.string().describe("Session ID."),
      actions: z.array(BatchActionSchema).min(1).max(100).describe("Array of actions to execute sequentially."),
    }).strict(),
  },
  async ({ sessionId, actions }) => {
    try {
      const startTime = Date.now();
      const session = requireSession(sessionId);
      const page = getPage(session);
      const results: string[] = [];

      const resolve = (ref: string) => {
        if (ref.startsWith("@e")) {
          if ((session.navGeneration ?? 0) > (session.refNavGeneration ?? 0)) {
            throw new Error(
              `Ref ${ref} is stale — the page has navigated since the last snapshot. Take a new snapshot to get updated refs.`,
            );
          }
          const selector = session.refMap.get(ref);
          if (!selector) throw new Error(`Ref ${ref} not found. Take a fresh snapshot.`);
          return page.locator(selector);
        }
        return page.locator(ref); // CSS selectors don't go stale
      };

      for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        try {
          switch (a.action) {
            case "click":
            case "dblclick":
            case "hover": {
              if (!a.target) throw new Error(`'${a.action}' requires a target`);
              const loc = resolve(a.target);
              if (a.action === "dblclick") await loc.dblclick();
              else if (a.action === "hover") await loc.hover();
              else await loc.click();
              break;
            }
            case "fill": {
              if (!a.target || a.value === undefined) throw new Error("'fill' requires target and value");
              await resolve(a.target).fill(a.value);
              break;
            }
            case "type": {
              if (!a.target || a.value === undefined) throw new Error("'type' requires target and value");
              const opts: { delay?: number } = {};
              if (a.typeDelay !== undefined) opts.delay = a.typeDelay;
              await resolve(a.target).pressSequentially(a.value, opts);
              break;
            }
            case "check":
            case "uncheck": {
              if (!a.target) throw new Error(`'${a.action}' requires a target`);
              if (a.action === "check") await resolve(a.target).check();
              else await resolve(a.target).uncheck();
              break;
            }
            case "select": {
              if (!a.target || a.value === undefined) throw new Error("'select' requires target and value");
              await resolve(a.target).selectOption(a.value);
              break;
            }
            case "press": {
              if (!a.key) throw new Error("'press' requires a key");
              await page.keyboard.press(a.key);
              break;
            }
            case "scroll": {
              if (a.target) {
                await resolve(a.target).scrollIntoViewIfNeeded();
              } else {
                const dir = a.scrollDirection ?? "down";
                const px = a.scrollAmount ?? 300;
                const deltaX = dir === "right" ? px : dir === "left" ? -px : 0;
                const deltaY = dir === "down" ? px : dir === "up" ? -px : 0;
                await page.mouse.wheel(deltaX, deltaY);
              }
              break;
            }
            case "mousemove": {
              if (a.x === undefined || a.y === undefined) throw new Error("'mousemove' requires x and y");
              await page.mouse.move(a.x, a.y);
              break;
            }
            case "back":
              await page.goBack();
              break;
            case "forward":
              await page.goForward();
              break;
          }
          results.push(`[${i}] ${a.action}: ok`);
        } catch (actionErr: any) {
          results.push(`[${i}] ${a.action}: FAILED — ${actionErr.message}`);
          // Stop batch on first failure to avoid cascading errors
          break;
        }

        // Optional delay between actions
        if (a.delayAfter && a.delayAfter > 0) {
          await new Promise((r) => setTimeout(r, Math.min(a.delayAfter!, 10000)));
        }
      }

      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'batch_actions', { actionCount: actions.length }, `${results.length}/${actions.length} actions completed`, duration);

      return ok(`Batch complete (${results.length}/${actions.length} actions)\n\n${results.join("\n")}`);
    } catch (e: any) {
      return err(`Batch failed: ${e.message}`);
    }
  },
);

// ─── execute ──────────────────────────────────────────────────────────────

server.registerTool(
  "execute",
  {
    title: "Execute Script",
    description:
      "Run a Playwright script in a sandboxed environment. One tool call replaces 5-20 sequential MCP round trips. " +
      "Use for complex flows with conditional logic, loops, error handling.",
    inputSchema: z.object({
      sessionId: z.string(),
      script: z
        .string()
        .describe("JavaScript async function body with access to { page, context }. Example: 'await page.goto(\"...\"); return await page.title();'"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in ms. Default: 60000, max: 300000."),
    }).strict(),
  },
  async ({ sessionId, script, timeout }) => {
    try {
      const startTime = Date.now();
      if (!ALLOW_EXECUTE) {
        return err("execute tool is disabled. Set LEAP_ALLOW_EXECUTE=true to enable.");
      }
      const session = requireSession(sessionId);
      const result = await ScriptExecutor.execute(session, { script, timeout });
      const lines = [
        `Return: ${result.returnValue}`,
        `Duration: ${result.duration}ms`,
      ];
      if (result.console.length > 0) {
        lines.push("", "Console:", ...result.console);
      }

      const duration = Date.now() - startTime;
      HarnessIntelligence.recordToolCall(sessionId, 'execute', { code: script.slice(0, 80) }, `Result: ${String(result.returnValue).slice(0, 100)}`, duration);

      return ok(lines.join("\n"));
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── api_discover ─────────────────────────────────────────────────────────

server.registerTool(
  "api_discover",
  {
    title: "Discover Page APIs",
    description:
      "List JSON APIs the page has called. Captured automatically from XHR/fetch traffic. " +
      "Classifies into: data, tracking, auth, cdn, ads.",
    inputSchema: z.object({
      sessionId: z.string(),
      category: z
        .enum(["data", "tracking", "auth", "cdn", "ads"])
        .optional(),
      minConfidence: z
        .number()
        .optional()
        .describe("Minimum classification confidence (0-1). Default: 0."),
    }).strict(),
  },
  async ({ sessionId, category, minConfidence }) => {
    try {
      requireSession(sessionId);
      const result = ApiIntelligence.discover(sessionId, { category, minConfidence });

      if (result.total === 0) {
        return ok("No API calls captured yet. Navigate to a page first.");
      }

      const lines = [
        `${result.total} API calls captured (data: ${result.summary.data}, tracking: ${result.summary.tracking}, auth: ${result.summary.auth}, cdn: ${result.summary.cdn}, ads: ${result.summary.ads})`,
        "",
      ];

      for (const cap of result.captured) {
        const gql = cap.graphql ? ` [GraphQL: ${cap.graphql.operationType ?? "query"} ${cap.graphql.operationName ?? ""}]` : "";
        const shape = cap.dataShape ? ` keys: ${Object.keys(cap.dataShape).join(", ")}` : "";
        lines.push(
          `[${cap.index}] ${cap.method} ${cap.status} ${cap.url} (${cap.category} ${Math.round(cap.confidence * 100)}%)${gql}${shape}`,
        );
      }

      return ok(lines.join("\n"));
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── api_export ───────────────────────────────────────────────────────────

server.registerTool(
  "api_export",
  {
    title: "Export OpenAPI Spec",
    description:
      "Generate an OpenAPI v3 spec from observed API traffic. " +
      "Navigate pages first to capture traffic, then export.",
    inputSchema: z.object({
      sessionId: z.string(),
      title: z.string().optional().describe("API spec title."),
      includeTracking: z
        .boolean()
        .optional()
        .describe("Include tracking/analytics endpoints. Default: false."),
    }).strict(),
  },
  async ({ sessionId, title, includeTracking }) => {
    try {
      requireSession(sessionId);
      const spec = ApiIntelligence.exportOpenApi(sessionId, { title, includeTracking });
      const pathCount = Object.keys(spec.paths).length;
      if (pathCount === 0) {
        return ok("No API endpoints captured. Navigate to pages first to capture traffic.");
      }
      return ok(`OpenAPI spec (${pathCount} endpoints):\n\n${JSON.stringify(spec, null, 2)}`);
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── session_memory ───────────────────────────────────────────────────────

server.registerTool(
  "session_memory",
  {
    title: "Session Action History",
    description:
      "Recall what actions were performed in this session. " +
      "Useful after context window compression to recover lost context.",
    inputSchema: z.object({
      sessionId: z.string(),
      limit: z
        .number()
        .optional()
        .describe("Number of recent actions to return. Default: 20."),
    }).strict(),
  },
  async ({ sessionId, limit }) => {
    try {
      requireSession(sessionId);
      const history = HarnessIntelligence.getHistory(sessionId, limit ?? 20);
      if (history.length === 0) {
        return ok("No actions recorded in this session yet.");
      }

      const lines = history.map((rec) => {
        const parts = [
          `[${rec.index}]`,
          rec.actionType,
          rec.target ?? "",
          rec.value ? `"${rec.value}"` : "",
          `→ ${rec.outcome}`,
          `(${rec.duration}ms)`,
          rec.url,
        ];
        return parts.filter(Boolean).join(" ");
      });

      return ok(`${history.length} action(s):\n\n${lines.join("\n")}`);
    } catch (e: any) {
      return err(e.message);
    }
  },
);

// ─── profile_list ─────────────────────────────────────────────────────────

server.registerTool(
  "profile_list",
  {
    title: "List Auth Profiles",
    description: "List saved persistent browser profiles with their auth status.",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    try {
      try {
        await fs.mkdir(LEAP_PROFILES_DIR, { recursive: true });
      } catch { /* */ }

      let entries: string[] = [];
      try {
        entries = await fs.readdir(LEAP_PROFILES_DIR);
      } catch {
        return ok("No profiles directory found.");
      }

      // Filter to directories only
      const profiles: string[] = [];
      for (const entry of entries) {
        try {
          const stat = await fs.stat(path.join(LEAP_PROFILES_DIR, entry));
          if (stat.isDirectory()) {
            profiles.push(entry);
          }
        } catch { /* skip */ }
      }

      if (profiles.length === 0) {
        return ok("No saved profiles.");
      }

      const lines = profiles.map((name) =>
        `${name}  →  ${path.join(LEAP_PROFILES_DIR, name)}`,
      );
      return ok(lines.join("\n"));
    } catch (e: any) {
      return err(`List failed: ${e.message}`);
    }
  },
);

// ─── profile_delete ───────────────────────────────────────────────────────

server.registerTool(
  "profile_delete",
  {
    title: "Delete Auth Profile",
    description: "Delete a saved persistent browser profile and all its data.",
    inputSchema: z.object({
      name: z.string().describe("Profile name to delete."),
    }).strict(),
  },
  async ({ name }) => {
    try {
      const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
      if (!safeName) return err("Invalid profile name.");

      const profileDir = path.join(LEAP_PROFILES_DIR, safeName);
      const resolved = path.resolve(profileDir);
      if (!resolved.startsWith(path.resolve(LEAP_PROFILES_DIR))) {
        return err("Invalid profile path.");
      }

      try {
        await fs.access(profileDir);
      } catch {
        return err(`Profile not found: ${safeName}`);
      }

      await fs.rm(profileDir, { recursive: true, force: true });
      return ok(`Deleted profile: ${safeName}`);
    } catch (e: any) {
      return err(`Delete failed: ${e.message}`);
    }
  },
);

// ─── CLI Flags ─────────────────────────────────────────────────────────────

async function runDoctor(): Promise<void> {
  const checks: Array<{ label: string; status: "pass" | "fail" | "warn"; detail?: string }> = [];

  // Node version
  const nodeVersion = process.versions.node;
  const major = parseInt(nodeVersion.split(".")[0], 10);
  checks.push({
    label: "Node.js >= 18",
    status: major >= 18 ? "pass" : "fail",
    detail: `v${nodeVersion}`,
  });

  // Chromium binary (via playwright-core)
  let chromiumPath = "";
  try {
    const { chromium } = await import("playwright-core");
    chromiumPath = chromium.executablePath();
    await fs.access(chromiumPath);
    checks.push({ label: "Chromium binary", status: "pass", detail: chromiumPath });
  } catch {
    checks.push({
      label: "Chromium binary",
      status: "fail",
      detail: "Not found. Set LEAP_CHANNEL=chrome to use system Chrome, or run: npx playwright-core install chromium",
    });
  }

  // Can launch browser
  if (chromiumPath) {
    try {
      const { chromium } = await import("playwright-core");
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto("about:blank");
      await browser.close();
      checks.push({ label: "Browser launch", status: "pass" });
    } catch (e: any) {
      checks.push({ label: "Browser launch", status: "fail", detail: e.message });
    }
  } else {
    checks.push({ label: "Browser launch", status: "fail", detail: "Skipped (no binary)" });
  }

  // Profiles directory
  try {
    await fs.mkdir(PROFILE_DIR, { recursive: true });
    await fs.access(PROFILE_DIR, (await import("fs")).constants.W_OK);
    checks.push({ label: "Profiles directory", status: "pass", detail: PROFILE_DIR });
  } catch {
    checks.push({ label: "Profiles directory", status: "warn", detail: `Not writable: ${PROFILE_DIR}` });
  }

  // Print results
  console.log("\nLeapfrog Doctor\n");
  for (const c of checks) {
    const tag = c.status === "pass" ? "[pass]" : c.status === "fail" ? "[fail]" : "[warn]";
    const detail = c.detail ? `  ${c.detail}` : "";
    console.log(`  ${tag}  ${c.label}${detail}`);
  }

  // Env var summary
  console.log("\nEnvironment:\n");
  console.log(`  LEAP_MAX_SESSIONS   = ${process.env.LEAP_MAX_SESSIONS ?? "(default: 15)"}`);
  console.log(`  LEAP_IDLE_TIMEOUT   = ${process.env.LEAP_IDLE_TIMEOUT ?? "(default: 1800000)"}`);
  console.log(`  LEAP_HEADLESS       = ${process.env.LEAP_HEADLESS ?? "(default: true)"}`);
  console.log(`  LEAP_CHANNEL        = ${process.env.LEAP_CHANNEL ?? "(default: bundled chromium)"}`);
  console.log(`  LEAP_ALLOW_JS       = ${process.env.LEAP_ALLOW_JS ?? "(default: true)"}`);
  console.log(`  LEAP_STEALTH        = ${process.env.LEAP_STEALTH ?? "(default: true)"}`);
  console.log(`  LEAP_HUMANIZE       = ${process.env.LEAP_HUMANIZE ?? "(default: false)"}`);
  console.log(`  LEAP_LOG_LEVEL      = ${process.env.LEAP_LOG_LEVEL ?? "(default: info)"}`);
  console.log(`  LEAP_HEADED         = ${process.env.LEAP_HEADED ?? "(default: false)"}`);
  console.log(`  LEAP_EXTENSIONS     = ${process.env.LEAP_EXTENSIONS ?? "(none)"}`);
  console.log(`  LEAP_PROFILES_DIR   = ${process.env.LEAP_PROFILES_DIR ?? "(default: ~/.leapfrog/chrome-profiles)"}`);
  console.log(`  LEAP_ALLOW_EXECUTE  = ${process.env.LEAP_ALLOW_EXECUTE ?? "(default: true)"}`);
  console.log(`  LEAP_CDP_ENDPOINT   = ${process.env.LEAP_CDP_ENDPOINT ?? "(none)"}`);
  console.log();

  const failed = checks.some((c) => c.status === "fail");
  process.exit(failed ? 1 : 0);
}

function printHelp(): void {
  console.log(`Leapfrog — Multi-session browser MCP for AI agents

Usage: npx leapfrog [options]

Options:
  --doctor    Run diagnostics and verify installation
  --config    Print MCP configuration JSON
  --help, -h  Show this help message

Environment Variables:
  LEAP_MAX_SESSIONS    Max concurrent sessions (default: 15)
  LEAP_HEADLESS        Run headless (default: true)
  LEAP_STEALTH         Enable stealth mode (default: true)
  LEAP_HUMANIZE        Enable humanization (default: false)
  LEAP_IDLE_TIMEOUT    Session idle timeout in ms (default: 1800000)
  LEAP_LOG_LEVEL       Log level: debug|info|warn|error (default: info)
  LEAP_CHANNEL         Browser channel: chromium|chrome (default: chromium)
  LEAP_ALLOW_JS        Allow JS evaluation (default: true)

Documentation: https://github.com/anthonybono21-cloud/leapfrog`);
  process.exit(0);
}

function printConfig(): void {
  const config = {
    leapfrog: {
      command: "npx",
      args: ["-y", "leapfrog"],
      env: {
        LEAP_MAX_SESSIONS: "15",
      },
    },
  };
  console.log("\nPaste this into your ~/.mcp.json:\n");
  console.log(JSON.stringify(config, null, 2));
  console.log();
  process.exit(0);
}

function printVersion(): void {
  console.log(pkg.version);
  process.exit(0);
}

// ─── Startup ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    printVersion();
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  if (args.includes("--config")) {
    printConfig();
    return;
  }

  if (args.includes("--doctor")) {
    await runDoctor();
    return;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Leapfrog MCP server running (max ${MAX_SESSIONS} sessions, headless=${HEADLESS})`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  await sessions.destroyAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await sessions.destroyAll();
  process.exit(0);
});
