import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────

export type ActionOutcome =
  | "SUCCESS"
  | "SILENT_CLICK"
  | "NAVIGATION"
  | "WRONG_ELEMENT"
  | "BLOCKED"
  | "ERROR"
  | "PENDING";

export interface LoopWarning {
  type: "same-element" | "same-url" | "ping-pong" | "action-repeat";
  message: string;
  count: number;
  suggestion: string;
}

export interface StuckWarning {
  stuckActions: number;
  message: string;
  suggestions: string[];
}

export interface ActionRecord {
  index: number;
  timestamp: number;
  actionType: string;
  target?: string;
  value?: string;
  url: string;
  snapshotHash: string;
  outcome: ActionOutcome;
  duration: number;
  /** Present on records created via recordToolCall (navigate, snapshot, etc.) */
  toolCall?: {
    toolName: string;
    params: Record<string, unknown>;
    resultSummary: string;
  };
}

export interface HarnessState {
  outcome: ActionOutcome;
  outcomeDetail: string;
  loopWarning?: LoopWarning;
  stuckWarning?: StuckWarning;
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;
const LOOP_WINDOW = 10;
const LOOP_THRESHOLD = 3;
const STUCK_THRESHOLD = 5;

const BLOCKED_KEYWORDS_STRONG = [
  "captcha",
  "verify you're human",
  "verify you are human",
  "access denied",
  "security check",
  "bot detection",
  "prove you're not a robot",
  "i'm not a robot",
  "unusual traffic",
];

const BLOCKED_KEYWORDS_WEAK = [
  "challenge",
  "cloudflare",
  "please wait",
  "checking your browser",
  "just a moment",
  "blocked",
];

/** Element count above which only strong challenge signals trigger BLOCKED */
const BLOCKED_ELEMENT_THRESHOLD = 50;

const NON_INTERACTIVE_ELEMENTS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6",
  "div", "span", "section", "article", "header", "footer",
  "main", "nav", "aside", "li", "dt", "dd", "td", "th", "tr",
]);

/** ARIA roles that are non-interactive (from snapshot @eN refs) */
const NON_INTERACTIVE_ROLES = new Set([
  "paragraph", "heading", "generic", "group", "region",
  "contentinfo", "banner", "complementary", "navigation",
  "main", "article", "section", "figure", "list", "listitem",
  "definition", "term", "cell", "row", "rowgroup", "columnheader",
  "rowheader", "table", "img", "separator", "presentation", "none",
  "status", "blockquote", "caption", "code", "deletion", "emphasis",
  "insertion", "strong", "subscript", "superscript", "time",
]);

/** Roles that suggest what the agent should do instead */
const ROLE_SUGGESTIONS: Record<string, string> = {
  paragraph: "Consider using `extract` to read content, or find a link/button nearby.",
  heading: "Consider using `extract` to read content, or find a link/button nearby.",
  generic: "This is a non-interactive container. Look for a button, link, or input inside it.",
  img: "Images aren't clickable unless they contain a link. Check for a parent link or nearby button.",
  group: "This is a grouping element. Look for interactive elements inside it.",
  region: "This is a region container. Look for interactive elements inside it.",
  list: "Click a specific list item's link or button, not the list container.",
  listitem: "Look for a link or button inside this list item.",
  cell: "Look for a link or button inside this table cell.",
  table: "Click a specific cell, link, or button within the table.",
  navigation: "Look for links or buttons inside this navigation region.",
};


// ─── State storage ────────────────────────────────────────────────────────

interface PreState {
  url: string;
  snapshotHash: string;
}

const preStates = new Map<string, PreState>();
const histories = new Map<string, ActionRecord[]>();

// ─── Hashing (djb2) ──────────────────────────────────────────────────────

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  // Convert to unsigned 32-bit hex for readability
  return (hash >>> 0).toString(16);
}

// ─── Blocked detection ────────────────────────────────────────────────────

function isBlockedPage(snapshotText: string): boolean {
  const lower = snapshotText.toLowerCase();

  // Count elements in snapshot (lines starting with @e)
  const elementCount = (snapshotText.match(/^[ \t]*@e\d+/gm) ?? []).length;

  // Strong signals always trigger BLOCKED
  const hasStrongSignal = BLOCKED_KEYWORDS_STRONG.some((kw) => lower.includes(kw));

  // Weak signals only trigger on small pages (< threshold elements)
  const hasWeakSignal = BLOCKED_KEYWORDS_WEAK.some((kw) => lower.includes(kw));

  if (hasStrongSignal) {
    // Even with strong signals, a page with many elements is likely real content
    // that happens to mention these words. Require very few elements too.
    if (elementCount > BLOCKED_ELEMENT_THRESHOLD) return false;
    return true;
  }

  if (hasWeakSignal && elementCount < BLOCKED_ELEMENT_THRESHOLD) {
    return true;
  }

  return false;
}

