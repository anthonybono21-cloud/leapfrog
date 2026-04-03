import type { BrowserContext, Page } from "playwright-core";
import type { ApiCapture } from "./api-intelligence.js";
export interface NetworkEntry {
    timestamp: number;
    method: string;
    url: string;
    status: number;
    contentType: string;
    responseSize: number;
    duration: number;
    responseBody?: string;
}
export interface ConsoleEntry {
    timestamp: number;
    level: "log" | "warn" | "error" | "info" | "debug";
    text: string;
}
export interface NetworkInterceptRule {
    id: string;
    urlPattern: string;
    action: "block" | "log" | "mock";
    mockResponse?: {
        status: number;
        body: string;
        contentType: string;
    };
}
export interface Session {
    id: string;
    context: BrowserContext;
    /** @deprecated Use TabManager.getActivePage() instead. Kept for backward compatibility. */
    page: Page;
    /** All open pages (tabs) in this session, managed by TabManager */
    pages?: Page[];
    /** Index of the currently active page in the pages array */
    activePageIndex?: number;
    createdAt: number;
    lastUsedAt: number;
    /** Ref counter for compact snapshot elements — increments across snapshots */
    refCounter: number;
    /** Map from @eN ref string to Playwright locator selector */
    refMap: Map<string, string>;
    profilePath?: string;
    /** Profile shorthand name used to create this session (e.g. "github"). Used for auto-saving storageState on destroy. */
    profileName?: string;
    /** Client identifier for per-client pool partitioning */
    clientId?: string;
    /** Ring buffer of captured network responses (max 200). Initialized by NetworkIntelligence.attachToPage(). */
    networkLog?: NetworkEntry[];
    /** Ring buffer of captured console messages (max 100). Initialized by NetworkIntelligence.attachToPage(). */
    consoleLog?: ConsoleEntry[];
    /** Active intercept rules for this session. Initialized by NetworkIntelligence.attachToPage(). */
    interceptRules?: NetworkInterceptRule[];
    /** Captured API calls for this session. Managed by ApiIntelligence. */
    apiCaptures?: ApiCapture[];
    /** Whether this session is connected via CDP (don't kill browser on destroy). */
    cdpConnected?: boolean;
    /** Increments on every navigation (URL change via navigate tool). Used for stale-ref detection. */
    navGeneration?: number;
    /** The navGeneration value at the time of the last snapshot. Refs are stale when navGeneration > refNavGeneration. */
    refNavGeneration?: number;
    /** The refCounter value at the time of the last navigation. Refs with numbers <= this threshold are from a previous page. */
    staleRefThreshold?: number;
}
export interface SessionCreateOptions {
    /** Mount a Chrome user-data-dir for pre-authenticated profiles */
    profilePath?: string;
    /** Load Playwright storageState JSON for cookie/auth persistence */
    storageState?: string;
    /** Custom viewport size */
    viewport?: {
        width: number;
        height: number;
    };
    /** Custom user agent */
    userAgent?: string;
    /** Browser locale (e.g. "en-US", "fr-FR") */
    locale?: string;
    /** Timezone ID (e.g. "America/New_York", "Europe/London") */
    timezoneId?: string;
    /** Geolocation to emulate */
    geolocation?: {
        latitude: number;
        longitude: number;
        accuracy?: number;
    };
    /** Permissions to grant (e.g. ["geolocation", "notifications"]) */
    permissions?: string[];
    /** Preferred color scheme */
    colorScheme?: "light" | "dark" | "no-preference";
    /** Whether to accept downloads. Default: true */
    acceptDownloads?: boolean;
    /** Enable/disable stealth mode for this session. Default: true (global setting) */
    stealth?: boolean;
    /** Proxy configuration for this session (passed directly to Playwright browser context) */
    proxy?: {
        /** Proxy server URL (e.g. "http://proxy.example.com:8080" or "socks5://proxy.example.com:1080") */
        server: string;
        /** Username for proxy authentication */
        username?: string;
        /** Password for proxy authentication */
        password?: string;
        /** Comma-separated domains to bypass proxy (e.g. "*.example.com,chromium.org") */
        bypass?: string;
    };
    /** Profile shorthand name (e.g. "github", "gmail"). Resolves to ~/.leapfrog/chrome-profiles/{name}/ */
    profile?: string;
    /** Client identifier for per-client pool partitioning (used with LEAP_MAX_SESSIONS_PER_CLIENT) */
    clientId?: string;
    /** Per-session headed mode override. When true, browser runs with visible UI. */
    headed?: boolean;
    /** Paths to unpacked Chrome extensions to load */
    extensions?: string[];
    /** CDP endpoint URL to connect to instead of launching a new browser */
    cdp?: string;
}
export interface ISessionManager {
    createSession(opts?: SessionCreateOptions): Promise<Session>;
    getSession(id: string): Session | undefined;
    touchSession(id: string): void;
    destroySession(id: string): Promise<void>;
    destroyAll(): Promise<void>;
    listSessions(): SessionInfo[];
    getStats(): PoolStats;
    getClientSessionCount(clientId: string): number;
}
export interface SessionInfo {
    id: string;
    createdAt: number;
    lastUsedAt: number;
    url: string;
    title: string;
    profilePath?: string;
}
export interface PoolStats {
    active: number;
    maxSessions: number;
    totalCreated: number;
}
export interface SessionManagerConfig {
    maxSessions: number;
    idleTimeoutMs: number;
    cleanupIntervalMs: number;
    defaultViewport: {
        width: number;
        height: number;
    };
    headless: boolean;
    channel?: string;
}
export interface SnapshotNode {
    ref: string;
    role: string;
    name: string;
    selector: string;
    value?: string;
    checked?: boolean;
    disabled?: boolean;
    expanded?: boolean;
    children?: SnapshotNode[];
}
export interface SnapshotOptions {
    /** CSS selector to scope the snapshot to a subtree */
    selector?: string;
    /** Only return interactive elements (default true) */
    interactiveOnly?: boolean;
    /** Max tree depth */
    maxDepth?: number;
    /** Max characters in output */
    maxChars?: number;
}
export interface SnapshotResult {
    text: string;
    refs: Map<string, string>;
    nodeCount: number;
}
export interface ISnapshotEngine {
    snapshot(page: Page, session: Session, opts?: SnapshotOptions): Promise<SnapshotResult>;
}
export interface TabInfo {
    index: number;
    url: string;
    title: string;
    isActive: boolean;
}
export interface WaitCondition {
    type: "element" | "text" | "network_idle" | "navigation" | "js";
    /** CSS selector or @eN ref */
    target?: string;
    /** Text to wait for or URL pattern */
    text?: string;
    /** JavaScript expression to evaluate */
    js?: string;
    /** Timeout in ms. Default: 10000, max: 30000 */
    timeout?: number;
}
export interface ToolSuccess {
    content: Array<{
        type: "text";
        text: string;
    } | {
        type: "image";
        data: string;
        mimeType: string;
    }>;
}
export interface ToolError {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError: true;
}
export type ToolResult = ToolSuccess | ToolError;
