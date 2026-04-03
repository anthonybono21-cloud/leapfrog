// ─── Pagination Extraction ────────────────────────────────────────────────
//
// Single-call tool that handles the full pagination loop: click-next,
// infinite scroll, or URL-pattern iteration. Extracts content from each
// page and returns a combined result. Replaces 3-4 tool calls per page
// with one `paginate` invocation.
//
// Does NOT call HarnessIntelligence.capturePreState/analyzePostAction per
// iteration (would trigger loop detection). Records ONE summary
// recordToolCall at the end.

import type { Page } from "playwright-core";
import type { Session } from "./types.js";
import { logger } from "./logger.js";
import { HarnessIntelligence } from "./harness-intelligence.js";
import { PageClassifier } from "./page-classifier.js";
import { isHumanizeEnabled, humanDelay, sleep } from "./humanize-utils.js";
import { humanMouse } from "./humanize-mouse.js";
import { humanScroll } from "./humanize-scroll.js";
import { thinkPause } from "./humanize-pause.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface PaginateOptions {
  extractType: "text" | "html" | "js";
  extractTarget?: string;      // CSS selector to scope extraction
  extractJs?: string;          // JS expression for type='js'
  nextSelector: string;        // CSS selector or 'auto'
  paginationType: "click" | "scroll" | "url";
  urlPattern?: string;         // for type='url': pattern with {page} placeholder
  maxPages: number;            // 1-50, default 10
  delayMs: number;             // between pages, default 1000
  maxCharsPerPage: number;     // default 5000
  stopWhen: "no_next" | "empty" | "duplicate" | "auto";
}

export interface PaginatePageResult {
  pageNum: number;
  url: string;
  data: string;
  tokens: number;
}

export interface PaginateMetadata {
  totalPages: number;
  stoppedBecause: "no_next" | "empty" | "duplicate" | "max_pages" | "error" | "blocked";
  totalChars: number;
  urls: string[];
  duration: number;
}

export interface PaginateResult {
  pages: PaginatePageResult[];
  metadata: PaginateMetadata;
}

// ─── Constants ────────────────────────────────────────────────────────────

const MAX_TOTAL_CHARS = 100_000;
const EMPTY_THRESHOLD = 50;
const SCROLL_WAIT_TIMEOUT = 10_000;
const SCROLL_MAX_STALE = 2;

// ─── Next-button auto-detection patterns ──────────────────────────────────

const NEXT_TEXT_PATTERNS: RegExp[] = [
  /^next$/i,
  /^next\s*page$/i,
  /^next\s*>$/i,
  /^>$/,
  /^›$/,
  /^»$/,
];

const LOAD_MORE_PATTERNS: RegExp[] = [
  /load\s*more/i,
  /show\s*more/i,
];

// ─── djb2 hash (same as harness-intelligence.ts) ─────────────────────────

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

// ─── Token estimation ─────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  // ~4 chars per token, rough estimate
  return Math.ceil(text.length / 4);
}

// ─── Extract content from page ────────────────────────────────────────────