// ─── Outcome classification ───────────────────────────────────────────────

/**
 * Extract the tag name from a CSS selector target like "p.intro", "div#main", "h1", "span.text".
 * Returns lowercase tag name or undefined if not a simple tag selector.
 */
function extractTagName(target: string | undefined): string | undefined {
  if (!target) return undefined;
  // Skip ref-style targets like @e5
  if (target.startsWith("@e")) return undefined;
  // Match the leading tag name from a CSS selector
  const match = target.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Extract the ARIA role from the snapshot text for an @eN target.
 * Snapshot lines look like: "@e5 paragraph "Some text content""
 * Returns the role string (e.g. "paragraph") or undefined if not found.
 */
function extractRoleFromSnapshot(target: string, snapshotText: string): string | undefined {
  if (!target || !target.startsWith("@e")) return undefined;
  // Match the line in the snapshot: "@eN role ..."
  // Account for optional leading whitespace/indentation
  const ref = target.replace("@", ""); // "e5"
  const pattern = new RegExp(`(?:^|\\n)\\s*@${ref}\\s+(\\w[\\w-]*)`, "m");
  const match = snapshotText.match(pattern);
  return match ? match[1].toLowerCase() : undefined;
}

/**
 * Build a helpful SILENT_CLICK message for a non-interactive role.
 */
function buildNonInteractiveMessage(role: string): string {
  const suggestion = ROLE_SUGGESTIONS[role] ??
    "Consider using `extract` to read content, or find a link/button nearby.";
  return `Clicked non-interactive element (role: ${role}). ${suggestion}`;
}

function classifyOutcome(
  preState: PreState | undefined,
  postUrl: string,
  postHash: string,
  postSnapshot: string,
  error?: string,
  actionType?: string,
  target?: string,
): { outcome: ActionOutcome; detail: string } {
  // Error takes top priority
  if (error) {
    return { outcome: "ERROR", detail: error };
  }

  // No pre-state captured — graceful degradation
  if (!preState) {
    return { outcome: "SUCCESS", detail: "Action completed (no pre-state for comparison)" };
  }

  // URL changed → NAVIGATION
  if (postUrl !== preState.url) {
    return { outcome: "NAVIGATION", detail: `Navigated: ${preState.url} → ${postUrl}` };
  }

  // Check for click on non-interactive CSS selector targets (tag-based detection).
  // These are pre-hash checks because CSS tag selectors are strong signals
  // (the agent explicitly used a tag selector like "p" or "div").
  if (actionType === "click" || actionType === "dblclick") {
    const tagName = extractTagName(target);
    if (tagName && NON_INTERACTIVE_ELEMENTS.has(tagName)) {
      return {
        outcome: "SILENT_CLICK",
        detail: `Warning: Clicked a non-interactive element (<${tagName}>). No action was performed. Did you mean to click a button or link?`,
      };
    }
  }

  // Same snapshot hash → SILENT_CLICK
  // For @eN targets: also parse the role from the snapshot for better messages.
  if (postHash === preState.snapshotHash) {
    if (target && (actionType === "click" || actionType === "dblclick")) {
      const role = target ? extractRoleFromSnapshot(target, postSnapshot) : undefined;
      if (role && NON_INTERACTIVE_ROLES.has(role)) {
        return { outcome: "SILENT_CLICK", detail: buildNonInteractiveMessage(role) };
      }
    }
    return { outcome: "SILENT_CLICK", detail: "No DOM changes detected after action" };
  }

  // Hash changed — check for blocked pages
  if (isBlockedPage(postSnapshot)) {
    return { outcome: "BLOCKED", detail: "Anti-bot or challenge page detected" };
  }

  // Hash changed with normal content
  return { outcome: "SUCCESS", detail: "DOM changed after action" };
}

// ─── Loop detection ───────────────────────────────────────────────────────

function detectLoop(history: ActionRecord[]): LoopWarning | undefined {
  if (history.length < LOOP_THRESHOLD) return undefined;

  const window = history.slice(-LOOP_WINDOW);

  // 1. Same-element loop: same target clicked 3+ times
  const targetCounts = new Map<string, number>();
  for (const rec of window) {
    if (rec.target) {
      const key = `${rec.actionType}:${rec.target}`;
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of targetCounts) {
    if (count >= LOOP_THRESHOLD) {
      const [, target] = key.split(":");
      return {
        type: "same-element",
        message: `You've interacted with ${target} ${count} times in the last ${window.length} actions with no state change.`,
        count,
        suggestion: "Try a different element or scroll to reveal more options.",
      };
    }
  }

  // 2. Same-URL loop: same URL visited 3+ times
  const urlCounts = new Map<string, number>();
  for (const rec of window) {
    if (rec.outcome === "NAVIGATION") {
      urlCounts.set(rec.url, (urlCounts.get(rec.url) ?? 0) + 1);
    }
  }
  for (const [url, count] of urlCounts) {
    if (count >= LOOP_THRESHOLD) {
      return {
        type: "same-url",
        message: `Navigated to ${url} ${count} times.`,
        count,
        suggestion: "You may be stuck in a redirect loop. Try a different approach or URL.",
      };
    }
  }

  // 3. Ping-pong: alternating between 2 URLs (A→B→A→B)
  if (window.length >= 4) {
    const urls = window.map((r) => r.url);
    const last4 = urls.slice(-4);
    if (
      last4[0] === last4[2] &&
      last4[1] === last4[3] &&
      last4[0] !== last4[1]
    ) {
      return {
        type: "ping-pong",
        message: `Alternating between ${last4[0]} and ${last4[1]}.`,
        count: 4,
        suggestion: "Break the cycle — try a completely different page or action.",
      };
    }

    // Also check ping-pong on targets
    const targets = window.filter((r) => r.target).map((r) => r.target!);
    if (targets.length >= 4) {
      const lastTargets = targets.slice(-4);
      if (
        lastTargets[0] === lastTargets[2] &&
        lastTargets[1] === lastTargets[3] &&
        lastTargets[0] !== lastTargets[1]
      ) {
        return {
          type: "ping-pong",
          message: `Alternating between ${lastTargets[0]} and ${lastTargets[1]}.`,
          count: 4,
          suggestion: "Break the cycle — try a completely different element or approach.",
        };
      }
    }
  }

  // 4. Action repetition: same action+target 3+ times with no DOM change
  const noChangeActions = window.filter((r) => r.outcome === "SILENT_CLICK");
  if (noChangeActions.length >= LOOP_THRESHOLD) {
    const repeatCounts = new Map<string, number>();
    for (const rec of noChangeActions) {
      const key = `${rec.actionType}:${rec.target ?? "none"}`;
      repeatCounts.set(key, (repeatCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of repeatCounts) {
      if (count >= LOOP_THRESHOLD) {
        const [actionType, target] = key.split(":");
        return {
          type: "action-repeat",
          message: `${actionType} on ${target} repeated ${count} times with no DOM change.`,
          count,
          suggestion: "This action isn't producing results. Try a different approach.",
        };
      }
    }
  }

  return undefined;
}

// ─── Stuck detection ──────────────────────────────────────────────────────

function detectStuck(history: ActionRecord[]): StuckWarning | undefined {
  if (history.length < STUCK_THRESHOLD) return undefined;

  // Count consecutive actions from the end where snapshot hash didn't change
  let consecutiveStatic = 0;
  const last = history[history.length - 1];

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].snapshotHash === last.snapshotHash) {
      consecutiveStatic++;
    } else {
      break;
    }
  }

  if (consecutiveStatic < STUCK_THRESHOLD) return undefined;

  // Build contextual suggestions
  const suggestions: string[] = [];
  const recentActions = history.slice(-consecutiveStatic);
  const actionTypes = new Set(recentActions.map((r) => r.actionType));

  if (!actionTypes.has("scroll")) {
    suggestions.push("Try scrolling down — content may be below the fold");
  }

  if (actionTypes.size === 1 && actionTypes.has("click")) {
    suggestions.push("Try a different element or check if the page has iframes");
  }

  const recentUrls = new Set(recentActions.map((r) => r.url));
  if (recentUrls.size === 1 && consecutiveStatic >= 5) {
    suggestions.push("Consider navigating to a different page");
  }

  suggestions.push(
    "The page may need JavaScript to update. Try waiting or using extract with JS evaluation.",
  );

  return {
    stuckActions: consecutiveStatic,
    message: `Page appears static after ${consecutiveStatic} actions`,
    suggestions,
  };
}

// ─── Format harness output ────────────────────────────────────────────────

export function formatHarnessOutput(state: HarnessState): string {
  const lines: string[] = ["--- Harness Intelligence ---"];

  lines.push(`Outcome: ${state.outcome} — ${state.outcomeDetail}`);

  if (state.loopWarning) {
    lines.push(
      `\u26A0 Loop detected: ${state.loopWarning.message} ${state.loopWarning.suggestion}`,
    );
  }

  if (state.stuckWarning) {
    lines.push(`\u26A0 Stuck: ${state.stuckWarning.message}`);
    for (const s of state.stuckWarning.suggestions) {
      lines.push(`  - ${s}`);
    }
  }

  return lines.join("\n");
}

// ─── Ring buffer helper ──────────────────────────────────────────────────

function pushAndCap(sessionId: string, record: ActionRecord): ActionRecord[] {
  const history = histories.get(sessionId) ?? [];
  history.push(record);

  // Ring buffer: cap at MAX_HISTORY
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
    // Re-index after splice
    for (let i = 0; i < history.length; i++) {
      history[i].index = i;
    }
  }

  histories.set(sessionId, history);
  return history;
}

