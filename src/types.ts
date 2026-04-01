import type { Browser, BrowserContext, Page } from "playwright";

// ─── Session ────────────────────────────────────────────────────────────────

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
  viewport?: { width: number; height: number };
  /** Custom user agent */
  userAgent?: string;
}

// ─── Session Manager ────────────────────────────────────────────────────────

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
  defaultViewport: { width: number; height: number };
  headless: boolean;
}

// ─── Snapshot Engine ────────────────────────────────────────────────────────

export interface SnapshotNode {
  ref: string;        // e.g. "@e1"
  role: string;       // e.g. "button", "link", "textbox"
  name: string;       // accessible name / visible text
  selector: string;   // Playwright selector for acting on this element
  value?: string;     // current value for inputs
  checked?: boolean;  // for checkboxes/radios
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
  text: string;       // Compact text representation with @eN refs
  refs: Map<string, string>;  // ref -> selector mapping
  nodeCount: number;
}

export interface ISnapshotEngine {
  snapshot(page: Page, session: Session, opts?: SnapshotOptions): Promise<SnapshotResult>;
}

// ─── MCP Tool Helpers ───────────────────────────────────────────────────────

export interface ToolSuccess {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
}

export interface ToolError {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
}

export type ToolResult = ToolSuccess | ToolError;