async function extractContent(
  page: Page,
  opts: Pick<PaginateOptions, "extractType" | "extractTarget" | "extractJs" | "maxCharsPerPage">,
): Promise<string> {
  let result: string;

  switch (opts.extractType) {
    case "js": {
      if (!opts.extractJs) throw new Error("extractType='js' requires extractJs expression");
      const val = await Promise.race([
        page.evaluate(opts.extractJs),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("JS eval timed out (10s)")), 10_000),
        ),
      ]);
      if (val === undefined || val === null) {
        result = String(val);
      } else {
        result = typeof val === "string" ? val : JSON.stringify(val, null, 2);
      }
      break;
    }
    case "html": {
      if (opts.extractTarget) {
        result = await page.locator(opts.extractTarget).innerHTML();
      } else {
        result = await page.content();
      }
      break;
    }
    case "text":
    default: {
      if (opts.extractTarget) {
        result = await page.locator(opts.extractTarget).evaluate((node: Element) => {
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
  }

  if (result.length > opts.maxCharsPerPage) {
    result = result.substring(0, opts.maxCharsPerPage) + "\n... (truncated)";
  }

  return result;
}

// ─── Auto-detect next button ──────────────────────────────────────────────

/**
 * Searches the page for a pagination "next" control using a priority-ordered
 * set of heuristics. Returns a Playwright locator selector string or null.
 */
async function autoDetectNext(page: Page): Promise<string | null> {
  // Run all detection in a single page.evaluate to minimize round-trips
  const selector = await page.evaluate(() => {
    // Helper: check if element is visible and enabled
    function isClickable(el: Element): boolean {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
      if ((el as HTMLButtonElement).disabled) return false;
      if (el.getAttribute("aria-disabled") === "true") return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      return true;
    }

    // Helper: build a CSS selector path for an element
    function selectorFor(el: Element): string {
      // Prefer data-testid or id
      if (el.id) return `#${CSS.escape(el.id)}`;
      const testId = el.getAttribute("data-testid");
      if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

      // Build nth-of-type path
      const parts: string[] = [];
      let current: Element | null = el;
      while (current && current !== document.documentElement) {
        const cur: Element = current;
        const tag = cur.tagName.toLowerCase();
        const parentEl = cur.parentElement;
        if (parentEl) {
          const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === cur.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            parts.unshift(`${tag}:nth-of-type(${idx})`);
          } else {
            parts.unshift(tag);
          }
        } else {
          parts.unshift(tag);
        }
        current = parentEl;
      }
      return parts.join(" > ");
    }

    // 1. a, button with matching text
    const textPatterns = [
      /^next$/i,
      /^next\s*page$/i,
      /^next\s*>$/i,
      /^>$/,
      /^›$/,
      /^»$/,
    ];
    const candidates = document.querySelectorAll("a, button");
    for (const el of candidates) {
      const text = (el.textContent ?? "").trim();
      for (const pat of textPatterns) {
        if (pat.test(text) && isClickable(el)) {
          return selectorFor(el);
        }
      }
    }

    // 2. Element with [aria-label*="next" i]
    const ariaNext = document.querySelector('[aria-label*="next" i]:is(a, button, [role="button"], [role="link"])');
    if (ariaNext && isClickable(ariaNext)) {
      return selectorFor(ariaNext);
    }

    // 3. link[rel="next"]
    const relNext = document.querySelector('link[rel="next"]') as HTMLLinkElement | null;
    if (relNext?.href) {
      // Return the href as a special marker — the caller uses goto instead of click
      return `__href__:${relNext.href}`;
    }

    // 4. Inside pagination containers — find the "next" link
    const paginationContainers = document.querySelectorAll(
      'nav, [role="navigation"], .pagination, [aria-label*="pagination" i], .pager, .paginator, [class*="pagination"]'
    );
    for (const container of paginationContainers) {
      const links = container.querySelectorAll("a, button");
      for (const el of links) {
        const text = (el.textContent ?? "").trim();
        // Look for next-like text or arrow characters
        if (/next/i.test(text) || /^[>›»→]$/.test(text) || /^[>›»→]\s/i.test(text)) {
          if (isClickable(el)) {
            return selectorFor(el);
          }
        }
      }
      // Also check for aria-label on links within pagination
      const ariaLinks = container.querySelectorAll('[aria-label*="next" i]');
      for (const el of ariaLinks) {
        if (isClickable(el)) {
          return selectorFor(el);
        }
      }
    }

    // 5. "Load more" / "Show more" buttons
    const loadMorePatterns = [/load\s*more/i, /show\s*more/i];
    const allButtons = document.querySelectorAll("a, button, [role='button']");
    for (const el of allButtons) {
      const text = (el.textContent ?? "").trim();
      for (const pat of loadMorePatterns) {
        if (pat.test(text) && isClickable(el)) {
          return selectorFor(el);
        }
      }
    }

    return null;
  });

  return selector;
}

// ─── Check if next button is disabled ─────────────────────────────────────

async function isNextDisabled(page: Page, selector: string): Promise<boolean> {
  try {
    return await page.locator(selector).evaluate((el: Element) => {
      if ((el as HTMLButtonElement).disabled) return true;
      if (el.getAttribute("aria-disabled") === "true") return true;
      if (el.classList.contains("disabled")) return true;
      return false;
    });
  } catch {
    return false;
  }
}

// ─── Check for challenge/blocked page ─────────────────────────────────────

function isBlockedOrChallenge(url: string, content: string): boolean {
  try {
    const result = PageClassifier.classify({ url, snapshotText: content });
    return result.type === "challenge";
  } catch {
    // Fallback: quick keyword check
    const lower = content.toLowerCase();
    const blocked = [
      "captcha", "verify you're human", "verify you are human",
      "access denied", "security check", "bot detection",
    ];
    return blocked.some(kw => lower.includes(kw));
  }
}

// ─── Click with humanization ──────────────────────────────────────────────

async function clickElement(page: Page, selector: string): Promise<void> {
  if (isHumanizeEnabled()) {
    await thinkPause.beforeAction("click");
    try {
      const box = await page.locator(selector).boundingBox({ timeout: 5000 });
      if (box) {
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        await humanMouse.humanClick(page, cx, cy);
        return;
      }
    } catch {
      // Fall through to normal click
    }
  }
  await page.locator(selector).click({ timeout: 5000 });
}

// ─── Humanized delay ──────────────────────────────────────────────────────

async function paginateDelay(delayMs: number): Promise<void> {
  if (isHumanizeEnabled()) {
    // Add Gaussian jitter: +/- 30% of requested delay
    const jitter = humanDelay(
      Math.round(delayMs * 0.7),
      Math.round(delayMs * 1.3),
    );
    await sleep(jitter);
  } else {
    await sleep(delayMs);
  }
}

// ─── Wait for navigation or DOM change ────────────────────────────────────

async function waitForPageChange(page: Page, urlBefore: string): Promise<"navigation" | "dom_change" | "timeout"> {
  // Wait for either URL change or DOM mutation
  try {
    await Promise.race([
      // URL change (full navigation)
      page.waitForURL((url) => url.toString() !== urlBefore, { timeout: 10_000 }).then(() => "navigation" as const),
      // DOM change (SPA pagination) — wait for network idle as a proxy
      page.waitForLoadState("networkidle", { timeout: 10_000 }).then(() => "dom_change" as const),
    ]);
  } catch {
    // Timeout — check if URL changed anyway
    if (page.url() !== urlBefore) return "navigation";
    return "timeout";
  }

  return page.url() !== urlBefore ? "navigation" : "dom_change";
}

// ─── Click-next pagination ────────────────────────────────────────────────

async function paginateClick(
  page: Page,
  session: Session,
  opts: PaginateOptions,
): Promise<PaginateResult> {
  const startTime = Date.now();
  const pages: PaginatePageResult[] = [];
  const urls: string[] = [];
  let totalChars = 0;
  let stoppedBecause: PaginateMetadata["stoppedBecause"] = "max_pages";
  let prevHash = "";

  for (let i = 0; i < opts.maxPages; i++) {
    const currentUrl = page.url();
    urls.push(currentUrl);

    // Extract content from current page
    let data: string;
    try {
      data = await extractContent(page, opts);
    } catch (e: any) {
      logger.warn("paginate:extract_error", { page: i + 1, error: e.message });
      stoppedBecause = "error";
      break;
    }

    const contentHash = djb2(data);

    // Check stop conditions
    if (opts.stopWhen === "duplicate" || opts.stopWhen === "auto") {
      if (contentHash === prevHash && i > 0) {
        stoppedBecause = "duplicate";
        break;
      }
    }

    if (opts.stopWhen === "empty" || opts.stopWhen === "auto") {
      if (data.length < EMPTY_THRESHOLD) {
        stoppedBecause = "empty";
        break;
      }
    }

    // Check for blocked/challenge
    if (opts.stopWhen === "auto") {
      if (isBlockedOrChallenge(currentUrl, data)) {
        stoppedBecause = "blocked";
        break;
      }
    }

    // Enforce total char cap
    if (totalChars + data.length > MAX_TOTAL_CHARS) {
      data = data.substring(0, MAX_TOTAL_CHARS - totalChars) + "\n... (total cap reached)";
    }

    pages.push({
      pageNum: i + 1,
      url: currentUrl,
      data,
      tokens: estimateTokens(data),
    });
    totalChars += data.length;
    prevHash = contentHash;

    if (totalChars >= MAX_TOTAL_CHARS) {
      stoppedBecause = "max_pages";
      break;
    }

    // Last page — don't try to navigate further
    if (i === opts.maxPages - 1) break;

    // Find the next button
    let nextSelector: string | null;
    if (opts.nextSelector === "auto") {
      nextSelector = await autoDetectNext(page);
    } else {
      // Check if the specified selector exists and is clickable
      try {
        const count = await page.locator(opts.nextSelector).count();
        nextSelector = count > 0 ? opts.nextSelector : null;
      } catch {
        nextSelector = null;
      }
    }

    if (!nextSelector) {
      stoppedBecause = "no_next";
      break;
    }

    // Handle link[rel="next"] — navigate to href instead of clicking
    if (nextSelector.startsWith("__href__:")) {
      const href = nextSelector.slice("__href__:".length);
      const urlBefore = page.url();
      try {
        await page.goto(href, { waitUntil: "load", timeout: 15_000 });
      } catch (e: any) {
        logger.warn("paginate:goto_error", { page: i + 1, href, error: e.message });
        stoppedBecause = "error";
        break;
      }
      await paginateDelay(opts.delayMs);
      continue;
    }

    // Check if next button is disabled
    if (await isNextDisabled(page, nextSelector)) {
      stoppedBecause = "no_next";
      break;
    }

    // Click the next button
    const urlBefore = page.url();
    try {
      await clickElement(page, nextSelector);
    } catch (e: any) {
      logger.warn("paginate:click_error", { page: i + 1, selector: nextSelector, error: e.message });
      stoppedBecause = "error";
      break;
    }

    // Wait for page change
    const changeType = await waitForPageChange(page, urlBefore);
    logger.debug("paginate:page_change", { page: i + 1, changeType, url: page.url() });

    // For SPA pagination, give DOM a moment to settle
    if (changeType === "dom_change" || changeType === "timeout") {
      await sleep(500);
    }

    await paginateDelay(opts.delayMs);
  }

  const duration = Date.now() - startTime;
  return {
    pages,
    metadata: {
      totalPages: pages.length,
      stoppedBecause,
      totalChars,
      urls: [...new Set(urls)],
      duration,
    },
  };
}

// ─── Infinite scroll pagination ───────────────────────────────────────────

async function paginateScroll(
  page: Page,
  session: Session,
  opts: PaginateOptions,
): Promise<PaginateResult> {
  const startTime = Date.now();
  const pages: PaginatePageResult[] = [];
  const urls: string[] = [];
  let totalChars = 0;
  let stoppedBecause: PaginateMetadata["stoppedBecause"] = "max_pages";
  let prevHash = "";
  let staleCount = 0;

  for (let i = 0; i < opts.maxPages; i++) {
    const currentUrl = page.url();
    if (!urls.includes(currentUrl)) urls.push(currentUrl);

    // Extract content
    let data: string;
    try {
      data = await extractContent(page, opts);
    } catch (e: any) {
      logger.warn("paginate:scroll_extract_error", { page: i + 1, error: e.message });
      stoppedBecause = "error";
      break;
    }

    const contentHash = djb2(data);

    // Check for stale content (same hash after scroll)
    if (contentHash === prevHash && i > 0) {
      staleCount++;
      if (staleCount >= SCROLL_MAX_STALE) {
        stoppedBecause = "duplicate";
        break;
      }
      // Try one more scroll before giving up
    } else {
      staleCount = 0;
    }

    // Check empty
    if (opts.stopWhen === "empty" || opts.stopWhen === "auto") {
      if (data.length < EMPTY_THRESHOLD && i > 0) {
        stoppedBecause = "empty";
        break;
      }
    }

    // Check blocked
    if (opts.stopWhen === "auto") {
      if (isBlockedOrChallenge(currentUrl, data)) {
        stoppedBecause = "blocked";
        break;
      }
    }

    // Enforce total char cap
    if (totalChars + data.length > MAX_TOTAL_CHARS) {
      data = data.substring(0, MAX_TOTAL_CHARS - totalChars) + "\n... (total cap reached)";
    }

    // Only add page if content is new (avoid duplicates from stale scrolls)
    if (contentHash !== prevHash || i === 0) {
      pages.push({
        pageNum: pages.length + 1,
        url: currentUrl,
        data,
        tokens: estimateTokens(data),
      });
      totalChars += data.length;
    }
    prevHash = contentHash;

    if (totalChars >= MAX_TOTAL_CHARS) break;

    // Last iteration — don't scroll further
    if (i === opts.maxPages - 1) break;

    // Get current scroll height before scrolling
    const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);

    // Scroll down
    if (isHumanizeEnabled()) {
      await thinkPause.beforeAction("scroll");
      await humanScroll.scroll(page, 800);
    } else {
      await page.mouse.wheel(0, 800);
    }

    // Wait for new content to load (check if scroll height increased)
    try {
      await page.waitForFunction(
        (prevHeight: number) => document.documentElement.scrollHeight > prevHeight,
        heightBefore,
        { timeout: SCROLL_WAIT_TIMEOUT },
      );
    } catch {
      // No new content loaded — the page might be done, or content loaded without
      // changing scroll height. Extract again on next iteration to check hash.
      logger.debug("paginate:scroll_no_height_change", { page: i + 1 });
    }

    await paginateDelay(opts.delayMs);
  }

  const duration = Date.now() - startTime;
  return {
    pages,
    metadata: {
      totalPages: pages.length,
      stoppedBecause,
      totalChars,
      urls,
      duration,
    },
  };
}