// ─── Main class ───────────────────────────────────────────────────────────

export class HarnessIntelligence {
  /** Record pre-action state. Call BEFORE performing an action. */
  static capturePreState(
    sessionId: string,
    url: string,
    snapshotText: string,
  ): void {
    preStates.set(sessionId, {
      url,
      snapshotHash: djb2(snapshotText),
    });
    logger.debug("harness:pre-state", { sessionId, url });
  }

  /** Analyze post-action state. Call AFTER performing an action. Returns guidance. */
  static analyzePostAction(
    sessionId: string,
    actionType: string,
    target: string | undefined,
    value: string | undefined,
    url: string,
    snapshotText: string,
    error?: string,
  ): HarnessState {
    const startTime = Date.now();
    const preState = preStates.get(sessionId);
    const postHash = djb2(snapshotText);

    // 1. Classify outcome
    const { outcome, detail } = classifyOutcome(
      preState,
      url,
      postHash,
      snapshotText,
      error,
      actionType,
      target,
    );

    // 2. Record in history
    const history = histories.get(sessionId) ?? [];
    const record: ActionRecord = {
      index: history.length,
      timestamp: Date.now(),
      actionType,
      target,
      value,
      url,
      snapshotHash: postHash,
      outcome,
      duration: preState ? Date.now() - startTime : 0,
    };

    const updatedHistory = pushAndCap(sessionId, record);

    // Clean up pre-state
    preStates.delete(sessionId);

    // 3. Detect loops
    const loopWarning = detectLoop(updatedHistory);

    // 4. Detect stuck
    const stuckWarning = detectStuck(updatedHistory);

    const state: HarnessState = {
      outcome,
      outcomeDetail: detail,
      loopWarning,
      stuckWarning,
    };

    logger.debug("harness:post-action", {
      sessionId,
      outcome,
      loopDetected: !!loopWarning,
      stuckDetected: !!stuckWarning,
    });

    return state;
  }

