import type { BrowserContext, Page } from "playwright";
export interface Session {
    id: string;
    context: BrowserContext;
    page: Page;
    createdAt: number;
    lastUsedAt: number;
    /** Ref counter for compact snapshot elements — increments across snapshots */
    refCounter: number;
    /** Map from @eN ref string to Playwright locator selector */
    refMap: Map<string, string>;
    profilePath?: string;
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
