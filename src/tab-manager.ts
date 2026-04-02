import type { BrowserContext, Page } from "playwright";
import type { Session, TabInfo, WaitCondition } from "./types.js";
import { stealth } from "./stealth.js";

// ─── Tab Manager ──────────────────────────────────────────────────────────
//
// Manages multiple tabs (pages) within a single browser session.
// New tabs auto-become active (best UX for OAuth/popup flows).
// Closed pages are auto-cleaned from the array on list/switch operations.
// getActivePage() is the single source of truth for all tool operations.
//

const MAX_WAIT_TIMEOUT = 30_000;
const DEFAULT_WAIT_TIMEOUT = 10_000;

/**
 * Ensure session.pages and session.activePageIndex are initialized.
 * Safe to call multiple times — only initializes on first call or if
 * the session was created before TabManager was wired up.
 */
function ensureInitialized(session: Session): { pages: Page[]; activePageIndex: number } {
  if (!session.pages) {
    session.pages = [session.page];
  }
  if (session.activePageIndex === undefined || session.activePageIndex === null) {
    session.activePageIndex = 0;
  }
  return { pages: session.pages, activePageIndex: session.activePageIndex };
}

export class TabManager {
  // ── attachToContext ─────────────────────────────────────────────────
  //
  // Call once when a session is created. Initializes the pages array from
  // the session's initial page and sets up event handlers to auto-track
  // new tabs/popups opened by the browser context.

  attachToContext(context: BrowserContext, session: Session): void {
    // Initialize pages array with the session's existing page
    session.pages = [session.page];
    session.activePageIndex = 0;

    // Listen for new pages (popups, window.open, target=_blank links)
    context.on("page", (newPage: Page) => {
      const { pages } = ensureInitialized(session);

      // Add to pages array
      pages.push(newPage);

      // Make the new tab active — most common UX for popups/OAuth flows
      session.activePageIndex = pages.length - 1;

      // Auto-dismiss dialogs on the new page (same pattern as session-manager)
      // P1 #6: Add 200-500ms random delay — instant dismiss (< 30ms) is a headless signal
      newPage.on("dialog", (dialog) => {
        const delay = stealth.isEnabled() ? stealth.getDialogDelay() : 0;
        setTimeout(() => dialog.dismiss().catch(() => {}), delay);
      });

      // When this page closes, clean it from the array
      newPage.on("close", () => {
        this.pruneClosedPages(session);
      });
    });
  }

  // ── getActivePage ──────────────────────────────────────────────────
  //
  // Single source of truth for the current active page. All tools should
  // call this instead of accessing session.page directly.
  // Prunes closed pages and falls back to the first open page if the
  // active index has become invalid.

  getActivePage(session: Session): Page {
    this.pruneClosedPages(session);

    const { pages } = ensureInitialized(session);
    let idx = session.activePageIndex!;

    // Validate index bounds after pruning
    if (idx < 0 || idx >= pages.length) {
      idx = 0;
      session.activePageIndex = 0;
    }

    const page = pages[idx];

    // Keep session.page in sync for backward compatibility
    if (page && session.page !== page) {
      session.page = page;
    }

    return page;
  }

  // ── listTabs ───────────────────────────────────────────────────────
  //
  // Returns info about all open tabs. Cleans up closed pages first.
  // Each entry includes index, url, title, and active status.

  async listTabs(session: Session): Promise<TabInfo[]> {
    this.pruneClosedPages(session);

    const { pages, activePageIndex } = ensureInitialized(session);
    const tabs: TabInfo[] = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const isActive = i === activePageIndex;

      let url = "";
      let title = "";

      try {
        url = page.url();
      } catch {
        // Page may have crashed between prune and access
        url = "(unavailable)";
      }

      try {
        title = await page.title();
      } catch {
        title = "(unavailable)";
      }

      tabs.push({ index: i, url, title, isActive });
    }

