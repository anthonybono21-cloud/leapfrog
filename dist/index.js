#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SessionManager } from "./session-manager.js";
import { SnapshotEngine } from "./snapshot-engine.js";
import { networkIntelligence } from "./network-intelligence.js";
import { tabManager } from "./tab-manager.js";
import { crashRecovery } from "./crash-recovery.js";
// ─── Config ─────────────────────────────────────────────────────────────────
const MAX_SESSIONS = Number(process.env.HYDRA_MAX_SESSIONS ?? 15);
const IDLE_TIMEOUT_MS = Number(process.env.HYDRA_IDLE_TIMEOUT ?? 5 * 60 * 1000);
if (!Number.isFinite(MAX_SESSIONS) || MAX_SESSIONS < 1)
    throw new Error("Invalid HYDRA_MAX_SESSIONS");
if (!Number.isFinite(IDLE_TIMEOUT_MS) || IDLE_TIMEOUT_MS < 1000)
    throw new Error("Invalid HYDRA_IDLE_TIMEOUT");
const HEADLESS = process.env.HYDRA_HEADLESS !== "false";
const SCREENSHOT_DIR = path.join(os.homedir(), "Documents", "hydrachrome-screenshots");
const MAX_SNAPSHOT_CHARS = 10000;
const ALLOW_JS = process.env.HYDRA_ALLOW_JS !== "false";
const sessions = new SessionManager({
    maxSessions: MAX_SESSIONS,
    idleTimeoutMs: IDLE_TIMEOUT_MS,
    headless: HEADLESS,
});
const snapEngine = new SnapshotEngine();
// ─── Helpers ────────────────────────────────────────────────────────────────
function ok(text) {
    return { content: [{ type: "text", text }] };
}
function err(msg) {
    return { content: [{ type: "text", text: msg }], isError: true };
}
function requireSession(sessionId) {
    const s = sessions.getSession(sessionId);
    if (!s)
        throw new Error(`Session "${sessionId}" not found. Use session_list to see active sessions.`);
    sessions.touchSession(sessionId);
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
    const url = page.url();
    let title = "";
    try {
        title = await page.title();
    }
    catch { /* */ }
    return `[${session.id}] ${title}\n${url}\n${result.nodeCount} elements\n\n${result.text}`;
}
const PROFILE_DIR = path.join(os.homedir(), ".hydrachrome", "profiles");
// ─── Server ─────────────────────────────────────────────────────────────────
const server = new McpServer({ name: "hydrachrome", version: "0.1.0" }, { capabilities: { tools: {} } });
// ─── session_create ─────────────────────────────────────────────────────────
server.registerTool("session_create", {
    title: "Create Browser Session",
    description: "Create a new isolated browser session with its own cookies and state. " +
        "Returns a short session ID (e.g. s_k3m7x1) to pass to all other tools. " +
        "Each session is a separate BrowserContext — no cookie leakage between sessions. " +
        `Pool limit: ${MAX_SESSIONS} concurrent sessions.`,
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
    }),
}, async ({ profilePath, viewport, userAgent }) => {
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
        const session = await sessions.createSession({ profilePath, viewport, userAgent });
        const stats = sessions.getStats();
        return ok(`Session created: ${session.id}\n` +
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
    inputSchema: z.object({}),
}, async () => {
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
    return ok(`${stats.active}/${stats.maxSessions} sessions\n\n` +
        lines.join("\n"));
});
// ─── session_destroy ────────────────────────────────────────────────────────
server.registerTool("session_destroy", {
    title: "Destroy Browser Session",
    description: "Close and clean up a browser session. Frees a pool slot.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID to destroy."),
    }),
}, async ({ sessionId }) => {
    await sessions.destroySession(sessionId);
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
    }),
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
    inputSchema: z.object({}),
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
    }),
}, async ({ sessionId, url, waitUntil }) => {
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
        const session = requireSession(sessionId);
        await getPage(session).goto(url, { waitUntil });
        const text = await snapAndFormat(session);
        return ok(text);
    }
    catch (e) {
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
    }),
}, async ({ sessionId, selector, maxChars }) => {
    try {
        const session = requireSession(sessionId);
        const text = await snapAndFormat(session, { selector, maxChars });
        return ok(text);
    }
    catch (e) {
        return err(`Snapshot failed: ${e.message}`);
    }
});
// ─── act ────────────────────────────────────────────────────────────────────
server.registerTool("act", {
    title: "Browser Action",
    description: "Perform a browser interaction: click, fill, type, check, select, press key, scroll, hover, back, forward. " +
        "Use @eN refs from navigate/snapshot as the target (e.g. '@e2'). CSS selectors also work. " +
        "Returns a fresh snapshot if the page navigated, or just the action result if it didn't.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        action: z
            .enum(["click", "dblclick", "fill", "type", "check", "uncheck", "select", "press", "scroll", "hover", "back", "forward"])
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
    }),
}, async ({ sessionId, action, target, value, key, scrollDirection, scrollAmount }) => {
    try {
        const session = requireSession(sessionId);
        const page = getPage(session);
        const urlBefore = page.url();
        // Resolve target to a Playwright locator
        const resolve = (ref) => {
            if (ref.startsWith("@e")) {
                const selector = session.refMap.get(ref);
                if (!selector)
                    throw new Error(`Ref ${ref} not found. Take a fresh snapshot.`);
                return page.locator(selector);
            }
            return page.locator(ref);
        };
        switch (action) {
            case "click":
            case "dblclick":
            case "hover": {
                if (!target)
                    return err(`'${action}' requires a target`);
                const loc = resolve(target);
                if (action === "dblclick")
                    await loc.dblclick();
                else if (action === "hover")
                    await loc.hover();
                else
                    await loc.click();
                break;
            }
            case "fill": {
                if (!target || value === undefined)
                    return err("'fill' requires target and value");
                await resolve(target).fill(value);
                break;
            }
            case "type": {
                if (!target || value === undefined)
                    return err("'type' requires target and value");
                await resolve(target).pressSequentially(value);
                break;
            }
            case "check":
            case "uncheck": {
                if (!target)
                    return err(`'${action}' requires a target`);
                if (action === "check")
                    await resolve(target).check();
                else
                    await resolve(target).uncheck();
                break;
            }
            case "select": {
                if (!target || value === undefined)
                    return err("'select' requires target and value");
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
                if (target) {
                    await resolve(target).scrollIntoViewIfNeeded();
                }
                else {
                    const dir = scrollDirection ?? "down";
                    const px = scrollAmount ?? 300;
                    const deltaX = dir === "right" ? px : dir === "left" ? -px : 0;
                    const deltaY = dir === "down" ? px : dir === "up" ? -px : 0;
                    await page.mouse.wheel(deltaX, deltaY);
                }
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
        if (urlAfter !== urlBefore) {
            try {
                await page.waitForLoadState("load", { timeout: 5000 });
            }
            catch { /* timeout ok */ }
            const text = await snapAndFormat(session);
            return ok(`[navigated → ${urlAfter}]\n\n${text}`);
        }
        // Same page — brief confirmation
        return ok(`Done: ${action}${target ? ` ${target}` : ""}${value ? ` "${value}"` : ""}`);
    }
    catch (e) {
        return err(`Action failed: ${e.message}`);
    }
});
// ─── screenshot ─────────────────────────────────────────────────────────────
server.registerTool("screenshot", {
    title: "Screenshot",
    description: "Capture a screenshot of the current page. Returns the image inline.",
    inputSchema: z.object({
        sessionId: z.string().describe("Session ID."),
        fullPage: z.boolean().default(false).describe("Capture full scrollable page."),
        selector: z.string().optional().describe("CSS selector to capture a specific element."),
    }),
}, async ({ sessionId, fullPage, selector }) => {
    try {
        const session = requireSession(sessionId);
        const page = getPage(session);
        await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
        const filepath = path.join(SCREENSHOT_DIR, `${sessionId}_${Date.now()}.png`);
        if (selector) {
            await page.locator(selector).screenshot({ path: filepath });
        }
        else {
            await page.screenshot({ path: filepath, fullPage });
        }
        const imageBuffer = await fs.readFile(filepath);
        return {
            content: [
                { type: "text", text: `Saved: ${filepath}` },
                { type: "image", data: imageBuffer.toString("base64"), mimeType: "image/png" },
            ],
        };
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
    }),
}, async ({ sessionId, type, target, js, maxChars }) => {
    try {
        const session = requireSession(sessionId);
        const page = getPage(session);
        let result;
        const resolve = (ref) => {
            if (ref.startsWith("@e")) {
                const sel = session.refMap.get(ref);
                if (!sel)
                    throw new Error(`Ref ${ref} not found.`);
                return page.locator(sel);
            }
            return page.locator(ref);
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
                    return err("JavaScript evaluation is disabled. Set HYDRA_ALLOW_JS=true to enable.");
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
                    result = (await resolve(target).textContent()) ?? "";
                }
                else {
                    result = (await page.locator("body").textContent()) ?? "";
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
        return ok(result || "(empty)");
    }
    catch (e) {
        return err(`Extract failed: ${e.message}`);
    }
});
// ─── pool_status ────────────────────────────────────────────────────────────
server.registerTool("pool_status", {
    title: "Pool Status & Resources",
    description: "Show pool stats, resource usage (memory, uptime), and all active session summaries.",
    inputSchema: z.object({}),
}, async () => {
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
    }),
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
    }),
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
    }),
}, async ({ sessionId, action, ruleId, urlPattern, mockStatus, mockBody, mockContentType }) => {
    try {
        const session = requireSession(sessionId);
        const page = getPage(session);
        if (action === "remove") {
            await networkIntelligence.removeIntercept(page, session, ruleId);
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
    }),
}, async ({ sessionId, condition, target, text, js, timeout }) => {
    try {
        const session = requireSession(sessionId);
        const page = getPage(session);
        await tabManager.waitFor(page, session, { type: condition, target, text, js, timeout });
        const snap = await snapAndFormat(session);
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
    }),
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
    }),
}, async ({ sessionId, tabIndex }) => {
    try {
        const session = requireSession(sessionId);
        tabManager.switchTab(session, tabIndex);
        const snap = await snapAndFormat(session);
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
    }),
}, async ({ sessionId, tabIndex }) => {
    try {
        const session = requireSession(sessionId);
        await tabManager.closeTab(session, tabIndex);
        const snap = await snapAndFormat(session);
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
    }),
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
// ─── Startup ────────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`HydraChrome MCP server running (max ${MAX_SESSIONS} sessions, headless=${HEADLESS})`);
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
