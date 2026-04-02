import type { BrowserContext, Page } from "playwright";
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
    /** Ring buffer of captured network responses (max 200). Initialized by NetworkIntelligence.attachToPage(). */
    networkLog?: NetworkEntry[];
    /** Ring buffer of captured console messages (max 100). Initialized by NetworkIntelligence.attachToPage(). */
    consoleLog?: ConsoleEntry[];
    /** Active intercept rules for this session. Initialized by NetworkIntelligence.attachToPage(). */
    interceptRules?: NetworkInterceptRule[];
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
}
export interface ISessionManager {
    createSession(opts?: SessionCreateOptions): Promise<Session>;
    getSession(id: string): Session | undefined;
    touchSession(id: string): void;
    destroySession(id: string): Promise<void>;
    destroyAll(): Promise<void>;
    listSessions(): SessionInfo[];
    getStats(): PoolStats;
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