// ─── URL-pattern pagination ───────────────────────────────────────────────

async function paginateUrl(
  page: Page,
  session: Session,
  opts: PaginateOptions,
): Promise<PaginateResult> {
  const startTime = Date.now();
  const pages: PaginatePageResult[] = [];
  const urls: string[] = [];
  let totalChars = 0;
  let stoppedBecause: PaginateMetadata["stoppedBecause"] = "max_pages";
  let prevHash = "";

  if (!opts.urlPattern) {
    throw new Error("paginationType='url' requires urlPattern with {page} placeholder");
  }

  for (let i = 1; i <= opts.maxPages; i++) {
    const url = opts.urlPattern.replace(/\{page\}/g, String(i));
    urls.push(url);

    // Navigate to the URL
    try {
      await page.goto(url, { waitUntil: "load", timeout: 15_000 });
    } catch (e: any) {
      logger.warn("paginate:url_goto_error", { page: i, url, error: e.message });
      stoppedBecause = "error";
      break;
    }

    // Small settle time for JS rendering
    await sleep(300);

    // Extract content
    let data: string;
    try {
      data = await extractContent(page, opts);
    } catch (e: any) {
      logger.warn("paginate:url_extract_error", { page: i, error: e.message });
      stoppedBecause = "error";
      break;
    }

    const contentHash = djb2(data);

    // Check empty
    if (data.length < EMPTY_THRESHOLD) {
      stoppedBecause = "empty";
      break;
    }

    // Check duplicate
    if (opts.stopWhen === "duplicate" || opts.stopWhen === "auto") {
      if (contentHash === prevHash) {
        stoppedBecause = "duplicate";
        break;
      }
    }

    // Check blocked
    if (opts.stopWhen === "auto") {
      if (isBlockedOrChallenge(url, data)) {
        stoppedBecause = "blocked";
        break;
      }
    }

    // Enforce total char cap
    if (totalChars + data.length > MAX_TOTAL_CHARS) {
      data = data.substring(0, MAX_TOTAL_CHARS - totalChars) + "\n... (total cap reached)";
    }

    pages.push({
      pageNum: i,
      url,
      data,
      tokens: estimateTokens(data),
    });
    totalChars += data.length;
    prevHash = contentHash;

    if (totalChars >= MAX_TOTAL_CHARS) break;

    // Don't delay after the last page
    if (i < opts.maxPages) {
      await paginateDelay(opts.delayMs);
    }
  }

  const duration = Date.now() - startTime;
  return {
    pages,
    metadata: {
      totalPages: pages.length,
      stoppedBecause,
      totalChars,
      urls,
      duration,
    },
  };
}

