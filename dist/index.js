#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SessionManager } from "./session-manager.js";
import { checkSSRF } from "./ssrf.js";
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
import { isHumanizeEnabled, gaussianClickOffset } from "./humanize-utils.js";
import { ScriptExecutor } from "./script-executor.js";
import { SnapshotDiffer } from "./snapshot-differ.js";
import { ApiIntelligence } from "./api-intelligence.js";
import { PageClassifier } from "./page-classifier.js";
import { HarnessIntelligence, formatHarnessOutput } from "./harness-intelligence.js";
import { adaptiveNavigate, formatAdaptiveResult } from "./adaptive-wait.js";
import { runStealthAudit } from "./stealth-audit.js";
import { exportSession, replayRecording } from "./recording.js";
import { paginate } from "./paginate.js";
import { getHUDInitScript, getHUDUpdateScript, getClickRippleScript, getMoveCursorScript } from "./session-hud.js";
import { getDetectionInitScript, getDetectionCheckScript, getOverlayScript, getDismissScript, getResolutionCheckScript, parseDetectionResult, getPressAndHoldDetectScript, solvePressAndHold } from "./intervention.js";
import { SidecarServer } from "./sidecar.js";
import { chime, alert as notifyAlert } from "./notify.js";
import { getConsentDismissScript, getCacheSelectorScript, getTermsAutoCheckScript } from "./consent-dismiss.js";
import { solveCaptcha, isCaptchaSolverEnabled } from "./captcha-solver.js";
import { domainKnowledge, normalizeDomain } from "./domain-knowledge.js";
import { TilesCoordinator } from "./tiles-coordinator.js";
const require = createRequire(import.meta.url);
const pkg = require("../package.json");
// ─── Config ─────────────────────────────────────────────────────────────────
const MAX_SESSIONS = Number(process.env.LEAP_MAX_SESSIONS ?? 15);
// BUG-001: Default to 30 min; allow LEAP_IDLE_TIMEOUT=0 to disable sweep entirely
const IDLE_TIMEOUT_MS = Number(process.env.LEAP_IDLE_TIMEOUT ?? 30 * 60 * 1000);
if (!Number.isFinite(MAX_SESSIONS) || MAX_SESSIONS < 1)
    throw new Error("Invalid LEAP_MAX_SESSIONS");
if (!Number.isFinite(IDLE_TIMEOUT_MS) || IDLE_TIMEOUT_MS < 0)
    throw new Error("Invalid LEAP_IDLE_TIMEOUT");