  /**
   * Record a tool call (navigate, snapshot, batch_actions, execute, etc.)
   * so that session_memory returns a complete timeline — not just `act` calls.
   */
  static recordToolCall(
    sessionId: string,
    toolName: string,
    params: Record<string, unknown>,
    resultSummary: string,
    durationMs: number,
  ): void {
    const history = histories.get(sessionId) ?? [];
    const record: ActionRecord = {
      index: history.length,
      timestamp: Date.now(),
      actionType: toolName,
      target: undefined,
      value: undefined,
      url: (params.url as string) ?? "",
      snapshotHash: "",
      outcome: "SUCCESS",
      duration: durationMs,
      toolCall: {
        toolName,
        params,
        resultSummary,
      },
    };

    pushAndCap(sessionId, record);

    logger.debug("harness:tool-call", { sessionId, toolName, resultSummary });
  }

  /** Get action history for a session */
  static getHistory(sessionId: string, limit?: number): ActionRecord[] {
    const history = histories.get(sessionId) ?? [];
    if (limit !== undefined && limit > 0) {
      return history.slice(-limit);
    }
    return [...history];
  }

  /** Clear all state for a session */
  static clearSession(sessionId: string): void {
    preStates.delete(sessionId);
    histories.delete(sessionId);
    logger.debug("harness:clear", { sessionId });
  }

  /** Get loop/stuck status without recording an action (for diagnostics) */
  static diagnose(sessionId: string): {
    loopWarning?: LoopWarning;
    stuckWarning?: StuckWarning;
  } {
    const history = histories.get(sessionId) ?? [];
    return {
      loopWarning: detectLoop(history),
      stuckWarning: detectStuck(history),
    };
  }
}

// ─── Exported helpers for testing ─────────────────────────────────────────

export { djb2, extractRoleFromSnapshot };

export default HarnessIntelligence;