// ─── Main paginate function ───────────────────────────────────────────────

/**
 * Execute a full pagination loop in a single call.
 *
 * Supports three pagination strategies:
 * - **click**: Finds and clicks a "next" button each iteration
 * - **scroll**: Infinite-scroll with height-change detection
 * - **url**: Iterates through URL patterns with {page} placeholder
 *
 * Returns extracted content from each page plus metadata about the run.
 */
export async function paginate(
  page: Page,
  session: Session,
  opts: PaginateOptions,
): Promise<PaginateResult> {
  const startTime = Date.now();

  logger.info("paginate:start", {
    sessionId: session.id,
    type: opts.paginationType,
    maxPages: opts.maxPages,
    nextSelector: opts.nextSelector,
    extractType: opts.extractType,
  });

  let result: PaginateResult;

  try {
    switch (opts.paginationType) {
      case "scroll":
        result = await paginateScroll(page, session, opts);
        break;
      case "url":
        result = await paginateUrl(page, session, opts);
        break;
      case "click":
      default:
        result = await paginateClick(page, session, opts);
        break;
    }
  } catch (e: any) {
    logger.error("paginate:fatal", { sessionId: session.id, error: e.message });
    result = {
      pages: [],
      metadata: {
        totalPages: 0,
        stoppedBecause: "error",
        totalChars: 0,
        urls: [page.url()],
        duration: Date.now() - startTime,
      },
    };
  }

  // Record ONE summary tool call (avoids loop detection)
  const duration = Date.now() - startTime;
  HarnessIntelligence.recordToolCall(
    session.id,
    "paginate",
    {
      paginationType: opts.paginationType,
      maxPages: opts.maxPages,
      extractType: opts.extractType,
    },
    `${result.metadata.totalPages} pages extracted, ${result.metadata.totalChars} chars, stopped: ${result.metadata.stoppedBecause}`,
    duration,
  );

  logger.info("paginate:done", {
    sessionId: session.id,
    totalPages: result.metadata.totalPages,
    totalChars: result.metadata.totalChars,
    stoppedBecause: result.metadata.stoppedBecause,
    duration,
  });

  return result;
}