    return tabs;
  }

  // ── switchTab ──────────────────────────────────────────────────────
  //
  // Switch the active page by index. Pass -1 to switch to the last
  // (most recently opened) tab. Validates bounds and brings the
  // target page to front.

  switchTab(session: Session, tabIndex: number): Page {
    this.pruneClosedPages(session);

    const { pages } = ensureInitialized(session);
    const count = pages.length;

    if (count === 0) {
      throw new Error("No open tabs in session.");
    }

    // -1 means "last tab" (most recently opened)
    const resolvedIndex = tabIndex === -1 ? count - 1 : tabIndex;

    if (resolvedIndex < 0 || resolvedIndex >= count) {
      throw new Error(
        `Tab index ${tabIndex} out of bounds. Valid range: 0-${count - 1} (or -1 for last).`
      );
    }

    session.activePageIndex = resolvedIndex;
    const page = pages[resolvedIndex];

    // Keep session.page in sync for backward compatibility
    session.page = page;

    // Bring to front (non-blocking — fire and forget)
    page.bringToFront().catch(() => {});

    return page;
  }

  // ── closeTab ───────────────────────────────────────────────────────
  //
  // Close a tab by index (default: active tab). Cannot close the last
  // remaining tab. If closing the active tab, switches to the previous
  // tab or the first available one.

  async closeTab(session: Session, tabIndex?: number): Promise<Page> {
    this.pruneClosedPages(session);

    const { pages, activePageIndex } = ensureInitialized(session);
    const count = pages.length;

    if (count <= 1) {
      throw new Error("Cannot close the last remaining tab.");
    }

    // Default to active tab if no index specified
    const targetIndex = tabIndex ?? activePageIndex;

    if (targetIndex < 0 || targetIndex >= count) {
      throw new Error(
        `Tab index ${targetIndex} out of bounds. Valid range: 0-${count - 1}.`
      );
    }

    const targetPage = pages[targetIndex];

    // Remove from array first (before closing, to handle race conditions)
    pages.splice(targetIndex, 1);

    // Determine new active index
    if (targetIndex === activePageIndex) {
      // Closing the active tab — prefer previous tab, clamp to valid range
      session.activePageIndex = Math.min(
        Math.max(targetIndex - 1, 0),
        pages.length - 1
      );
    } else if (targetIndex < activePageIndex) {
      // Closing a tab before the active one — adjust index to keep same page active
      session.activePageIndex = activePageIndex - 1;
    }
    // If closing a tab after the active one, activePageIndex stays the same

    // Close the page (async, may throw if already closed)
    try {
      await targetPage.close();
    } catch {
      // Page may already be closed — safe to ignore
    }

    const newActivePage = pages[session.activePageIndex!];

    // Keep session.page in sync
    session.page = newActivePage;

    // Bring the new active page to front
    newActivePage.bringToFront().catch(() => {});

    return newActivePage;
  }

  // ── waitFor ────────────────────────────────────────────────────────
  //
  // Unified smart wait supporting multiple condition types:
  // - element: wait for a CSS selector or @eN ref to be visible
  // - text: wait for text content to appear (optionally scoped to target)
  // - network_idle: wait for network to settle
  // - navigation: wait for URL to match a pattern
  // - js: wait for a JS expression to return truthy

  async waitFor(
    page: Page,
    session: Session,
    condition: WaitCondition
  ): Promise<void> {
    const timeout = Math.min(
      condition.timeout ?? DEFAULT_WAIT_TIMEOUT,
      MAX_WAIT_TIMEOUT
    );

    // Resolve @eN refs to selectors
    const resolveTarget = (ref: string): string => {
      if (ref.startsWith("@e")) {
        const selector = session.refMap.get(ref);
        if (!selector) {
          throw new Error(
            `Ref ${ref} not found. Take a fresh snapshot first.`
          );
        }
        return selector;
      }
      return ref;
    };

    switch (condition.type) {
      case "element": {
        if (!condition.target) {
          throw new Error("'element' wait requires a target (CSS selector or @eN ref).");
        }
        const selector = resolveTarget(condition.target);
        await page.locator(selector).waitFor({ state: "visible", timeout });
        break;
      }

      case "text": {
        if (!condition.text) {
          throw new Error("'text' wait requires a text string.");
        }
        if (condition.target) {
          // Scoped to a specific element
          const selector = resolveTarget(condition.target);
          await page
            .locator(selector)
            .getByText(condition.text)
            .waitFor({ timeout });
        } else {
          // Page-level text search
          await page.getByText(condition.text).waitFor({ timeout });
        }
        break;
      }

      case "network_idle": {
        await page.waitForLoadState("networkidle", { timeout });
        break;
      }

      case "navigation": {
        const urlPattern = condition.text || "**";
        await page.waitForURL(urlPattern, { timeout });
        break;
      }

      case "js": {
        if (!condition.js) {
          throw new Error("'js' wait requires a js expression.");
        }
        await page.waitForFunction(condition.js, undefined, { timeout });
        break;
      }

      default: {
        const _exhaustive: never = condition.type;
        throw new Error(`Unknown wait condition type: ${_exhaustive}`);
      }
    }
  }

  // ── Internal: pruneClosedPages ─────────────────────────────────────
  //
  // Remove closed pages from session.pages and adjust activePageIndex.
  // Called before any read/write operation on the pages array.

  private pruneClosedPages(session: Session): void {
    const { pages, activePageIndex } = ensureInitialized(session);

    const activePage =
      activePageIndex >= 0 && activePageIndex < pages.length
        ? pages[activePageIndex]
        : null;

    // Filter out closed pages
    const openPages = pages.filter((p) => !p.isClosed());

    if (openPages.length === pages.length) {
      // Nothing was pruned
      return;
    }

    session.pages = openPages;

    if (openPages.length === 0) {
      // All pages closed — this is a degenerate state, nothing we can do
      session.activePageIndex = 0;
      return;
    }

    // Try to keep the same active page
    if (activePage && !activePage.isClosed()) {
      const newIndex = openPages.indexOf(activePage);
      session.activePageIndex = newIndex >= 0 ? newIndex : 0;
    } else {
      // Active page was closed — fall back to last available page
      session.activePageIndex = openPages.length - 1;
    }

    // Keep session.page in sync
    session.page = openPages[session.activePageIndex!];
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────

/** Singleton instance for use across the server */
export const tabManager = new TabManager();

export default TabManager;