const HEADLESS = process.env.LEAP_HEADLESS !== "false";
const CHANNEL = process.env.LEAP_CHANNEL || undefined; // "chrome" to use installed Chrome
const MAX_SNAPSHOT_CHARS = 10000;
const ALLOW_JS = process.env.LEAP_ALLOW_JS !== "false";
const ALLOW_EXECUTE = process.env.LEAP_ALLOW_EXECUTE !== "false";
const LEAP_PROFILES_DIR = process.env.LEAP_PROFILES_DIR ?? path.join(os.homedir(), ".leapfrog", "chrome-profiles");
const LEAP_TILE = process.env.LEAP_TILE;
const LEAP_TILE_PADDING = Number(process.env.LEAP_TILE_PADDING ?? 8);
const LEAP_MULTI_TILE = process.env.LEAP_MULTI_TILE === "true";
const LEAP_HUD = process.env.LEAP_HUD === "true";
const LEAP_AUTO_CONSENT = process.env.LEAP_AUTO_CONSENT !== "false"; // default ON
const LEAP_TRACE = process.env.LEAP_TRACE === "true";
const LEAP_RECORD = process.env.LEAP_RECORD === "true";
const LEAP_SIDECAR_PORT = Number(process.env.LEAP_SIDECAR_PORT ?? 9222);
const sessions = new SessionManager({
    maxSessions: MAX_SESSIONS,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    headless: HEADLESS,
    channel: CHANNEL,
});
// Configure window tiling (opt-in via LEAP_TILE env var)
import { tileManager, TileManager } from "./tile-manager.js";
if (LEAP_TILE && LEAP_TILE !== "false") {
    tileManager.configure({
        layout: LEAP_TILE === "master" ? "master" : "grid",
        padding: Number.isFinite(LEAP_TILE_PADDING) ? LEAP_TILE_PADDING : 8,
    });
}
// Multi-terminal tile coordinator — active whenever tiling is on.
// Uses file-based coordination so multiple Leapfrog instances share the screen.
// Zero cost for single-terminal (just tracks one instance). No extra env var needed.
let tilesCoord = null;
if (LEAP_TILE && LEAP_TILE !== "false") {
    // Screen size is detected lazily by tileManager; use defaults until then.
    // The coordinator will be fully initialized once the first session detects screen size.
    tilesCoord = new TilesCoordinator(1920, 1080);
    tilesCoord.watch((state) => {
        // When another instance changes the grid, reflow our own windows
        // using global slot count + indices so all instances share one grid.
        if (tileManager.isEnabled()) {
            const sessionMap = new Map();
            for (const si of sessions.listSessions()) {
                const sess = sessions.getSession(si.id);
                if (sess)
                    sessionMap.set(si.id, sess);
            }
            const slotIndex = new Map();
            state.slots.forEach((slot, idx) => slotIndex.set(slot.sessionId, idx));
            logger.info("tile.watcher_reflow", { globalTotal: state.slots.length, local: sessionMap.size });
            tileManager.reflowAll(sessionMap, {
                globalTotal: state.slots.length,
                slotIndex,
            }).catch((e) => logger.warn("tile.watcher_reflow_failed", { error: e?.message }));
        }
    });
}
/** Build multi-tile context from coordinator, or undefined if not in multi-tile mode. */
async function getMultiTileContext() {
    if (!tilesCoord)
        return undefined;
    const state = await tilesCoord.getLayout();
    const slotIndex = new Map();
    state.slots.forEach((slot, idx) => slotIndex.set(slot.sessionId, idx));
    return { globalTotal: state.slots.length, slotIndex };
}
/** Reflow all local windows, using global grid state when multi-tile is active. */
async function reflowWithContext() {
    if (!tileManager.isEnabled())
        return;
    const sessionMap = new Map();
    for (const si of sessions.listSessions()) {
        const sess = sessions.getSession(si.id);
        if (sess)
            sessionMap.set(si.id, sess);
    }
    const ctx = await getMultiTileContext();
    await tileManager.reflowAll(sessionMap, ctx);
}
const snapEngine = new SnapshotEngine();
// Hook API intelligence into network response listener
networkIntelligence.onResponse((session, url, method, status, headers, body, duration, resourceType, requestHeaders, requestBody) => {
    ApiIntelligence.capture(session, url, method, status, headers, body, duration, resourceType, requestHeaders, requestBody);
});
// ─── Helpers ────────────────────────────────────────────────────────────────
function ok(text) {
    return { content: [{ type: "text", text }] };
}
function err(msg) {
    return { content: [{ type: "text", text: msg }], isError: true };
}
function requireSession(sessionId) {
    const s = sessions.getSession(sessionId) ?? sessions.findByName(sessionId);
    if (!s)
        throw new Error(`Session "${sessionId}" not found. Use session_list to see active sessions.`);
    sessions.touchSession(s.id);
    return s;
}
function getPage(session) {
    return tabManager.getActivePage(session);
}
async function snapAndFormat(session, opts) {
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
    try {
        title = await page.title();
    }
    catch { /* */ }
    return `[${session.id}] ${title}\n${url}\n${result.nodeCount} elements\n\n${result.text}`;
}
const PROFILE_DIR = path.join(os.homedir(), ".leapfrog", "profiles");
// ─── SSRF Protection ───────────────────────────────────────────────────────
// Moved to src/ssrf.ts — imported as { checkSSRF, checkSSRFSync }
// ─── Server ─────────────────────────────────────────────────────────────────
const server = new McpServer({ name: "leapfrog", version: pkg.version }, { capabilities: { tools: {} } });
// ─── session_create ─────────────────────────────────────────────────────────
server.registerTool("session_create", {
    title: "Create Browser Session",
    description: "Create a new isolated browser session with its own cookies and state. " +
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
        pinned: z
            .boolean()
            .optional()
            .describe("Pin this session to prevent idle timeout cleanup."),
    }).strict(),
}, async ({ profilePath, viewport, userAgent, locale, timezoneId, geolocation, permissions, colorScheme, acceptDownloads, stealth, proxy, profile, headed, extensions, cdp, clientId, pinned }) => {
    try {
        // Validate profilePath stays within the profiles directory
        if (profilePath) {
            const resolved = path.resolve(profilePath);
            if (!resolved.startsWith(path.resolve(PROFILE_DIR))) {
                return err(`profilePath must be within ${PROFILE_DIR}`);
            }
            try {
                await fs.access(resolved);
            }
            catch {
                return err(`Profile not found: ${resolved}`);
            }
        }
        const session = await sessions.createSession({
            profilePath, viewport, userAgent,
            locale, timezoneId, geolocation, permissions, colorScheme, acceptDownloads, stealth, proxy,
            profile, headed, extensions, cdp, clientId,
        });
        if (pinned) {
            session.pinned = true;
        }
        // ── v0.6.0 init script injection ──────────────────────────────────
        // Inject on context so they apply to all tabs/navigations
        if (LEAP_HUD) {
            await session.context.addInitScript(getHUDInitScript(session.name ?? session.id));
        }
        if (LEAP_AUTO_CONSENT) {
            await session.context.addInitScript(getConsentDismissScript());
        }
        // Always inject intervention detection (lightweight MutationObserver)
        await session.context.addInitScript(getDetectionInitScript());
        // Start tracing if enabled
        if (LEAP_TRACE) {
            await session.context.tracing.start({ screenshots: true, snapshots: true });
        }
        // Multi-terminal tiling: claim a slot for this session
        if (tilesCoord) {
            await tilesCoord.claimSlot(session.id).catch(() => { });
        }
        // Reflow + raise all tiled windows after creating a new session
        await reflowWithContext().catch(() => { });
        const stats = sessions.getStats();
        return ok(`Session created: ${session.id}${pinned ? " (pinned)" : ""}\n` +
            `Pool: ${stats.active}/${stats.maxSessions} active`);
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── session_list ───────────────────────────────────────────────────────────
server.registerTool("session_list", {
    title: "List Browser Sessions",
    description: "List all active browser sessions with their URLs and idle times.",
    inputSchema: z.object({}).strict(),
}, async () => {
    const list = sessions.listSessions();
    const stats = sessions.getStats();
    if (list.length === 0) {
        return ok(`No active sessions. (${stats.totalCreated} total created)`);
    }
    const now = Date.now();
    const lines = list.map((s) => {
        const idle = Math.round((now - s.lastUsedAt) / 1000);
        const pin = s.pinned ? " *" : "";
        return `${s.id} [${s.name || "unnamed"}]${pin}  ${s.url || "(blank)"}  idle ${idle}s`;
    });
    return ok(`${stats.active}/${stats.maxSessions} sessions\n\n` +
        lines.join("\n"));
});
// ─── session_destroy ────────────────────────────────────────────────────────
server.registerTool("session_destroy", {
    title: "Destroy Browser Session",
    description: "Close and clean up a browser session. Frees a pool slot.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID to destroy."),
    }).strict(),
}, async ({ sessionId }) => {
    // Flush domain knowledge for this session's domains
    domainKnowledge.flush().catch(() => { });
    // Stop tracing and save if enabled
    if (LEAP_TRACE) {
        try {
            const s = sessions.getSession(sessionId);
            if (s) {
                const tracePath = path.join(os.tmpdir(), `leapfrog-trace-${sessionId}.zip`);
                await s.context.tracing.stop({ path: tracePath });
                logger.info("tracing.saved", { sessionId, path: tracePath });
            }
        }
        catch { /* tracing stop is non-fatal */ }
    }
    // Multi-terminal tiling: release the slot
    if (tilesCoord) {
        await tilesCoord.releaseSlot(sessionId).catch(() => { });
    }
    // Clean up module-level state for the session
    SnapshotDiffer.clearSession(sessionId);
    ApiIntelligence.clearSession(sessionId);
    HarnessIntelligence.clearSession(sessionId);
    await sessions.destroySession(sessionId);
    // Reflow remaining windows to fill the gap
    await reflowWithContext().catch(() => { });
    const stats = sessions.getStats();
    return ok(`Destroyed ${sessionId}. Pool: ${stats.active}/${stats.maxSessions}`);
});
// ─── session_save_profile ───────────────────────────────────────────────────
server.registerTool("session_save_profile", {
    title: "Save Session Profile",
    description: "Save a session's cookies and auth state to disk. " +
        "Use this after logging in to a site so future sessions can restore that login. " +
        "Pass the returned profile path to session_create's profilePath to reuse it.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID to save."),
        name: z.string().describe("Profile name (e.g. 'google', 'github'). Overwrites if exists."),
    }).strict(),
}, async ({ sessionId, name }) => {
    try {
        // Sanitize profile name — alphanumeric, dash, underscore only
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
        if (!safeName)
            return err("Invalid profile name. Use alphanumeric, dash, or underscore characters.");
        const session = requireSession(sessionId);
        await fs.mkdir(PROFILE_DIR, { recursive: true, mode: 0o700 });
        const filepath = path.resolve(PROFILE_DIR, `${safeName}.json`);
        if (!filepath.startsWith(path.resolve(PROFILE_DIR))) {
            return err("Invalid profile path.");
        }
        const state = await session.context.storageState();
        await fs.writeFile(filepath, JSON.stringify(state, null, 2), { mode: 0o600 });
        return ok(`Profile saved: ${filepath}\nUse with session_create profilePath="${filepath}"`);
    }
    catch (e) {
        return err(`Save failed: ${e.message}`);
    }
});
// ─── session_list_profiles ──────────────────────────────────────────────────
server.registerTool("session_list_profiles", {
    title: "List Saved Profiles",
    description: "List all saved authentication profiles.",
    inputSchema: z.object({}).strict(),
}, async () => {
    try {
        await fs.mkdir(PROFILE_DIR, { recursive: true });
        const files = await fs.readdir(PROFILE_DIR);
        const profiles = files.filter((f) => f.endsWith(".json"));
        if (profiles.length === 0)
            return ok("No saved profiles.");
        const lines = profiles.map((f) => {
            const name = f.replace(".json", "");
            return `${name}  →  ${path.join(PROFILE_DIR, f)}`;
        });
        return ok(lines.join("\n"));
    }
    catch (e) {
        return err(`List failed: ${e.message}`);
    }
});
// ─── Auto-Challenge Solver ──────────────────────────────────────────────────
const CHALLENGE_BUTTON_PATTERNS = /^(continue|continue shopping|i'm not a robot|accept|verify|i am human|submit|proceed)$/i;
async function attemptChallengeResolve(page, session, confidence) {
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
                    try {
                        title = await page.title();
                    }
                    catch { /* */ }
                    const reClass = PageClassifier.classify({ url, snapshotText: reSnap.text });
                    if (reClass.type !== 'challenge') {
                        return `[CHALLENGE RESOLVED] Auto-clicked challenge button. Page is now accessible.\n\n[${session.id}] ${title}\n${url}\n${reSnap.nodeCount} elements\n\n${reSnap.text}\n\n[page: ${reClass.type} (${Math.round(reClass.confidence * 100)}%)]`;
                    }
                    // Still a challenge after clicking
                    return `[CHALLENGE] Bot challenge detected (${Math.round(confidence * 100)}%). Auto-clicked button but challenge persists. Manual intervention may be required.\n\n[${session.id}] ${title}\n${url}\n${reSnap.nodeCount} elements\n\n${reSnap.text}`;
                }
            }
            catch { /* skip individual button errors */ }
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
                try {
                    title = await page.title();
                }
                catch { /* */ }
                const reClass = PageClassifier.classify({ url, snapshotText: reSnap.text });
                if (reClass.type !== 'challenge') {
                    return `[CHALLENGE RESOLVED] Auto-clicked challenge checkbox. Page is now accessible.\n\n[${session.id}] ${title}\n${url}\n${reSnap.nodeCount} elements\n\n${reSnap.text}\n\n[page: ${reClass.type} (${Math.round(reClass.confidence * 100)}%)]`;
                }
                return `[CHALLENGE] Bot challenge detected (${Math.round(confidence * 100)}%). Auto-clicked checkbox but challenge persists. Manual intervention may be required.\n\n[${session.id}] ${title}\n${url}\n${reSnap.nodeCount} elements\n\n${reSnap.text}`;
            }
        }
        catch { /* checkbox not found or not visible */ }
        // Strategy 3: No simple action found
        // Return null to let the caller output the normal page with classification
        return null;
    }
    catch {
        return null;
    }
}
// ─── navigate ───────────────────────────────────────────────────────────────
server.registerTool("navigate", {
    title: "Navigate & Snapshot",
    description: "Navigate to a URL and return a compact accessibility snapshot with @eN refs. " +
        "Refs like @e1, @e2 can be passed directly to the 'act' tool — no CSS selectors needed. " +
        "Snapshots are ~200-500 tokens (vs 15,000 with Playwright MCP).",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        url: z.string().describe("Full URL including https://"),
        waitUntil: z
            .enum(["load", "domcontentloaded", "networkidle"])
            .default("load")
            .describe("Wait strategy. Use networkidle for SPAs."),
        autoRetry: z
            .boolean()
            .default(true)
            .describe("Auto-retry with stealth escalation when blocked. Default: true."),
        maxRetryLevel: z
            .number()
            .int()
            .min(0)
            .max(5)
            .default(3)
            .describe("Max escalation level (0-5). Level 3+ rotates session. Default: 3."),
    }).strict(),
}, async ({ sessionId, url, waitUntil, autoRetry, maxRetryLevel }) => {
    try {
        // Block dangerous URL schemes
        let parsed;
        try {
            parsed = new URL(url);
        }
        catch {
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
        if (LEAP_HUD) {
            await page.evaluate(getHUDUpdateScript("loading")).catch(() => { });
        }
        // Bump nav generation — any refs from before this navigation are now stale
        // (navGeneration check in act handler prevents using stale refs)
        // Don't clear refMap — historical refs needed for session_export resolution
        session.staleRefThreshold = session.refCounter; // refs with numbers <= this are from a previous page
        session.navGeneration = (session.navGeneration ?? 0) + 1;
        // Reset API captures for the new page
        ApiIntelligence.clearSession(sessionId);
        // Pre-load domain knowledge for adaptive behavior (self-improvement loop)
        const urlDomain = normalizeDomain(parsed.hostname);
        const hints = await domainKnowledge.getNavigationHints(urlDomain).catch(() => ({}));
        // Apply learned wait strategy if the user didn't explicitly override
        // The schema default is "load", so we check if hints suggest something better
        let effectiveWaitUntil = waitUntil;
        if (hints.waitUntil && waitUntil === "load") {
            effectiveWaitUntil = hints.waitUntil;
        }
        // Reset zoom in case a previous zoom-to-target was interrupted by navigation
        await page.evaluate(() => { document.body.style.zoom = '1'; }).catch(() => { });
        // Apply learned stealth tier — domains that blocked before start at higher escalation
        let effectiveMaxRetryLevel = maxRetryLevel;
        if (hints.stealthTier && hints.stealthTier > 0) {
            effectiveMaxRetryLevel = Math.max(maxRetryLevel, hints.stealthTier + 1);
        }
        // Adaptive navigate with wait strategy selection + stealth escalation
        const result = await adaptiveNavigate(page, session, url, sessions, {
            waitUntil: effectiveWaitUntil,
            autoRetry,
            maxRetryLevel: effectiveMaxRetryLevel,
        });
        // P0-2: Post-navigation SSRF check — catch 302 redirects to internal IPs
        try {
            const finalParsed = new URL(result.url);
            if (finalParsed.hostname !== parsed.hostname) {
                const redirectBlock = await checkSSRF(finalParsed.hostname);
                if (redirectBlock) {
                    logger.warn("security.ssrf_redirect_blocked", { url, finalUrl: result.url, hostname: finalParsed.hostname });
                    await result.page.goto("about:blank");
                    return err(`Redirect blocked: ${url} redirected to ${result.url} — ${redirectBlock}`);
                }
            }
        }
        catch { /* final URL parse error is non-fatal */ }
        // Update ref nav generation on the final session
        result.session.refNavGeneration = result.session.navGeneration ?? 0;
        // Auto-name session from first navigation domain
        if (!result.session.name) {
            try {
                const domain = new URL(result.url).hostname;
                result.session.name = domain;
                result.session.domain = domain;
            }
            catch { /* URL parse error is non-fatal */ }
        }
        // Record navigation in domain knowledge (closes the self-improvement loop)
        const navDuration = Date.now() - startTime;
        domainKnowledge.recordNavigation(urlDomain, effectiveWaitUntil, navDuration);
        // Record block event — feeds stealth tier escalation on revisit
        if (result.quality === "BLOCKED" || result.classification.type === "challenge") {
            const reason = result.classification.type === "challenge"
                ? `challenge:${result.classification.signals?.join(",") ?? "unknown"}`
                : `blocked:${result.escalation?.label ?? "initial"}`;
            domainKnowledge.recordBlock(urlDomain, reason);
        }
        // Auto-dismiss known consent selector from domain knowledge
        if (hints.consentSelector) {
            try {
                // Pre-seed browser cache so injected dismiss script skips detection
                await result.page.evaluate(getCacheSelectorScript(urlDomain, hints.consentSelector)).catch(() => { });
                await result.page.click(hints.consentSelector, { timeout: 2000 });
                logger.debug("domain-knowledge:consent-auto-dismissed", { domain: urlDomain, selector: hints.consentSelector });
            }
            catch { /* consent selector not found or not visible — that's fine */ }
        }
        // Read back consent dismiss result from browser and persist for future visits
        // The injected dismiss script waits 1.5s after DOMContentLoaded, so we wait 2.5s
        // to give it time to find and click the banner before reading back.
        // The browser-side script uses window.location.hostname (includes www.),
        // so we check both normalized and raw hostname keys.
        if (LEAP_AUTO_CONSENT && !hints.consentSelector) {
            setTimeout(async () => {
                try {
                    const consentResult = await result.page.evaluate(() => {
                        const cache = window.__leapfrog_consent_cache;
                        if (!cache)
                            return null;
                        // Return the first cached selector found (keyed by hostname)
                        const keys = Object.keys(cache);
                        return keys.length > 0 ? cache[keys[0]] : null;
                    });
                    if (consentResult) {
                        domainKnowledge.recordConsent(urlDomain, consentResult);
                        logger.debug("domain-knowledge:consent-recorded", { domain: urlDomain, selector: consentResult });
                    }
                }
                catch { /* consent recording is best-effort — page may have navigated away */ }
            }, 2500);
        }
        // Raise tiled windows after navigation
        if (tileManager.isEnabled()) {
            const sessionMap = new Map();
            for (const si of sessions.listSessions()) {
                const sess = sessions.getSession(si.id);
                if (sess)
                    sessionMap.set(si.id, sess);
            }
            await tileManager.raiseAllWindows(sessionMap).catch(() => { });
        }
        // Update HUD to active
        if (LEAP_HUD) {
            await result.page.evaluate(getHUDUpdateScript("active")).catch(() => { });
        }
        // Check for intervention needs (captcha, login, challenge)
        try {
            // Check for PerimeterX "Press & Hold" challenge first (solvable without API)
            const pxRaw = await result.page.evaluate(getPressAndHoldDetectScript());
            if (pxRaw?.detected && pxRaw.bounds) {
                logger.info("intervention.press-and-hold", { sessionId, bounds: pxRaw.bounds });
                const solved = await solvePressAndHold(result.page, pxRaw.bounds);
                if (solved) {
                    logger.info("intervention.press-and-hold:solved", { sessionId });
                    domainKnowledge.recordBlock(urlDomain, "press-and-hold:solved");
                }
                else {
                    logger.warn("intervention.press-and-hold:failed", { sessionId });
                }
            }
            const interventionRaw = await result.page.evaluate(getDetectionCheckScript());
            let intervention = parseDetectionResult(interventionRaw);
            if (intervention) {
                // ── Try to self-resolve before alerting the user ─────────────
                // Attempt reCAPTCHA checkbox click, Cloudflare verify button, etc.
                // Only show the overlay if all self-resolution attempts fail.
                let selfResolved = false;
                if (intervention.type === 'captcha' || intervention.type === 'challenge') {
                    logger.info("intervention.auto-attempt", { sessionId, type: intervention.type });
                    // Attempt 1: Click reCAPTCHA "I'm not a robot" checkbox
                    try {
                        const recaptchaFrame = result.page.frameLocator('iframe[src*="recaptcha"]');
                        await recaptchaFrame.locator('#recaptcha-anchor').click({ timeout: 2000 });
                        await new Promise(r => setTimeout(r, 3000));
                        // Re-check if it resolved
                        const recheck1 = parseDetectionResult(await result.page.evaluate(getDetectionCheckScript()));
                        if (!recheck1) {
                            selfResolved = true;
                            logger.info("intervention.auto-resolved", { sessionId, method: "recaptcha-checkbox" });
                        }
                    }
                    catch { /* reCAPTCHA frame not found or click failed — continue */ }
                    // Attempt 2: Click Cloudflare challenge verify button
                    if (!selfResolved) {
                        try {
                            const cfFrame = result.page.frameLocator('iframe[src*="challenges.cloudflare"]');
                            await cfFrame.locator('input[type="checkbox"], label').first().click({ timeout: 2000 });
                            await new Promise(r => setTimeout(r, 3000));
                            const recheck2 = parseDetectionResult(await result.page.evaluate(getDetectionCheckScript()));
                            if (!recheck2) {
                                selfResolved = true;
                                logger.info("intervention.auto-resolved", { sessionId, method: "cloudflare-checkbox" });
                            }
                        }
                        catch { /* Cloudflare frame not found — continue */ }
                    }
                    // Attempt 3: Click any generic "verify" or "continue" button on the page
                    if (!selfResolved) {
                        try {
                            await result.page.evaluate(() => {
                                const buttons = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
                                for (const btn of buttons) {
                                    const text = (btn.textContent || '').toLowerCase().trim();
                                    if (/^(verify|continue|i.m human|i am human|proceed|submit)$/i.test(text)) {
                                        btn.click();
                                        return true;
                                    }
                                }
                                return false;
                            });
                            await new Promise(r => setTimeout(r, 3000));
                            const recheck3 = parseDetectionResult(await result.page.evaluate(getDetectionCheckScript()));
                            if (!recheck3) {
                                selfResolved = true;
                                logger.info("intervention.auto-resolved", { sessionId, method: "verify-button" });
                            }
                        }
                        catch { /* button click failed — continue */ }
                    }
                    // Record self-resolution in domain knowledge
                    if (selfResolved) {
                        domainKnowledge.recordBlock(urlDomain, `challenge:auto-resolved`);
                    }
                }
                // ── Try CAPTCHA solver API if configured ─────────────────────
                if (!selfResolved && intervention.type === 'captcha' && isCaptchaSolverEnabled()) {
                    logger.info("intervention.captcha-auto-solve", { sessionId, reason: intervention.reason });
                    const solveResult = await solveCaptcha(result.page, 'captcha', intervention.elementSelector);
                    if (solveResult.solved) {
                        selfResolved = true;
                        logger.info("intervention.captcha-solved", {
                            sessionId, provider: solveResult.provider, timeMs: solveResult.solveTimeMs,
                        });
                        domainKnowledge.recordBlock(urlDomain, `captcha:auto-solved:${solveResult.provider}`);
                    }
                    else {
                        logger.warn("intervention.captcha-solve-failed", {
                            sessionId, error: solveResult.error,
                        });
                    }
                }
                // ── Only alert the user if all self-resolution failed ────────
                if (!selfResolved) {
                    // Re-check one final time (challenge may have resolved during our attempts)
                    intervention = parseDetectionResult(await result.page.evaluate(getDetectionCheckScript()));
                    if (intervention) {
                        await result.page.evaluate(getOverlayScript(intervention.reason));
                        if (LEAP_HUD) {
                            await result.page.evaluate(getHUDUpdateScript("waiting")).catch(() => { });
                        }
                        chime();
                        notifyAlert("Leapfrog", `Human needed: ${intervention.reason}`);
                        logger.info("intervention.detected", { sessionId, type: intervention.type, reason: intervention.reason });
                    }
                }
            }
        }
        catch { /* intervention check is non-fatal */ }
        // Auto-challenge solver — try button/checkbox click on challenge pages
        if (result.classification.type === 'challenge' && result.quality !== "BLOCKED") {
            const challengeResult = await attemptChallengeResolve(result.page, result.session, result.classification.confidence);
            if (challengeResult) {
                const duration = Date.now() - startTime;
                HarnessIntelligence.recordToolCall(result.session.id, 'navigate', { url }, `Navigated to ${url} (challenge resolved)`, duration);
                return ok(challengeResult);
            }
        }
        const duration = Date.now() - startTime;
        const output = formatAdaptiveResult(result);
        HarnessIntelligence.recordToolCall(result.session.id, 'navigate', { url }, `Navigated to ${url} (${result.snapshot.nodeCount} elements${result.escalation ? `, escalation L${result.escalation.level}` : ''})`, duration);
        return ok(output);
    }
    catch (e) {
        if (LEAP_HUD) {
            try {
                const s = sessions.getSession(sessionId);
                if (s) {
                    const p = getPage(s);
                    await p.evaluate(getHUDUpdateScript("error")).catch(() => { });
                }
            }
            catch { /* best effort */ }
        }
        return err(`Navigate failed: ${e.message}`);
    }
});
// ─── snapshot ───────────────────────────────────────────────────────────────
server.registerTool("snapshot", {
    title: "Page Snapshot",
    description: "Re-snapshot the current page for fresh @eN refs. " +
        "Use after 'act' when you need to re-orient, or scope to a region with 'selector'. " +
        "Use 'selector' to dramatically reduce tokens (e.g. 'form', '#results').",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        selector: z.string().optional().describe("CSS selector to scope snapshot to a page region."),
        maxChars: z.number().int().default(MAX_SNAPSHOT_CHARS).describe("Max output chars."),
    }).strict(),
}, async ({ sessionId, selector, maxChars }) => {
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
        try {
            title = await page.title();
        }
        catch { /* */ }
        let output = `[${session.id}] ${title}\n${url}\n${snapResult.nodeCount} elements\n\n${snapResult.text}`;
        // Incremental diff: compare with previous snapshot
        const diff = SnapshotDiffer.diff(session.id, url, snapResult);
        if (!diff.isFirst && diff.changeCount >= 0) {
            output += `\n\n${diff.diffText}`;
        }
        // Page classification
        try {
            let meta;
            try {
                meta = await page.evaluate(() => {
                    const og = document.querySelector('meta[property="og:type"]')?.getAttribute("content") ?? undefined;
                    const desc = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? undefined;
                    const robots = document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? undefined;
                    let jsonLdType;
                    const ld = document.querySelector('script[type="application/ld+json"]');
                    if (ld) {
                        try {
                            const parsed = JSON.parse(ld.textContent ?? "");
                            jsonLdType = parsed["@type"];
                        }
                        catch { /* */ }
                    }
                    return { ogType: og, jsonLdType, robots, description: desc };
                });
            }
            catch { /* meta extraction is best-effort */ }
            const classification = PageClassifier.classify({
                url,
                snapshotText: snapResult.text,
                meta,
            });
            output += `\n\n[page: ${classification.type} (${Math.round(classification.confidence * 100)}%)]`;
        }
        catch { /* classification is best-effort */ }
        const duration = Date.now() - startTime;
        HarnessIntelligence.recordToolCall(sessionId, 'snapshot', { selector }, `Snapshot: ${snapResult.nodeCount} elements`, duration);
        return ok(output);
    }
    catch (e) {
        return err(`Snapshot failed: ${e.message}`);
    }
});
// ─── diff ──────────────────────────────────────────────────────────────────
server.registerTool("diff", {
    title: "Snapshot Diff",
    description: "Compare the current page state against the last snapshot for this session. " +
        "Returns only what changed (additions, removals, changes) — massive token savings vs a full re-snapshot. " +
        "Use after 'act' instead of 'snapshot' when you just need to see what changed. " +
        "On first call (no previous snapshot), returns the full snapshot with a note. " +
        "Use 'selector' to scope the diff to a page region.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        selector: z.string().optional().describe("CSS selector to scope snapshot to a page region."),
    }).strict(),
}, async ({ sessionId, selector }) => {
    try {
        const startTime = Date.now();
        const session = requireSession(sessionId);
        const page = getPage(session);
        // Take a fresh snapshot
        const snapResult = await snapEngine.snapshot(page, session, {
            interactiveOnly: true,
            maxChars: MAX_SNAPSHOT_CHARS,
            selector,
        });
        // Mark refs as fresh — they match the current nav generation
        session.refNavGeneration = session.navGeneration ?? 0;
        const url = page.url();
        let title = "";
        try {
            title = await page.title();
        }
        catch { /* */ }
        // Compare against previous snapshot
        const diff = SnapshotDiffer.diff(session.id, url, snapResult);
        let output;
        if (diff.isFirst) {
            // No previous snapshot — return the full snapshot with a note
            output =
                `[${session.id}] ${title}\n${url}\n${snapResult.nodeCount} elements\n` +
                    `[first snapshot — no previous state to diff against, returning full snapshot]\n\n` +
                    snapResult.text;
        }
        else {
            output =
                `[${session.id}] ${title}\n${url}\n` +
                    `${diff.diffText}\n` +
                    `[diff: ${diff.diffTokenEstimate} tokens vs full: ${diff.fullTokenEstimate} tokens — ${diff.fullTokenEstimate > 0 ? Math.round((1 - diff.diffTokenEstimate / diff.fullTokenEstimate) * 100) : 0}% saved]`;
        }
        const duration = Date.now() - startTime;
        HarnessIntelligence.recordToolCall(sessionId, 'diff', { selector }, `Diff: ${diff.changeCount} changes (first: ${diff.isFirst})`, duration);
        return ok(output);
    }
    catch (e) {
        return err(`Diff failed: ${e.message}`);
    }
});
// ─── act ────────────────────────────────────────────────────────────────────
server.registerTool("act", {
    title: "Browser Action",
    description: "Perform a browser interaction: click, fill, type, check, select, press key, scroll, hover, mousemove, drag, upload, resize, back, forward. " +
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
}, async ({ sessionId, action, target, value, key, scrollDirection, scrollAmount, typeDelay, x, y, target2, filePaths, width, height, holdDuration }) => {
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
        }
        catch { /* pre-state capture is best-effort */ }
        finally {
            // P0-1: Always restore refs so act's resolve() can still find them
            session.refMap = savedRefMap;
            session.refCounter = savedRefCounter;
            session.refNavGeneration = savedRefNavGen;
        }
        // Resolve target to a Playwright locator (with stale-ref detection)
        const resolve = (ref) => {
            if (ref.startsWith("@e")) {
                // Generation-level guard: catches if navigate happened with no subsequent snapshot
                if ((session.navGeneration ?? 0) > (session.refNavGeneration ?? 0)) {
                    throw new Error(`Ref ${ref} is stale — the page has navigated since the last snapshot. Take a new snapshot to get updated refs.`);
                }
                // Per-ref guard: catches refs from a previous page even when navigate auto-snapshots.
                // staleRefThreshold records the refCounter at the time of the last navigation.
                // Refs with numbers <= threshold were created on a prior page and may resolve
                // to wrong elements on the current page.
                if (session.staleRefThreshold != null) {
                    const refNum = parseInt(ref.slice(2), 10);
                    if (!isNaN(refNum) && refNum <= session.staleRefThreshold) {
                        throw new Error(`Stale ref ${ref} from previous page. Take a fresh snapshot.`);
                    }
                }
                const selector = session.refMap.get(ref);
                if (!selector)
                    throw new Error(`Ref ${ref} not found. Take a fresh snapshot.`);
                return page.locator(selector);
            }
            return page.locator(ref); // CSS selectors don't go stale
        };
        switch (action) {
            case "click":
            case "dblclick":
            case "hover": {
                if (!target)
                    return err(`'${action}' requires a target`);
                const loc = resolve(target);
                // Zoom-to-target: "follow the agent's eyes" — zoom in, highlight, hold, zoom out
                // Uses Playwright locator (not querySelector) since refMap stores Playwright selectors
                if ((action === "click" || action === "dblclick") && target) {
                    try {
                        await loc.scrollIntoViewIfNeeded();
                        const box = await loc.boundingBox();
                        if (box) {
                            // Zoom in via page coordinates
                            await page.evaluate(({ x, y, w, h }) => {
                                const el = document.elementFromPoint(x + w / 2, y + h / 2);
                                document.body.style.zoom = '1.15';
                                if (el) {
                                    el.scrollIntoView({ block: 'center' });
                                    el.style.outline = '2px solid #22c55e';
                                    el.style.outlineOffset = '3px';
                                }
                            }, { x: box.x, y: box.y, w: box.width, h: box.height });
                            await page.waitForTimeout(800);
                            // Zoom out and clean up — wrapped separately so navigation doesn't leave zoom stuck
                            await page.evaluate(() => {
                                document.body.style.zoom = '1';
                                document.querySelectorAll('[style*="outline: 2px solid"]').forEach(e => {
                                    e.style.outline = '';
                                    e.style.outlineOffset = '';
                                    e.style.backgroundColor = '';
                                });
                            }).catch(() => { }); // page may have navigated — that's fine, new page starts at zoom=1
                            // Re-scroll at normal zoom so the click lands correctly
                            await loc.scrollIntoViewIfNeeded().catch(() => { });
                            await page.waitForTimeout(150);
                        }
                    }
                    catch { /* zoom-to-target is non-fatal */ }
                }
                // HUD: animate agent cursor + click ripple
                if (LEAP_HUD && (action === "click" || action === "dblclick")) {
                    try {
                        const box = await loc.boundingBox();
                        if (box) {
                            const cx = box.x + box.width / 2;
                            const cy = box.y + box.height / 2;
                            await page.evaluate(getMoveCursorScript(cx, cy));
                            await page.evaluate(getClickRippleScript(cx, cy));
                        }
                    }
                    catch { /* HUD animation is non-fatal */ }
                }
                if (action === "click") {
                    await thinkPause.beforeAction("click");
                    if (holdDuration) {
                        // Long-press: mouse down, wait, mouse up
                        try {
                            const box = await loc.boundingBox({ timeout: 5000 });
                            if (!box) {
                                throw new Error(`Element not found or not visible for target '${target}' — cannot perform long-press. Verify the selector or take a fresh snapshot.`);
                            }
                            const lpX = gaussianClickOffset(box.x + box.width / 2, box.width, box.x);
                            const lpY = gaussianClickOffset(box.y + box.height / 2, box.height, box.y);
                            await page.mouse.move(lpX, lpY);
                            await page.mouse.down();
                            await page.waitForTimeout(holdDuration);
                            await page.mouse.up();
                        }
                        catch (e) {
                            throw new Error(`holdDuration click failed on '${target}': ${e.message}`);
                        }
                    }
                    else if (isHumanizeEnabled()) {
                        // Humanized click: Bezier move to target center, dwell, then click
                        const box = await loc.boundingBox();
                        if (box) {
                            const cx = gaussianClickOffset(box.x + box.width / 2, box.width, box.x);
                            const cy = gaussianClickOffset(box.y + box.height / 2, box.height, box.y);
                            await humanMouse.humanClick(page, cx, cy);
                        }
                        else {
                            await loc.click();
                        }
                    }
                    else {
                        // Non-humanized click: still apply Gaussian offset to avoid dead-center bot fingerprint
                        const box = await loc.boundingBox();
                        if (box) {
                            const cx = gaussianClickOffset(box.x + box.width / 2, box.width, box.x);
                            const cy = gaussianClickOffset(box.y + box.height / 2, box.height, box.y);
                            await page.mouse.click(cx, cy);
                        }
                        else {
                            await loc.click();
                        }
                    }
                }
                else if (action === "dblclick") {
                    await thinkPause.beforeAction("click");
                    await loc.dblclick();
                }
                else {
                    // hover
                    await thinkPause.beforeAction("click");
                    if (isHumanizeEnabled()) {
                        const box = await loc.boundingBox();
                        if (box) {
                            const cx = gaussianClickOffset(box.x + box.width / 2, box.width, box.x);
                            const cy = gaussianClickOffset(box.y + box.height / 2, box.height, box.y);
                            await humanMouse.moveTo(page, cx, cy);
                        }
                        else {
                            await loc.hover();
                        }
                    }
                    else {
                        const box = await loc.boundingBox();
                        if (box) {
                            const cx = gaussianClickOffset(box.x + box.width / 2, box.width, box.x);
                            const cy = gaussianClickOffset(box.y + box.height / 2, box.height, box.y);
                            await page.mouse.move(cx, cy);
                        }
                        else {
                            await loc.hover();
                        }
                    }
                }
                break;
            }
            case "fill": {
                if (!target || value === undefined)
                    return err("'fill' requires target and value");
                await thinkPause.beforeAction("type");
                await resolve(target).fill(value);
                // Auto-check terms/privacy checkboxes when filling forms (signup flow)
                try {
                    const termsResult = await page.evaluate(getTermsAutoCheckScript());
                    if (termsResult.checked > 0) {
                        logger.debug("terms.auto-checked", { count: termsResult.checked, selectors: termsResult.selectors });
                    }
                }
                catch { /* terms check is best-effort */ }
                break;
            }
            case "type": {
                if (!target || value === undefined)
                    return err("'type' requires target and value");
                await thinkPause.beforeAction("type");
                if (isHumanizeEnabled()) {
                    // Focus the element first, then use humanized keystroke timing
                    await resolve(target).click();
                    await humanTyping.typeText(page, value);
                }
                else {
                    const typeOpts = {};
                    if (typeDelay !== undefined)
                        typeOpts.delay = typeDelay;
                    await resolve(target).pressSequentially(value, typeOpts);
                }
                break;
            }
            case "check":
            case "uncheck": {
                if (!target)
                    return err(`'${action}' requires a target`);
                await thinkPause.beforeAction("click");
                if (action === "check")
                    await resolve(target).check();
                else
                    await resolve(target).uncheck();
                break;
            }
            case "select": {
                if (!target || value === undefined)
                    return err("'select' requires target and value");
                await thinkPause.beforeAction("click");
                await resolve(target).selectOption(value);
                break;
            }
            case "press": {
                if (!key)
                    return err("'press' requires a key");
                await page.keyboard.press(key);
                break;
            }
            case "scroll": {
                await thinkPause.beforeAction("scroll");
                if (target) {
                    await resolve(target).scrollIntoViewIfNeeded();
                }
                else {
                    const dir = scrollDirection ?? "down";
                    const px = scrollAmount ?? 300;
                    if (isHumanizeEnabled()) {
                        // Humanized momentum scroll
                        const deltaY = dir === "down" ? px : dir === "up" ? -px : 0;
                        const deltaX = dir === "right" ? px : dir === "left" ? -px : 0;
                        if (deltaY !== 0) {
                            await humanScroll.scroll(page, deltaY);
                        }
                        else if (deltaX !== 0) {
                            // Horizontal scroll — humanScroll handles vertical only, fall back to wheel
                            await page.mouse.wheel(deltaX, 0);
                        }
                    }
                    else {
                        const deltaX = dir === "right" ? px : dir === "left" ? -px : 0;
                        const deltaY = dir === "down" ? px : dir === "up" ? -px : 0;
                        await page.mouse.wheel(deltaX, deltaY);
                    }
                }
                break;
            }
            case "mousemove": {
                if (x === undefined || y === undefined)
                    return err("'mousemove' requires x and y coordinates");
                if (isHumanizeEnabled()) {
                    await humanMouse.moveTo(page, x, y);
                }
                else {
                    await page.mouse.move(x, y);
                }
                break;
            }
            case "drag": {
                if (!target)
                    return err("'drag' requires a target (source element)");
                if (!target2)
                    return err("'drag' requires target2 (drop destination)");
                const source = resolve(target);
                const dest = resolve(target2);
                await source.dragTo(dest);
                break;
            }
            case "upload": {
                if (!target)
                    return err("'upload' requires a target (file input element)");
                if (!filePaths)
                    return err("'upload' requires filePaths");
                const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
                await resolve(target).setInputFiles(paths);
                break;
            }
            case "resize": {
                if (width === undefined || height === undefined)
                    return err("'resize' requires width and height");
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
        // ── Post-action intervention detection ─────────────────────────
        // When a click/submit triggers a CAPTCHA or challenge, try to
        // self-resolve before returning to the agent. This catches the
        // "form fill works, submit triggers CAPTCHA" pattern.
        if (action === "click" || action === "dblclick") {
            try {
                // Brief wait for CAPTCHA/challenge to appear after submit
                await new Promise(r => setTimeout(r, 1000));
                // Check for PerimeterX press-and-hold
                const pxCheck = await page.evaluate(getPressAndHoldDetectScript());
                if (pxCheck?.detected && pxCheck.bounds) {
                    logger.info("act.press-and-hold-detected", { sessionId });
                    const solved = await solvePressAndHold(page, pxCheck.bounds);
                    if (solved)
                        logger.info("act.press-and-hold-solved", { sessionId });
                }
                // Check for CAPTCHA/challenge
                const postIntervention = parseDetectionResult(await page.evaluate(getDetectionCheckScript()));
                if (postIntervention) {
                    let actResolved = false;
                    // Try reCAPTCHA checkbox click
                    if (!actResolved) {
                        try {
                            const rcFrame = page.frameLocator('iframe[src*="recaptcha"]');
                            await rcFrame.locator('#recaptcha-anchor').click({ timeout: 2000 });
                            await new Promise(r => setTimeout(r, 3000));
                            if (!parseDetectionResult(await page.evaluate(getDetectionCheckScript()))) {
                                actResolved = true;
                                logger.info("act.captcha-auto-resolved", { sessionId, method: "recaptcha-checkbox" });
                            }
                        }
                        catch { /* no reCAPTCHA frame */ }
                    }
                    // Try Cloudflare challenge checkbox
                    if (!actResolved) {
                        try {
                            const cfFrame = page.frameLocator('iframe[src*="challenges.cloudflare"]');
                            await cfFrame.locator('input[type="checkbox"], label').first().click({ timeout: 2000 });
                            await new Promise(r => setTimeout(r, 5000)); // Cloudflare JS challenges take time
                            if (!parseDetectionResult(await page.evaluate(getDetectionCheckScript()))) {
                                actResolved = true;
                                logger.info("act.captcha-auto-resolved", { sessionId, method: "cloudflare" });
                            }
                        }
                        catch { /* no Cloudflare frame */ }
                    }
                    // Try generic verify/continue buttons
                    if (!actResolved) {
                        try {
                            const clicked = await page.evaluate(() => {
                                const btns = document.querySelectorAll('button, input[type="submit"], a[role="button"]');
                                for (const btn of btns) {
                                    const text = (btn.textContent || '').toLowerCase().trim();
                                    if (/^(verify|continue|i.m human|i am human|proceed)$/i.test(text)) {
                                        btn.click();
                                        return true;
                                    }
                                }
                                return false;
                            });
                            if (clicked) {
                                await new Promise(r => setTimeout(r, 3000));
                                if (!parseDetectionResult(await page.evaluate(getDetectionCheckScript()))) {
                                    actResolved = true;
                                    logger.info("act.captcha-auto-resolved", { sessionId, method: "verify-button" });
                                }
                            }
                        }
                        catch { /* button click failed */ }
                    }
                    // Try CAPTCHA solver API
                    if (!actResolved && postIntervention.type === 'captcha' && isCaptchaSolverEnabled()) {
                        const solveResult = await solveCaptcha(page, 'captcha', postIntervention.elementSelector);
                        if (solveResult.solved) {
                            actResolved = true;
                            logger.info("act.captcha-api-solved", { sessionId, provider: solveResult.provider });
                        }
                    }
                    // Only alert if all attempts failed
                    if (!actResolved) {
                        // Final recheck
                        const finalCheck = parseDetectionResult(await page.evaluate(getDetectionCheckScript()));
                        if (finalCheck) {
                            // Detect "check your email" / verification pages — report differently
                            const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 500).toLowerCase());
                            const isEmailVerification = /check your email|verification code|verify your|confirm your email|sent.*code|enter.*code/.test(bodyText);
                            if (isEmailVerification) {
                                logger.info("act.email-verification-detected", { sessionId });
                                // Don't show overlay for email verification — it's not a block, it's a step
                            }
                            else {
                                await page.evaluate(getOverlayScript(finalCheck.reason));
                                if (LEAP_HUD) {
                                    await page.evaluate(getHUDUpdateScript("waiting")).catch(() => { });
                                }
                                chime();
                                notifyAlert("Leapfrog", `Human needed: ${finalCheck.reason}`);
                            }
                        }
                    }
                }
            }
            catch { /* post-action intervention is best-effort */ }
        }
        // Detect email verification pages (even without CAPTCHA)
        let emailVerificationNote = "";
        if (action === "click" || action === "dblclick") {
            try {
                const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 500).toLowerCase());
                if (/check your email|verification code|verify your email|confirm your email|we sent.*code|enter.*code|magic link/.test(bodyText)) {
                    emailVerificationNote = "\n\n[PENDING_VERIFICATION] This page is asking for email verification. Check the inbox for a code or link.";
                }
            }
            catch { /* best effort */ }
        }
        // If the URL changed, return a full snapshot of the new page
        const urlAfter = page.url();
        // Harness Intelligence: analyze post-action state
        let harnessOutput = "";
        try {
            const postSnap = await snapEngine.snapshot(page, session, { interactiveOnly: true, maxChars: MAX_SNAPSHOT_CHARS });
            const harnessState = HarnessIntelligence.analyzePostAction(session.id, action, target, value, urlAfter, postSnap.text);
            // Only append harness output if there's something noteworthy
            if (harnessState.outcome !== "SUCCESS" || harnessState.loopWarning || harnessState.stuckWarning) {
                harnessOutput = "\n\n" + formatHarnessOutput(harnessState);
            }
        }
        catch { /* harness analysis is best-effort */ }
        // P0-3: Record act tool call in session memory
        const actDuration = Date.now() - startTime;
        HarnessIntelligence.recordToolCall(sessionId, 'act', { action, target, value }, `${action}${target ? ` ${target}` : ''}`, actDuration);
        if (urlAfter !== urlBefore) {
            try {
                await page.waitForLoadState("load", { timeout: 5000 });
            }
            catch { /* timeout ok */ }
            const text = await snapAndFormat(session);
            return ok(`[navigated → ${urlAfter}]\n\n${text}${harnessOutput}${emailVerificationNote}`);
        }
        // Same page — brief confirmation
        return ok(`Done: ${action}${target ? ` ${target}` : ""}${value ? ` "${value}"` : ""}${harnessOutput}${emailVerificationNote}`);
    }
    catch (e) {
        return err(`Action failed: ${e.message}`);
    }
});
// ─── screenshot ─────────────────────────────────────────────────────────────
server.registerTool("screenshot", {
    title: "Screenshot",
    description: "Capture a screenshot of the current page. Returns the image inline as base64. Optionally save to disk with savePath.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        fullPage: z.boolean().default(false).describe("Capture full scrollable page."),
        selector: z.string().optional().describe("CSS selector to capture a specific element."),
        savePath: z.string().optional().describe("Optional file path to save the screenshot to disk. If omitted, image is returned inline only."),
    }).strict(),
}, async ({ sessionId, fullPage, selector, savePath }) => {
    try {
        const startTime = Date.now(); // P0-3
        const session = requireSession(sessionId);
        const page = getPage(session);
        let imageBuffer;
        if (selector) {
            imageBuffer = await page.locator(selector).screenshot();
        }
        else {
            imageBuffer = await page.screenshot({ fullPage });
        }
        const content = [];
        if (savePath) {
            await fs.mkdir(path.dirname(savePath), { recursive: true });
            await fs.writeFile(savePath, imageBuffer);
            content.push({ type: "text", text: `Saved: ${savePath}` });
        }
        content.push({ type: "image", data: imageBuffer.toString("base64"), mimeType: "image/png" });
        // P0-3: Record screenshot tool call in session memory
        const duration = Date.now() - startTime;
        HarnessIntelligence.recordToolCall(sessionId, 'screenshot', { fullPage, selector, savePath }, `Screenshot captured${savePath ? ` → ${savePath}` : ''}`, duration);
        return { content };
    }
    catch (e) {
        return err(`Screenshot failed: ${e.message}`);
    }
});
// ─── extract ────────────────────────────────────────────────────────────────
server.registerTool("extract", {
    title: "Extract Data",
    description: "Extract data from the page without a full snapshot. " +
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
}, async ({ sessionId, type, target, js, maxChars }) => {
    try {
        const startTime = Date.now(); // P0-3
        const session = requireSession(sessionId);
        const page = getPage(session);
        let result;
        const resolve = (ref) => {
            if (ref.startsWith("@e")) {
                if ((session.navGeneration ?? 0) > (session.refNavGeneration ?? 0)) {
                    throw new Error(`Ref ${ref} is stale — the page has navigated since the last snapshot. Take a new snapshot to get updated refs.`);
                }
                if (session.staleRefThreshold != null) {
                    const refNum = parseInt(ref.slice(2), 10);
                    if (!isNaN(refNum) && refNum <= session.staleRefThreshold) {
                        throw new Error(`Stale ref ${ref} from previous page. Take a fresh snapshot.`);
                    }
                }
                const sel = session.refMap.get(ref);
                if (!sel)
                    throw new Error(`Ref ${ref} not found.`);
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
                if (!js)
                    return err("type='js' requires a js expression.");
                if (!ALLOW_JS)
                    return err("JavaScript evaluation is disabled. Set LEAP_ALLOW_JS=true to enable.");
                let val;
                try {
                    val = await Promise.race([
                        page.evaluate(js),
                        new Promise((_, reject) => setTimeout(() => reject(new Error("JS evaluation timed out (10s)")), 10000)),
                    ]);
                }
                catch (evalErr) {
                    return err(`JS eval failed: ${evalErr.message}`);
                }
                if (val === undefined || val === null) {
                    result = String(val);
                }
                else {
                    result = typeof val === "string" ? val : JSON.stringify(val, null, 2);
                }
                break;
            }
            case "text": {
                if (target) {
                    const el = resolve(target);
                    result = await el.evaluate((node) => {
                        const clone = node.cloneNode(true);
                        clone.querySelectorAll('script, style, noscript, template, [hidden], [aria-hidden="true"]').forEach(e => e.remove());
                        return clone.innerText?.trim() ?? clone.textContent?.trim() ?? "";
                    });
                }
                else {
                    result = await page.evaluate(() => {
                        const clone = document.body.cloneNode(true);
                        clone.querySelectorAll('script, style, noscript, template, [hidden], [aria-hidden="true"]').forEach(e => e.remove());
                        return clone.innerText?.trim() ?? "";
                    });
                }
                break;
            }
            case "html": {
                if (target) {
                    result = await resolve(target).innerHTML();
                }
                else {
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
    }
    catch (e) {
        return err(`Extract failed: ${e.message}`);
    }
});
// ─── pool_status ────────────────────────────────────────────────────────────
server.registerTool("pool_status", {
    title: "Pool Status & Resources",
    description: "Show pool stats, resource usage (memory, uptime), and all active session summaries. Shows per-session idle time. Sessions approaching 30-minute idle timeout should be refreshed or saved.",
    inputSchema: z.object({}).strict(),
}, async () => {
    const stats = sessions.getStats();
    const resources = sessions.getResourceUsage();
    const list = sessions.listSessions();
    // ASCII capacity bar
    const barWidth = 15;
    const filled = Math.round((stats.active / stats.maxSessions) * barWidth);
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(barWidth - filled);
    const lines = [
        `Pool: [${bar}] ${stats.active}/${stats.maxSessions}`,
        `Memory: ${resources.heapUsedMB}MB heap / ${resources.rssMB}MB RSS`,
        `Uptime: ${resources.uptimeSeconds}s  (${stats.totalCreated} total created)`,
    ];
    if (tileManager.isEnabled()) {
        const screen = tileManager.getScreenSize();
        const grid = TileManager.calculateGrid(list.length || 1);
        lines.push(`Tiling: ${tileManager.getLayout()} (${grid.cols}x${grid.rows}) on ${screen?.width ?? "?"}x${screen?.height ?? "?"}`);
    }
    if (list.length > 0) {
        lines.push("");
        const now = Date.now();
        const idleTimeoutSec = IDLE_TIMEOUT_MS / 1000;
        for (const s of list) {
            const idle = Math.round((now - s.lastUsedAt) / 1000);
            const pin = s.pinned ? " *" : "";
            const warn = !s.pinned && idleTimeoutSec > 0 && idle > idleTimeoutSec * 0.8
                ? "  \u26A0 approaching timeout"
                : "";
            lines.push(`${s.id} [${s.name || "unnamed"}]${pin}  idle ${idle}s${warn}`);
        }
    }
    return ok(lines.join("\n"));
});
// ─── network_log ───────────────────────────────────────────────────────────
server.registerTool("network_log", {
    title: "Network Log",
    description: "View captured HTTP requests/responses for a session. " +
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
}, async ({ sessionId, urlPattern, method, statusMin, statusMax, contentType }) => {
    try {
        const session = requireSession(sessionId);
        const text = networkIntelligence.getNetworkLog(session, {
            urlPattern, method, statusMin, statusMax, contentType,
        });
        return ok(text);
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── console_log ──────────────────────────────────────────────────────────
server.registerTool("console_log", {
    title: "Console Log",
    description: "View captured browser console messages (log, warn, error, info, debug). " +
        "Console capture starts automatically when a session is created. " +
        "Use level filter to focus on errors or warnings.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        level: z.string().optional().describe("Filter by level: error, warn, log, info, debug."),
    }).strict(),
}, async ({ sessionId, level }) => {
    try {
        const session = requireSession(sessionId);
        const text = networkIntelligence.getConsoleLog(session, { level });
        return ok(text);
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── network_intercept ────────────────────────────────────────────────────
server.registerTool("network_intercept", {
    title: "Network Intercept",
    description: "Add or remove network intercept rules. " +
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
}, async ({ sessionId, action, ruleId, urlPattern, mockStatus, mockBody, mockContentType }) => {
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
        if (!urlPattern)
            return err("urlPattern is required for block/log/mock actions.");
        const rule = {
            id: ruleId,
            urlPattern,
            action: action,
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
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── wait_for ─────────────────────────────────────────────────────────────
server.registerTool("wait_for", {
    title: "Smart Wait",
    description: "Wait for a condition before proceeding. " +
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
}, async ({ sessionId, condition, target, text, js, timeout }) => {
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
    }
    catch (e) {
        return err(`Wait failed: ${e.message}`);
    }
});
// ─── tabs_list ────────────────────────────────────────────────────────────
server.registerTool("tabs_list", {
    title: "List Tabs",
    description: "List all open tabs in a session. Shows index, URL, title, and which tab is active. " +
        "New tabs (popups, OAuth windows) are automatically tracked.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
    }).strict(),
}, async ({ sessionId }) => {
    try {
        const session = requireSession(sessionId);
        const tabs = await tabManager.listTabs(session);
        if (tabs.length === 0)
            return ok("No open tabs.");
        const lines = tabs.map((t) => {
            const active = t.isActive ? " *active*" : "";
            return `[${t.index}]${active} ${t.url} "${t.title}"`;
        });
        return ok(lines.join("\n"));
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── tab_switch ───────────────────────────────────────────────────────────
server.registerTool("tab_switch", {
    title: "Switch Tab",
    description: "Switch to a different tab by index. Use -1 to switch to the most recently opened tab (useful for popups). " +
        "Returns a snapshot of the newly active tab.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        tabIndex: z.number().int().describe("Tab index to switch to. -1 for last (most recent) tab."),
    }).strict(),
}, async ({ sessionId, tabIndex }) => {
    try {
        const startTime = Date.now();
        const session = requireSession(sessionId);
        tabManager.switchTab(session, tabIndex);
        const snap = await snapAndFormat(session);
        const duration = Date.now() - startTime;
        HarnessIntelligence.recordToolCall(sessionId, 'tab_switch', { tabIndex }, `Switched to tab ${tabIndex}`, duration);
        return ok(`Switched to tab ${tabIndex}\n\n${snap}`);
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── tab_close ────────────────────────────────────────────────────────────
server.registerTool("tab_close", {
    title: "Close Tab",
    description: "Close a tab by index. Defaults to the active tab. Cannot close the last remaining tab. " +
        "Returns a snapshot of the new active tab.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        tabIndex: z.number().int().optional().describe("Tab index to close. Omit to close the active tab."),
    }).strict(),
}, async ({ sessionId, tabIndex }) => {
    try {
        const startTime = Date.now();
        const session = requireSession(sessionId);
        await tabManager.closeTab(session, tabIndex);
        const snap = await snapAndFormat(session);
        const duration = Date.now() - startTime;
        HarnessIntelligence.recordToolCall(sessionId, 'tab_close', { tabIndex }, `Tab closed`, duration);
        return ok(`Tab closed.\n\n${snap}`);
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── session_health ───────────────────────────────────────────────────────
server.registerTool("session_health", {
    title: "Session Health Check",
    description: "Check if a session is healthy (browser connected, page responsive). " +
        "Omit sessionId to check all sessions. Quick diagnostic for debugging.",
    inputSchema: z.object({
        sessionId: z.string().optional().describe("Session ID. Omit to check all."),
    }).strict(),
}, async ({ sessionId }) => {
    try {
        if (sessionId) {
            const session = requireSession(sessionId);
            const result = await crashRecovery.healthCheck(session);
            return ok(`${sessionId}: ${result.healthy ? "healthy" : `unhealthy — ${result.reason}`}`);
        }
        // Check all sessions
        const allSessions = sessions.getSessions();
        if (allSessions.size === 0)
            return ok("No active sessions.");
        const results = await crashRecovery.healthCheckAll(allSessions);
        const lines = [];
        for (const [id, result] of results) {
            lines.push(`${id}: ${result.healthy ? "healthy" : `unhealthy — ${result.reason}`}`);
        }
        return ok(lines.join("\n"));
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── add_init_script ─────────────────────────────────────────────────────
server.registerTool("add_init_script", {
    title: "Add Init Script",
    description: "Inject JavaScript that runs before every page load in a session. " +
        "Persists across navigations (Playwright built-in behavior). " +
        "Use for fingerprint overrides, custom stealth patches, or page instrumentation.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        script: z.string().describe("JavaScript code to inject. Runs in page context before any page scripts."),
    }).strict(),
}, async ({ sessionId, script }) => {
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
    }
    catch (e) {
        return err(`addInitScript failed: ${e.message}`);
    }
});
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
server.registerTool("batch_actions", {
    title: "Batch Actions",
    description: "Execute multiple browser actions sequentially in a single MCP call. " +
        "Eliminates round-trip overhead for humanization sequences (e.g. Bezier mouse paths, typed text with delays). " +
        "Each action can have an optional delayAfter (ms) to pause between steps. " +
        "Returns a single result with the outcome of each action.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        actions: z.array(BatchActionSchema).min(1).max(100).describe("Array of actions to execute sequentially."),
    }).strict(),
}, async ({ sessionId, actions }) => {
    try {
        const startTime = Date.now();
        const session = requireSession(sessionId);
        const page = getPage(session);
        const results = [];
        const resolve = (ref) => {
            if (ref.startsWith("@e")) {
                if ((session.navGeneration ?? 0) > (session.refNavGeneration ?? 0)) {
                    throw new Error(`Ref ${ref} is stale — the page has navigated since the last snapshot. Take a new snapshot to get updated refs.`);
                }
                if (session.staleRefThreshold != null) {
                    const refNum = parseInt(ref.slice(2), 10);
                    if (!isNaN(refNum) && refNum <= session.staleRefThreshold) {
                        throw new Error(`Stale ref ${ref} from previous page. Take a fresh snapshot.`);
                    }
                }
                const selector = session.refMap.get(ref);
                if (!selector)
                    throw new Error(`Ref ${ref} not found. Take a fresh snapshot.`);
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
                        if (!a.target)
                            throw new Error(`'${a.action}' requires a target`);
                        const loc = resolve(a.target);
                        if (a.action === "dblclick")
                            await loc.dblclick();
                        else if (a.action === "hover")
                            await loc.hover();
                        else
                            await loc.click();
                        break;
                    }
                    case "fill": {
                        if (!a.target || a.value === undefined)
                            throw new Error("'fill' requires target and value");
                        await resolve(a.target).fill(a.value);
                        break;
                    }
                    case "type": {
                        if (!a.target || a.value === undefined)
                            throw new Error("'type' requires target and value");
                        const opts = {};
                        if (a.typeDelay !== undefined)
                            opts.delay = a.typeDelay;
                        await resolve(a.target).pressSequentially(a.value, opts);
                        break;
                    }
                    case "check":
                    case "uncheck": {
                        if (!a.target)
                            throw new Error(`'${a.action}' requires a target`);
                        if (a.action === "check")
                            await resolve(a.target).check();
                        else
                            await resolve(a.target).uncheck();
                        break;
                    }
                    case "select": {
                        if (!a.target || a.value === undefined)
                            throw new Error("'select' requires target and value");
                        await resolve(a.target).selectOption(a.value);
                        break;
                    }
                    case "press": {
                        if (!a.key)
                            throw new Error("'press' requires a key");
                        await page.keyboard.press(a.key);
                        break;
                    }
                    case "scroll": {
                        if (a.target) {
                            await resolve(a.target).scrollIntoViewIfNeeded();
                        }
                        else {
                            const dir = a.scrollDirection ?? "down";
                            const px = a.scrollAmount ?? 300;
                            const deltaX = dir === "right" ? px : dir === "left" ? -px : 0;
                            const deltaY = dir === "down" ? px : dir === "up" ? -px : 0;
                            await page.mouse.wheel(deltaX, deltaY);
                        }
                        break;
                    }
                    case "mousemove": {
                        if (a.x === undefined || a.y === undefined)
                            throw new Error("'mousemove' requires x and y");
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
            }
            catch (actionErr) {
                results.push(`[${i}] ${a.action}: FAILED — ${actionErr.message}`);
                // Stop batch on first failure to avoid cascading errors
                break;
            }
            // Optional delay between actions
            if (a.delayAfter && a.delayAfter > 0) {
                await new Promise((r) => setTimeout(r, Math.min(a.delayAfter, 10000)));
            }
        }
        const duration = Date.now() - startTime;
        HarnessIntelligence.recordToolCall(sessionId, 'batch_actions', { actionCount: actions.length }, `${results.length}/${actions.length} actions completed`, duration);
        return ok(`Batch complete (${results.length}/${actions.length} actions)\n\n${results.join("\n")}`);
    }
    catch (e) {
        return err(`Batch failed: ${e.message}`);
    }
});
// ─── execute ──────────────────────────────────────────────────────────────
server.registerTool("execute", {
    title: "Execute Script",
    description: "Run a Playwright script in a sandboxed environment. One tool call replaces 5-20 sequential MCP round trips. " +
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
}, async ({ sessionId, script, timeout }) => {
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
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── api_discover ─────────────────────────────────────────────────────────
server.registerTool("api_discover", {
    title: "Discover Page APIs",
    description: "List JSON APIs the page has called. Captured automatically from XHR/fetch traffic. " +
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
}, async ({ sessionId, category, minConfidence }) => {
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
            lines.push(`[${cap.index}] ${cap.method} ${cap.status} ${cap.url} (${cap.category} ${Math.round(cap.confidence * 100)}%)${gql}${shape}`);
        }
        return ok(lines.join("\n"));
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── api_export ───────────────────────────────────────────────────────────
server.registerTool("api_export", {
    title: "Export OpenAPI Spec",
    description: "Generate an OpenAPI v3 spec from observed API traffic. " +
        "Navigate pages first to capture traffic, then export.",
    inputSchema: z.object({
        sessionId: z.string(),
        title: z.string().optional().describe("API spec title."),
        includeTracking: z
            .boolean()
            .optional()
            .describe("Include tracking/analytics endpoints. Default: false."),
    }).strict(),
}, async ({ sessionId, title, includeTracking }) => {
    try {
        requireSession(sessionId);
        const spec = ApiIntelligence.exportOpenApi(sessionId, { title, includeTracking });
        const pathCount = Object.keys(spec.paths).length;
        if (pathCount === 0) {
            return ok("No API endpoints captured. Navigate to pages first to capture traffic.");
        }
        return ok(`OpenAPI spec (${pathCount} endpoints):\n\n${JSON.stringify(spec, null, 2)}`);
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── session_memory ───────────────────────────────────────────────────────
server.registerTool("session_memory", {
    title: "Session Action History",
    description: "Recall what actions were performed in this session. " +
        "Useful after context window compression to recover lost context.",
    inputSchema: z.object({
        sessionId: z.string(),
        limit: z
            .number()
            .optional()
            .describe("Number of recent actions to return. Default: 20."),
    }).strict(),
}, async ({ sessionId, limit }) => {
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
            ];
            // Include tool params so context recovery knows WHAT was done
            if (rec.toolCall) {
                const p = rec.toolCall.params;
                const paramStr = Object.entries(p)
                    .filter(([, v]) => v !== undefined && v !== null && v !== "")
                    .map(([k, v]) => `${k}=${typeof v === "string" && v.length > 60 ? v.slice(0, 60) + "…" : v}`)
                    .join(", ");
                if (paramStr)
                    parts.push(`{${paramStr}}`);
                if (rec.toolCall.resultSummary)
                    parts.push(`"${rec.toolCall.resultSummary}"`);
            }
            else {
                if (rec.url)
                    parts.push(rec.url);
            }
            return parts.filter(Boolean).join(" ");
        });
        return ok(`${history.length} action(s):\n\n${lines.join("\n")}`);
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── profile_list ─────────────────────────────────────────────────────────
server.registerTool("profile_list", {
    title: "List Auth Profiles",
    description: "List saved persistent browser profiles with their auth status.",
    inputSchema: z.object({}).strict(),
}, async () => {
    try {
        try {
            await fs.mkdir(LEAP_PROFILES_DIR, { recursive: true });
        }
        catch { /* */ }
        let entries = [];
        try {
            entries = await fs.readdir(LEAP_PROFILES_DIR);
        }
        catch {
            return ok("No profiles directory found.");
        }
        // Filter to directories only
        const profiles = [];
        for (const entry of entries) {
            try {
                const stat = await fs.stat(path.join(LEAP_PROFILES_DIR, entry));
                if (stat.isDirectory()) {
                    profiles.push(entry);
                }
            }
            catch { /* skip */ }
        }
        if (profiles.length === 0) {
            return ok("No saved profiles.");
        }
        const lines = profiles.map((name) => `${name}  →  ${path.join(LEAP_PROFILES_DIR, name)}`);
        return ok(lines.join("\n"));
    }
    catch (e) {
        return err(`List failed: ${e.message}`);
    }
});
// ─── profile_delete ───────────────────────────────────────────────────────
server.registerTool("profile_delete", {
    title: "Delete Auth Profile",
    description: "Delete a saved persistent browser profile and all its data.",
    inputSchema: z.object({
        name: z.string().describe("Profile name to delete."),
    }).strict(),
}, async ({ name }) => {
    try {
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
        if (!safeName)
            return err("Invalid profile name.");
        const profileDir = path.join(LEAP_PROFILES_DIR, safeName);
        const resolved = path.resolve(profileDir);
        if (!resolved.startsWith(path.resolve(LEAP_PROFILES_DIR))) {
            return err("Invalid profile path.");
        }
        try {
            await fs.access(profileDir);
        }
        catch {
            return err(`Profile not found: ${safeName}`);
        }
        await fs.rm(profileDir, { recursive: true, force: true });
        return ok(`Deleted profile: ${safeName}`);
    }
    catch (e) {
        return err(`Delete failed: ${e.message}`);
    }
});
// ─── paginate ────────────────────────────────────────────────────────────
server.registerTool("paginate", {
    title: "Pagination Extraction",
    description: "Extract data across multiple pages in a single call. Handles click-next, infinite scroll, and URL-pattern pagination. " +
        "Auto-detects 'next' buttons when nextSelector='auto'. Returns extracted content from each page plus metadata. " +
        "Replaces 3-4 tool calls per page with one invocation. Cap: 50 pages, 100K total chars.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        extractType: z.enum(["text", "html", "js"]).default("text").describe("What to extract from each page."),
        extractTarget: z.string().optional().describe("CSS selector to scope extraction to a specific container."),
        extractJs: z.string().optional().describe("JavaScript expression for extractType='js'."),
        nextSelector: z.string().default("auto").describe("CSS selector for the next button, or 'auto' to detect automatically."),
        paginationType: z.enum(["click", "scroll", "url"]).default("click").describe("Pagination strategy: click (next button), scroll (infinite scroll), url (URL pattern)."),
        urlPattern: z.string().optional().describe("URL pattern with {page} placeholder for paginationType='url'."),
        maxPages: z.number().int().min(1).max(50).default(10).describe("Maximum pages to extract. Default: 10."),
        delayMs: z.number().int().min(0).max(30000).default(1000).describe("Delay between pages in ms. Default: 1000."),
        maxCharsPerPage: z.number().int().min(100).max(50000).default(5000).describe("Max characters per page extraction. Default: 5000."),
        stopWhen: z.enum(["no_next", "empty", "duplicate", "auto"]).default("auto").describe("Stop condition. Default: auto (all heuristics)."),
    }).strict(),
}, async ({ sessionId, extractType, extractTarget, extractJs, nextSelector, paginationType, urlPattern, maxPages, delayMs, maxCharsPerPage, stopWhen }) => {
    try {
        // SSRF check: validate urlPattern before pagination navigates to it
        if (paginationType === "url" && urlPattern) {
            const sampleUrl = urlPattern.replace(/\{page\}/g, "1");
            try {
                const parsed = new URL(sampleUrl);
                if (!["http:", "https:"].includes(parsed.protocol)) {
                    return err(`Blocked URL scheme in urlPattern: ${parsed.protocol} — only http/https allowed.`);
                }
                const ssrfBlock = await checkSSRF(parsed.hostname);
                if (ssrfBlock) {
                    logger.warn("security.ssrf_paginate_blocked", { urlPattern, hostname: parsed.hostname });
                    return err(ssrfBlock);
                }
            }
            catch {
                return err(`Invalid URL in urlPattern: ${sampleUrl}`);
            }
        }
        const session = requireSession(sessionId);
        const page = getPage(session);
        const result = await paginate(page, session, {
            extractType, extractTarget, extractJs, nextSelector, paginationType, urlPattern, maxPages, delayMs, maxCharsPerPage, stopWhen,
        });
        const lines = [];
        lines.push(`Pagination complete: ${result.metadata.totalPages} pages, ${result.metadata.totalChars} chars`);
        lines.push(`Stopped: ${result.metadata.stoppedBecause} | Duration: ${result.metadata.duration}ms`);
        lines.push(`URLs: ${result.metadata.urls.join(", ")}`);
        lines.push("");
        for (const p of result.pages) {
            lines.push(`--- Page ${p.pageNum} (${p.url}) [~${p.tokens} tokens] ---`);
            lines.push(p.data);
            lines.push("");
        }
        return ok(lines.join("\n"));
    }
    catch (e) {
        return err(`Paginate failed: ${e.message}`);
    }
});
// ─── session_export ──────────────────────────────────────────────────────
server.registerTool("session_export", {
    title: "Export Session Recording",
    description: "Export session action history as a replayable recording. " +
        "Creates a JSON script from all mutating actions with @eN refs resolved to stable selectors. " +
        "Use format='playwright' to get a Playwright JS script compatible with the execute tool.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        name: z.string().optional().describe("Recording name. Default: auto-generated."),
        keepExtracts: z.boolean().optional().describe("Include extract steps in the recording. Default: false."),
        format: z.enum(["json", "playwright"]).optional().describe("Output format. Default: json."),
    }).strict(),
}, async ({ sessionId, name, keepExtracts, format }) => {
    try {
        const session = requireSession(sessionId);
        const result = exportSession(sessionId, session, { name, keepExtracts, format });
        if (typeof result === "string") {
            return ok(result);
        }
        const json = JSON.stringify(result, null, 2);
        const summary = `Recording "${result.name}": ${result.steps.length} steps, ${Object.keys(result.params).length} param(s)`;
        return ok(`${summary}\n\n${json}`);
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── session_replay ──────────────────────────────────────────────────────
server.registerTool("session_replay", {
    title: "Replay Session Recording",
    description: "Replay a recording in the current session. Executes each step directly against the browser. " +
        "Override {{placeholder}} params with the params object. Set onError='skip' to continue past failures.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        recording: z.string().describe("Recording JSON string (from session_export)."),
        params: z.record(z.string()).optional().describe("Parameter overrides for {{placeholder}} values."),
        onError: z.enum(["stop", "skip"]).optional().describe("Error handling: stop (default) or skip."),
    }).strict(),
}, async ({ sessionId, recording: recordingJson, params, onError }) => {
    try {
        const session = requireSession(sessionId);
        const page = getPage(session);
        let recording;
        try {
            recording = JSON.parse(recordingJson);
        }
        catch {
            return err("Invalid recording JSON. Pass the JSON output from session_export.");
        }
        if (recording.version !== 1) {
            return err(`Unsupported recording version: ${recording.version}. Expected 1.`);
        }
        const result = await replayRecording(recording, session, page, params, { onError });
        const lines = [
            `Replay "${recording.name}": ${result.status}`,
            `${result.stepsCompleted}/${result.stepsTotal} steps completed (${result.totalDuration}ms)`,
            "",
        ];
        for (const r of result.results) {
            const status = r.status === "ok" ? "OK" : "ERR";
            const errMsg = r.error ? ` — ${r.error}` : "";
            lines.push(`  [${r.step}] ${status} ${r.tool} (${r.duration}ms)${errMsg}`);
        }
        return ok(lines.join("\n"));
    }
    catch (e) {
        return err(e.message);
    }
});
// ─── wait_for_human ────────────────────────────────────────────────────────
server.registerTool("wait_for_human", {
    title: "Wait for Human",
    description: "Pause and request human intervention. Shows the @..@ overlay with your reason. " +
        "Use when you encounter a CAPTCHA, login wall, or any situation requiring human action. " +
        "The tool blocks until the user clicks 'Done' on the overlay. Returns success when resolved.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        reason: z.string().describe("Why human help is needed (e.g. 'CAPTCHA detected', 'Login required')."),
    }).strict(),
}, async ({ sessionId, reason }) => {
    try {
        const session = requireSession(sessionId);
        const page = getPage(session);
        // Show @..@ overlay
        await page.evaluate(getOverlayScript(reason));
        if (LEAP_HUD) {
            await page.evaluate(getHUDUpdateScript("waiting")).catch(() => { });
        }
        chime();
        notifyAlert("Leapfrog", `Human needed: ${reason}`);
        // Poll until user clicks Done (check every 500ms, max 5 minutes)
        const timeout = 5 * 60 * 1000;
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const resolved = await page.evaluate(getResolutionCheckScript()).catch(() => false);
            if (resolved) {
                if (LEAP_HUD) {
                    await page.evaluate(getHUDUpdateScript("active")).catch(() => { });
                }
                return ok(`Human intervention complete. Reason was: ${reason}`);
            }
            await new Promise(r => setTimeout(r, 500));
        }
        // Timeout — dismiss overlay
        await page.evaluate(getDismissScript()).catch(() => { });
        if (LEAP_HUD) {
            await page.evaluate(getHUDUpdateScript("active")).catch(() => { });
        }
        return err(`Timed out waiting for human intervention (5 min). Reason: ${reason}`);
    }
    catch (e) {
        return err(`wait_for_human failed: ${e.message}`);
    }
});
// ─── profile_warm ──────────────────────────────────────────────────────────
server.registerTool("profile_warm", {
    title: "Warm Browser Profile",
    description: "Warm up a browser profile by browsing trusted sites (Google, Wikipedia, YouTube). " +
        "Fresh profiles with zero history score near 0 on reCAPTCHA v3. A 60-90 second warm-up " +
        "dramatically improves trust scores. Stores warm-up state in domain knowledge so it doesn't repeat. " +
        "Must pass a sessionId of an existing session with a profile.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID (must be a profile-based session)."),
    }).strict(),
}, async ({ sessionId }) => {
    try {
        const session = requireSession(sessionId);
        if (!session.profileName) {
            return err("profile_warm requires a profile-based session. Create one with session_create profile='name'.");
        }
        // Check if already warmed
        const warmKey = `__warmed_${session.profileName}`;
        const existing = await domainKnowledge.inspect(warmKey);
        if (existing && existing.visitCount > 0) {
            return ok(`Profile "${session.profileName}" was already warmed (${existing.visitCount} warm visits). Skipping.`);
        }
        const page = getPage(session);
        const startTime = Date.now();
        const warmSteps = [
            { url: "https://www.google.com/search?q=weather+today", label: "Google Search" },
            { url: "https://en.wikipedia.org/wiki/Main_Page", label: "Wikipedia" },
            { url: "https://www.youtube.com/", label: "YouTube" },
        ];
        const results = [];
        for (const step of warmSteps) {
            try {
                await page.goto(step.url, { waitUntil: "domcontentloaded", timeout: 15000 });
                // Scroll down naturally
                await page.evaluate(() => {
                    window.scrollBy({ top: 400, behavior: 'smooth' });
                });
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
                // Click a random link (simulate browsing)
                const links = await page.$$('a[href^="http"]');
                if (links.length > 5) {
                    const randomLink = links[Math.floor(Math.random() * Math.min(links.length, 20))];
                    try {
                        await randomLink.click({ timeout: 3000 });
                        await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => { });
                        await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                        // Scroll the clicked page too
                        await page.evaluate(() => {
                            window.scrollBy({ top: 300, behavior: 'smooth' });
                        });
                        await new Promise(r => setTimeout(r, 1000));
                    }
                    catch { /* link click failed — continue */ }
                }
                // Accept cookie banners if present
                if (LEAP_AUTO_CONSENT) {
                    await page.evaluate(getConsentDismissScript()).catch(() => { });
                }
                results.push(`${step.label}: OK`);
            }
            catch (e) {
                results.push(`${step.label}: ${e.message.slice(0, 50)}`);
            }
        }
        const duration = Math.round((Date.now() - startTime) / 1000);
        // Record warm-up in domain knowledge so it won't repeat
        domainKnowledge.recordNavigation(warmKey, "warm", Date.now() - startTime);
        await domainKnowledge.flush();
        return ok(`Profile "${session.profileName}" warmed in ${duration}s:\n` +
            results.map(r => `  ${r}`).join("\n") +
            "\n\nreCAPTCHA v3 trust score should be significantly improved.");
    }
    catch (e) {
        return err(`profile_warm failed: ${e.message}`);
    }
});
// ─── profile_import_from_chrome ─────────────────────────────────────────────
server.registerTool("profile_import_from_chrome", {
    title: "Import Profile from Chrome",
    description: "Connect to your real Chrome browser via CDP, capture its auth cookies, and save them " +
        "as a Leapfrog profile. This gives you real Google auth, reCAPTCHA trust, and all your " +
        "logged-in sessions — but in an isolated Leapfrog session, not your real browser. " +
        "Start Chrome with: chrome --remote-debugging-port=9222",
    inputSchema: z.object({
        name: z.string().describe("Profile name to save as (e.g. 'google-auth', 'my-chrome')."),
        cdp: z.string().default("http://localhost:9222").describe("CDP endpoint. Default: http://localhost:9222"),
        domains: z.array(z.string()).optional().describe("Only capture cookies from these domains. Omit for all cookies."),
    }).strict(),
}, async ({ name, cdp, domains }) => {
    try {
        // Connect to real Chrome
        const tempSession = await sessions.createSession({ cdp, stealth: false });
        const ctx = tempSession.context;
        // Capture all cookies from the real browser
        let cookies = await ctx.cookies();
        // Filter to specific domains if requested
        if (domains && domains.length > 0) {
            cookies = cookies.filter(c => domains.some(d => c.domain.includes(d) || c.domain.endsWith(`.${d}`)));
        }
        // Save as a Leapfrog profile
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "");
        const profileDir = path.join(os.homedir(), ".leapfrog", "profiles");
        await fs.mkdir(profileDir, { recursive: true, mode: 0o700 });
        const profilePath = path.join(profileDir, `${safeName}.json`);
        await fs.writeFile(profilePath, JSON.stringify({ cookies, origins: [] }, null, 2), { mode: 0o600 });
        // Disconnect from real Chrome (don't close it)
        await sessions.destroySession(tempSession.id);
        return ok(`Imported ${cookies.length} cookies from Chrome → profile "${safeName}"\n` +
            `Saved to: ${profilePath}\n\n` +
            `Use with: session_create profile="${safeName}"\n` +
            `Your real Chrome is untouched — Leapfrog sessions will use a copy of these cookies.`);
    }
    catch (e) {
        return err(`Chrome import failed: ${e.message}\n\nMake sure Chrome is running with: chrome --remote-debugging-port=9222`);
    }
});
// ─── domain_knowledge ──────────────────────────────────────────────────────
server.registerTool("domain_knowledge", {
    title: "Domain Knowledge",
    description: "Inspect what Leapfrog has learned about a website from previous visits. " +
        "Shows stealth tier, wait strategy, block history, consent selector, API endpoints, and visit count. " +
        "Pass no domain to list all known domains.",
    inputSchema: z.object({
        domain: z.string().optional().describe("Domain to inspect (e.g. 'github.com'). Omit to list all."),
    }).strict(),
}, async ({ domain }) => {
    try {
        if (!domain) {
            const domains = domainKnowledge.listDomains();
            if (domains.length === 0)
                return ok("No domain knowledge yet. Visit some sites first.");
            const lines = domains.map(d => `${d.domain}  visits=${d.visitCount}  stealth=L${d.stealthTier}  last=${new Date(d.lastVisit).toISOString().slice(0, 10)}`);
            return ok(`Known domains (${domains.length}):\n\n${lines.join("\n")}`);
        }
        const record = await domainKnowledge.inspect(domain);
        if (!record)
            return ok(`No knowledge about "${domain}" yet.`);
        const lines = [
            `Domain: ${record.domain}`,
            `Visits: ${record.visitCount} (first: ${new Date(record.firstVisit).toISOString().slice(0, 10)}, last: ${new Date(record.lastVisit).toISOString().slice(0, 10)})`,
            `Stealth tier: ${record.stealthTier}/3`,
        ];
        if (record.waitStrategy) {
            lines.push(`Wait strategy: ${record.waitStrategy.method} (avg ${Math.round(record.waitStrategy.avgLoadTime)}ms, ${record.waitStrategy.samples} samples)`);
        }
        if (record.consentSelector) {
            lines.push(`Consent selector: ${record.consentSelector}`);
        }
        if (record.blockHistory.length > 0) {
            lines.push(`Block history (${record.blockHistory.length}):`);
            record.blockHistory.slice(-5).forEach(b => {
                lines.push(`  ${new Date(b.timestamp).toISOString()} — ${b.reason}`);
            });
        }
        if (record.apiEndpoints.length > 0) {
            lines.push(`API endpoints (${record.apiEndpoints.length}):`);
            record.apiEndpoints.slice(0, 10).forEach(e => {
                lines.push(`  ${e.method} ${e.path} [${e.classification}]`);
            });
        }
        return ok(lines.join("\n"));
    }
    catch (e) {
        return err(`domain_knowledge failed: ${e.message}`);
    }
});
// ─── session_export_trace ──────────────────────────────────────────────────
server.registerTool("session_export_trace", {
    title: "Export Session Trace",
    description: "Export a Playwright trace file for a session. Requires LEAP_TRACE=true. " +
        "The trace can be viewed at trace.playwright.dev for detailed action timeline.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
    }).strict(),
}, async ({ sessionId }) => {
    try {
        if (!LEAP_TRACE)
            return err("Tracing is not enabled. Set LEAP_TRACE=true to enable.");
        const session = requireSession(sessionId);
        const tracePath = path.join(os.tmpdir(), `leapfrog-trace-${sessionId}-${Date.now()}.zip`);
        await session.context.tracing.stop({ path: tracePath });
        // Restart tracing for continued capture
        await session.context.tracing.start({ screenshots: true, snapshots: true });
        return ok(`Trace exported: ${tracePath}\nView at: https://trace.playwright.dev (drag & drop the file)`);
    }
    catch (e) {
        return err(`Trace export failed: ${e.message}`);
    }
});
// ─── CLI Flags ─────────────────────────────────────────────────────────────
async function runDoctor() {
    const checks = [];
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
    }
    catch {
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
        }
        catch (e) {
            checks.push({ label: "Browser launch", status: "fail", detail: e.message });
        }
    }
    else {
        checks.push({ label: "Browser launch", status: "fail", detail: "Skipped (no binary)" });
    }
    // Profiles directory
    try {
        await fs.mkdir(PROFILE_DIR, { recursive: true });
        await fs.access(PROFILE_DIR, (await import("fs")).constants.W_OK);
        checks.push({ label: "Profiles directory", status: "pass", detail: PROFILE_DIR });
    }
    catch {
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
    console.log(`  LEAP_TILE           = ${process.env.LEAP_TILE ?? "(disabled)"}`);
    console.log(`  LEAP_TILE_PADDING   = ${process.env.LEAP_TILE_PADDING ?? "(default: 8)"}`);
    console.log(`  LEAP_REBROWSER      = ${process.env.LEAP_REBROWSER ?? "(default: false)"}`);
    console.log(`  LEAP_CAPTCHA_PROVIDER = ${process.env.LEAP_CAPTCHA_PROVIDER ?? "(disabled)"}`);
    console.log(`  LEAP_AUTO_WARM      = ${process.env.LEAP_AUTO_WARM ?? "(default: false)"}`);
    console.log(`  LEAP_STEALTH_PROFILES = ${process.env.LEAP_STEALTH_PROFILES ?? "(default: false — profile sessions skip stealth for better trust)"}`);
    console.log();
    const failed = checks.some((c) => c.status === "fail");
    process.exit(failed ? 1 : 0);
}
function printHelp() {
    console.log(`Leapfrog — Multi-session browser MCP for AI agents

Usage: npx leapfrog [options]

Options:
  --doctor         Run diagnostics and verify installation
  --stealth-audit  Run stealth self-test (bot detection checks)
    --local-only     Tier 1 only (~2s, no external sites)
    --full           Include Tier 3 extended checks (~45s)
    --json           Output structured JSON
    --headed         Run with visible browser window
  --config         Print MCP configuration JSON
  --help, -h       Show this help message

Environment Variables:
  LEAP_MAX_SESSIONS    Max concurrent sessions (default: 15)
  LEAP_HEADLESS        Run headless (default: true)
  LEAP_STEALTH         Enable stealth mode (default: true)
  LEAP_HUMANIZE        Enable humanization (default: false)
  LEAP_IDLE_TIMEOUT    Session idle timeout in ms (default: 1800000)
  LEAP_LOG_LEVEL       Log level: debug|info|warn|error (default: info)
  LEAP_CHANNEL         Browser channel: chromium|chrome (default: chromium)
  LEAP_ALLOW_JS        Allow JS evaluation (default: true)
  LEAP_TILE            Window tiling: true|grid|master (default: disabled)
  LEAP_TILE_PADDING    Pixels between tiled windows (default: 8)

Documentation: https://github.com/anthonybono21-cloud/leapfrog`);
    process.exit(0);
}
function printConfig() {
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
function printVersion() {
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
    if (args.includes("--stealth-audit")) {
        await runStealthAudit({
            localOnly: args.includes("--local-only"),
            full: args.includes("--full"),
            json: args.includes("--json"),
            headed: args.includes("--headed"),
        });
        return;
    }
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Start sidecar HTTP control server for headed mode
    if (LEAP_TILE && LEAP_TILE !== "false") {
        const sidecar = new SidecarServer({
            listSessions: () => sessions.listSessions().map(s => ({ id: s.id, name: s.name, url: s.url })),
            focusSession: async (id) => {
                const s = requireSession(id);
                const page = getPage(s);
                await page.bringToFront();
            },
            zoomSession: async (id) => {
                const s = requireSession(id);
                const page = getPage(s);
                await page.bringToFront();
            },
            restoreGrid: async () => {
                await reflowWithContext();
            },
            setLayout: async (layout) => {
                if (tileManager.isEnabled()) {
                    tileManager.configure({ layout: layout === "master" ? "master" : "grid", padding: LEAP_TILE_PADDING });
                    await reflowWithContext();
                }
            },
            destroyAll: async () => { await sessions.destroyAll(); },
            screenshot: async (id) => {
                const s = requireSession(id);
                const page = getPage(s);
                return await page.screenshot();
            },
        });
        try {
            await sidecar.start(LEAP_SIDECAR_PORT);
        }
        catch (e) {
            if (e?.code === "EADDRINUSE") {
                logger.warn("sidecar.port_in_use", { port: LEAP_SIDECAR_PORT, message: "Another Leapfrog instance owns this port. Sidecar disabled for this process." });
            }
            else {
                throw e;
            }
        }
    }
    console.error(`Leapfrog MCP server running (max ${MAX_SESSIONS} sessions, headless=${HEADLESS}${tileManager.isEnabled() ? `, tile=${tileManager.getLayout()}` : ""}${LEAP_HUD ? ", HUD" : ""}${LEAP_TRACE ? ", tracing" : ""})`);
}
main().catch((e) => {
    console.error("Fatal:", e.message);
    process.exit(1);
});
// ─── Graceful shutdown ──────────────────────────────────────────────────────
process.on("SIGINT", async () => {
    if (tilesCoord)
        await tilesCoord.releaseAll().catch(() => { });
    await domainKnowledge.flush().catch(() => { });
    await sessions.destroyAll();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    if (tilesCoord)
        await tilesCoord.releaseAll().catch(() => { });
    await domainKnowledge.flush().catch(() => { });
    await sessions.destroyAll();
    process.exit(0);
});
