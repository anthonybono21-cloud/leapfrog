// ─── Adaptive Wait & Auto-Retry Stealth Escalation ──────────────────────────
//
// Replaces the naive page.goto() call in the navigate tool with intelligent
// wait-strategy selection and automatic stealth escalation when sites block.
//
// Adaptive Wait: tries up to 3 waitUntil strategies based on page quality.
// Stealth Escalation: 5 levels of retry when pages are BLOCKED/CHALLENGE.
//
// This module is the single entry point — call adaptiveNavigate() from index.ts.

import type { Page } from "playwright-core";
import type { Session, SnapshotResult } from "./types.js";
import { PageClassifier, type ClassificationResult } from "./page-classifier.js";
import { SnapshotEngine } from "./snapshot-engine.js";
import { sleep, humanDelay } from "./humanize-utils.js";
import { logger } from "./logger.js";
import type { SessionManager } from "./session-manager.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SNAPSHOT_CHARS = 10000;

/** Minimum interactive elements for a page to be considered GOOD */
const GOOD_ELEMENT_THRESHOLD = 3;

/** Max wait-strategy retries before giving up on wait adaptation */
const MAX_WAIT_RETRIES = 2;

/** Default timeout for networkidle fallback (ms) */
const NETWORKIDLE_TIMEOUT = 10_000;

/** Default timeout for domcontentloaded fallback (ms) */
const DCP_TIMEOUT = 10_000;

type WaitStrategy = "load" | "domcontentloaded" | "networkidle";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdaptiveNavigateOptions {
  /** Wait strategy to start with. Default: "load" */
  waitUntil?: WaitStrategy;
  /** Enable auto-retry stealth escalation. Default: true */
  autoRetry?: boolean;
  /** Max escalation level (0-5). Default: 3 */
  maxRetryLevel?: number;
}

export type PageQuality = "GOOD" | "EMPTY" | "TIMEOUT" | "BLOCKED";

export interface AdaptiveNavigateResult {
  /** The snapshot result from the best attempt */
  snapshot: SnapshotResult;
  /** Page classification */
  classification: ClassificationResult;
  /** Final page URL after navigation */
  url: string;
  /** Page title */
  title: string;
  /** The page quality assessment */
  quality: PageQuality;
  /** Which waitUntil strategy succeeded */
  finalStrategy: WaitStrategy;
  /** Escalation metadata if stealth retries were used */
  escalation?: EscalationMeta;
  /** The session that owns the page (may change if session was rotated) */
  session: Session;
  /** The page instance (may change if session was rotated) */
  page: Page;
}

export interface EscalationMeta {
  /** Level at which navigation succeeded (0-5) */
  level: number;
  /** Human-readable label for the level */
  label: string;
  /** Total retries attempted */
  attempts: number;
  /** Whether the session was rotated (Level 3+) */
  sessionRotated: boolean;
  /** New session ID if rotated */
  newSessionId?: string;
}

// ─── Snapshot engine singleton ───────────────────────────────────────────────

const snapEngine = new SnapshotEngine();

// ─── Page Quality Assessment ─────────────────────────────────────────────────

/**
 * Evaluate page quality after navigation.
 * Takes a snapshot and classifies the page to determine if it loaded correctly.
 */
async function assessPageQuality(
  page: Page,
  session: Session,
): Promise<{
  quality: PageQuality;
  snapshot: SnapshotResult;
  classification: ClassificationResult;
}> {
  const snapshot = await snapEngine.snapshot(page, session, {
    interactiveOnly: true,
    maxChars: MAX_SNAPSHOT_CHARS,
  });

  const url = page.url();

  // Grab meta for better classification
  let meta: {
    ogType?: string;
    jsonLdType?: string;
    robots?: string;
    description?: string;
  } | undefined;
  try {
    meta = await page.evaluate(() => {
      const og =
        document
          .querySelector('meta[property="og:type"]')
          ?.getAttribute("content") ?? undefined;
      const desc =
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") ?? undefined;
      const robots =
        document
          .querySelector('meta[name="robots"]')
          ?.getAttribute("content") ?? undefined;
      let jsonLdType: string | undefined;
      const ld = document.querySelector('script[type="application/ld+json"]');
      if (ld) {
        try {
          const parsed = JSON.parse(ld.textContent ?? "");
          jsonLdType = parsed["@type"];
        } catch {
          /* */
        }
      }
      return { ogType: og, jsonLdType, robots, description: desc };
    });
  } catch {
    /* meta extraction is best-effort */
  }

  const classification = PageClassifier.classify({
    url,
    snapshotText: snapshot.text,
    meta,
  });

  // Determine quality
  let quality: PageQuality;

  if (
    classification.type === "challenge" ||
    isBlockedSnapshot(snapshot.text)
  ) {
    quality = "BLOCKED";
  } else if (snapshot.nodeCount >= GOOD_ELEMENT_THRESHOLD) {
    quality = "GOOD";
  } else {
    quality = "EMPTY";
  }

  return { quality, snapshot, classification };
}

/**
 * Lightweight blocked-page check on snapshot text.
 * Mirrors the logic from harness-intelligence.ts isBlockedPage().
 */
function isBlockedSnapshot(snapshotText: string): boolean {
  const lower = snapshotText.toLowerCase();
  const elementCount = (snapshotText.match(/^[ \t]*@e\d+/gm) ?? []).length;

  const STRONG_KEYWORDS = [
    "captcha",
    "verify you're human",
    "verify you are human",
    "access denied",
    "has been denied",
    "security check",
    "bot detection",
    "bot or not",
    "show us your human side",
    "prove you're not a robot",
    "i'm not a robot",
    "unusual traffic",
    "press & hold",
    "press and hold",
  ];

  const WEAK_KEYWORDS = [
    "challenge",
    "cloudflare",
    "please wait",
    "checking your browser",
    "just a moment",
    "blocked",
  ];

  const THRESHOLD = 50;

  const hasStrong = STRONG_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasStrong && elementCount <= THRESHOLD) return true;

  const hasWeak = WEAK_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasWeak && elementCount < THRESHOLD) return true;

  return false;
}

// ─── Post-navigation cleanup ─────────────────────────────────────────────────

/**
 * Clean up navigator.webdriver after goto.
 * Playwright re-adds it via CDP after init scripts, so we must nuke it post-nav.
 */
async function cleanWebdriver(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      try {
        delete (Object.getPrototypeOf(navigator) as any).webdriver;
        delete (Navigator.prototype as any).webdriver;
        delete (navigator as any).webdriver;
      } catch {
        /* non-configurable or already deleted */
      }
    });
  } catch {
    /* page may have navigated away */
  }
}

// ─── Adaptive Wait Logic ─────────────────────────────────────────────────────

/**
 * Navigate with adaptive wait strategy selection.
 * Tries the requested strategy, evaluates page quality, and falls back
 * to alternative strategies if the page is empty or timed out.
 *
 * Returns the best result after up to MAX_WAIT_RETRIES additional attempts.
 */
async function navigateWithAdaptiveWait(
  page: Page,
  session: Session,
  url: string,
  startStrategy: WaitStrategy,
): Promise<{
  quality: PageQuality;
  snapshot: SnapshotResult;
  classification: ClassificationResult;
  finalStrategy: WaitStrategy;
}> {
  let currentStrategy = startStrategy;
  let bestResult: {
    quality: PageQuality;
    snapshot: SnapshotResult;
    classification: ClassificationResult;
    finalStrategy: WaitStrategy;
  } | null = null;

  const triedStrategies = new Set<WaitStrategy>();
  let retries = 0;

  while (retries <= MAX_WAIT_RETRIES) {
    triedStrategies.add(currentStrategy);

    let timedOut = false;

    try {
      const timeout =
        currentStrategy === "networkidle"
          ? NETWORKIDLE_TIMEOUT
          : currentStrategy === "domcontentloaded"
            ? DCP_TIMEOUT
            : 30_000;

      await page.goto(url, { waitUntil: currentStrategy, timeout });
      await cleanWebdriver(page);
    } catch (e: any) {
      // Check if this was a timeout
      if (
        e.message?.includes("Timeout") ||
        e.message?.includes("timeout") ||
        e.name === "TimeoutError"
      ) {
        timedOut = true;
        logger.debug("adaptive-wait:timeout", {
          strategy: currentStrategy,
          url,
          retries,
        });
        // Still evaluate the page — it may have partially loaded
        await cleanWebdriver(page);
      } else {
        // Non-timeout error — rethrow
        throw e;
      }
    }

    // Assess page quality
    const assessment = await assessPageQuality(page, session);
    const result = { ...assessment, finalStrategy: currentStrategy };

    // Track the best result (prefer GOOD > EMPTY > TIMEOUT > BLOCKED)
    if (
      !bestResult ||
      qualityRank(result.quality) > qualityRank(bestResult.quality) ||
      (qualityRank(result.quality) === qualityRank(bestResult.quality) &&
        result.snapshot.nodeCount > bestResult.snapshot.nodeCount)
    ) {
      bestResult = result;
    }

    // Decision matrix
    if (result.quality === "GOOD") {
      logger.debug("adaptive-wait:good", {
        strategy: currentStrategy,
        elements: result.snapshot.nodeCount,
      });
      return result;
    }

    if (result.quality === "BLOCKED") {
      // Wait strategy won't help with blocking — return immediately
      logger.debug("adaptive-wait:blocked", {
        strategy: currentStrategy,
        classification: result.classification.type,
      });
      return result;
    }

    // EMPTY or TIMEOUT — pick next strategy
    let nextStrategy: WaitStrategy | null = null;

    if (timedOut || result.quality === "EMPTY") {
      if (currentStrategy === "load" && !triedStrategies.has("networkidle")) {
        nextStrategy = "networkidle";
      } else if (
        (currentStrategy === "networkidle" || timedOut) &&
        !triedStrategies.has("domcontentloaded")
      ) {
        nextStrategy = "domcontentloaded";
      } else if (
        currentStrategy === "domcontentloaded" &&
        !triedStrategies.has("load")
      ) {
        nextStrategy = "load";
      }
    }

    if (!nextStrategy) {
      // No more strategies to try
      logger.debug("adaptive-wait:exhausted", {
        strategy: currentStrategy,
        quality: result.quality,
        elements: result.snapshot.nodeCount,
      });
      return bestResult!;
    }

    retries++;
    currentStrategy = nextStrategy;
    logger.debug("adaptive-wait:retry", {
      nextStrategy,
      retries,
      previousQuality: result.quality,
    });
  }

  return bestResult!;
}

/** Rank page quality for comparison (higher = better) */
function qualityRank(q: PageQuality): number {
  switch (q) {
    case "GOOD":
      return 4;
    case "EMPTY":
      return 2;
    case "TIMEOUT":
      return 1;
    case "BLOCKED":
      return 0;
  }
}

// ─── Stealth Escalation ──────────────────────────────────────────────────────

const ESCALATION_LABELS: Record<number, string> = {
  0: "Standard",
  1: "Random delay + retry",
  2: "JS challenge wait",
  3: "Fresh session + new fingerprint",
  4: "Fresh session + pre-nav delay",
  5: "Give up",
};

/**
 * Check if a session is a profile/auth session that should not be destroyed.
 */
function isProfileSession(session: Session): boolean {
  return !!(session.profilePath || session.profileName);
}

/**
 * Stealth escalation: progressively more aggressive retry strategies
 * when a page is detected as BLOCKED/CHALLENGE.
 */
async function stealthEscalate(
  page: Page,
  session: Session,
  url: string,
  waitStrategy: WaitStrategy,
  maxLevel: number,
  sessionManager: SessionManager,
): Promise<{
  quality: PageQuality;
  snapshot: SnapshotResult;
  classification: ClassificationResult;
  finalStrategy: WaitStrategy;
  escalation: EscalationMeta;
  session: Session;
  page: Page;
} | null> {
  const isProfile = isProfileSession(session);
  // Profile sessions cap at Level 2 — never destroy auth state
  const effectiveMaxLevel = isProfile ? Math.min(maxLevel, 2) : maxLevel;

  let currentSession = session;
  let currentPage = page;
  let attempts = 0;

  // BUG-2 fix: wrap escalation loop so we can clean up rotated sessions on failure.
  // Without this, an exception after rotation leaves orphan sessions in the pool.
  try {

  for (let level = 1; level <= effectiveMaxLevel && level <= 5; level++) {
    attempts++;

    logger.info("escalation:attempt", {
      level,
      label: ESCALATION_LABELS[level],
      url,
      isProfile,
      sessionId: currentSession.id,
    });

    switch (level) {
      // Level 1: Random delay + retry in same session
      case 1: {
        const delay = 1000 + Math.random() * 2000; // 1-3s
        await sleep(delay);

        try {
          await currentPage.goto(url, { waitUntil: waitStrategy, timeout: 15_000 });
          await cleanWebdriver(currentPage);
        } catch (e: any) {
          if (
            !e.message?.includes("Timeout") &&
            !e.message?.includes("timeout") &&
            e.name !== "TimeoutError"
          ) {
            throw e;
          }
          // Timeout — continue to assess
          await cleanWebdriver(currentPage);
        }

        const assessment = await assessPageQuality(currentPage, currentSession);
        if (assessment.quality !== "BLOCKED") {
          return {
            ...assessment,
            finalStrategy: waitStrategy,
            escalation: {
              level,
              label: ESCALATION_LABELS[level],
              attempts,
              sessionRotated: false,
            },
            session: currentSession,
            page: currentPage,
          };
        }
        break;
      }

      // Level 2: Wait for JS challenge to self-resolve (Cloudflare 5s check)
      case 2: {
        const waitTime = 3000 + Math.random() * 2000; // 3-5s
        await sleep(waitTime);

        // Re-assess without navigating — the JS challenge may have resolved
        const assessment = await assessPageQuality(currentPage, currentSession);
        if (assessment.quality !== "BLOCKED") {
          return {
            ...assessment,
            finalStrategy: waitStrategy,
            escalation: {
              level,
              label: ESCALATION_LABELS[level],
              attempts,
              sessionRotated: false,
            },
            session: currentSession,
            page: currentPage,
          };
        }
        break;
      }

      // Level 3: Fresh session with new fingerprint + humanization
      case 3: {
        // SAFETY: Never destroy profile/auth sessions
        if (isProfile) {
          logger.info("escalation:profile_cap", {
            sessionId: currentSession.id,
            maxLevel: 2,
          });
          break;
        }

        try {
          const rotation = await sessionManager.rotateSession(currentSession.id);
          currentSession = rotation.session;
          currentPage = rotation.page;

          await currentPage.goto(url, { waitUntil: waitStrategy, timeout: 15_000 });
          await cleanWebdriver(currentPage);

          const assessment = await assessPageQuality(currentPage, currentSession);
          if (assessment.quality !== "BLOCKED") {
            return {
              ...assessment,
              finalStrategy: waitStrategy,
              escalation: {
                level,
                label: ESCALATION_LABELS[level],
                attempts,
                sessionRotated: true,
                newSessionId: currentSession.id,
              },
              session: currentSession,
              page: currentPage,
            };
          }
        } catch (e: any) {
          logger.error("escalation:rotate_failed", {
            level,
            error: e.message,
          });
          // Can't rotate — skip to next level or give up
        }
        break;
      }

      // Level 4: Fresh session + pre-navigation delay
      case 4: {
        if (isProfile) break;

        // If we didn't rotate at Level 3 (or it's a new attempt), rotate now
        if (!isProfileSession(currentSession)) {
          try {
            // Only rotate if we haven't already at Level 3
            const needsRotation =
              currentSession.id === session.id || level === 4;
            if (needsRotation) {
              const rotation = await sessionManager.rotateSession(
                currentSession.id,
              );
              currentSession = rotation.session;
              currentPage = rotation.page;
            }
          } catch (e: any) {
            logger.error("escalation:rotate_failed", {
              level,
              error: e.message,
            });
            break;
          }
        }

        // Extended pre-navigation delay: 5-8s
        const preDelay = 5000 + Math.random() * 3000;
        await sleep(preDelay);

        try {
          await currentPage.goto(url, { waitUntil: waitStrategy, timeout: 20_000 });
          await cleanWebdriver(currentPage);

          const assessment = await assessPageQuality(currentPage, currentSession);
          if (assessment.quality !== "BLOCKED") {
            return {
              ...assessment,
              finalStrategy: waitStrategy,
              escalation: {
                level,
                label: ESCALATION_LABELS[level],
                attempts,
                sessionRotated: true,
                newSessionId: currentSession.id,
              },
              session: currentSession,
              page: currentPage,
            };
          }
        } catch (e: any) {
          if (
            !e.message?.includes("Timeout") &&
            !e.message?.includes("timeout") &&
            e.name !== "TimeoutError"
          ) {
            throw e;
          }
          // Timeout — assess anyway
          await cleanWebdriver(currentPage);
          const assessment = await assessPageQuality(currentPage, currentSession);
          if (assessment.quality !== "BLOCKED") {
            return {
              ...assessment,
              finalStrategy: waitStrategy,
              escalation: {
                level,
                label: ESCALATION_LABELS[level],
                attempts,
                sessionRotated: true,
                newSessionId: currentSession.id,
              },
              session: currentSession,
              page: currentPage,
            };
          }
        }
        break;
      }

      // Level 5: Give up
      case 5: {
        // Return null — caller will use the last BLOCKED result
        logger.warn("escalation:gave_up", {
          url,
          attempts,
          sessionId: currentSession.id,
        });
        // Return final assessment with Level 5 metadata
        const assessment = await assessPageQuality(currentPage, currentSession);
        return {
          ...assessment,
          quality: "BLOCKED",
          finalStrategy: waitStrategy,
          escalation: {
            level: 5,
            label: ESCALATION_LABELS[5],
            attempts,
            sessionRotated: currentSession.id !== session.id,
            newSessionId:
              currentSession.id !== session.id
                ? currentSession.id
                : undefined,
          },
          session: currentSession,
          page: currentPage,
        };
      }
    }
  }

  // Exhausted all levels without success — return final blocked state
  const finalAssessment = await assessPageQuality(currentPage, currentSession);
  return {
    ...finalAssessment,
    quality: "BLOCKED",
    finalStrategy: waitStrategy,
    escalation: {
      level: effectiveMaxLevel,
      label:
        isProfile
          ? "Profile session capped at Level 2"
          : ESCALATION_LABELS[effectiveMaxLevel] ?? "Exhausted",
      attempts,
      sessionRotated: currentSession.id !== session.id,
      newSessionId:
        currentSession.id !== session.id ? currentSession.id : undefined,
    },
    session: currentSession,
    page: currentPage,
  };

  } catch (e) {
    // BUG-2 fix: Clean up orphaned rotated session on unexpected failure.
    // If we rotated to a new session but then hit an error, the rotated session
    // would stay in the pool as an orphan that nobody can reference.
    if (currentSession.id !== session.id) {
      logger.warn("escalation:cleanup_orphan", { orphanId: currentSession.id, originalId: session.id });
      sessionManager.destroySession(currentSession.id).catch(() => {});
    }
    throw e;
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Adaptive navigate: replaces the naive page.goto() in the navigate tool.
 *
 * 1. Tries the requested waitUntil strategy
 * 2. Evaluates page quality (snapshot + classification)
 * 3. Retries with alternative strategies if EMPTY/TIMEOUT
 * 4. Escalates with stealth retries if BLOCKED/CHALLENGE
 *
 * Returns a rich result with snapshot, classification, escalation metadata,
 * and the final session/page (which may differ if session was rotated).
 */
export async function adaptiveNavigate(
  page: Page,
  session: Session,
  url: string,
  sessionManager: SessionManager,
  options?: AdaptiveNavigateOptions,
): Promise<AdaptiveNavigateResult> {
  const waitUntil = options?.waitUntil ?? "load";
  const autoRetry = options?.autoRetry ?? true;
  const maxRetryLevel = options?.maxRetryLevel ?? 3;

  // Phase 1: Adaptive wait strategy selection
  const waitResult = await navigateWithAdaptiveWait(
    page,
    session,
    url,
    waitUntil,
  );

  // Update ref nav generation after navigation
  session.refNavGeneration = session.navGeneration ?? 0;

  // If the page is GOOD or not blocked, return immediately
  if (waitResult.quality !== "BLOCKED") {
    const pageUrl = page.url();
    let title = "";
    try {
      title = await page.title();
    } catch {
      /* */
    }

    return {
      snapshot: waitResult.snapshot,
      classification: waitResult.classification,
      url: pageUrl,
      title,
      quality: waitResult.quality,
      finalStrategy: waitResult.finalStrategy,
      session,
      page,
    };
  }

  // Phase 2: Stealth escalation (if enabled and page is BLOCKED)
  if (!autoRetry || maxRetryLevel <= 0) {
    // Auto-retry disabled — return the blocked result
    const pageUrl = page.url();
    let title = "";
    try {
      title = await page.title();
    } catch {
      /* */
    }

    return {
      snapshot: waitResult.snapshot,
      classification: waitResult.classification,
      url: pageUrl,
      title,
      quality: "BLOCKED",
      finalStrategy: waitResult.finalStrategy,
      session,
      page,
    };
  }

  logger.info("adaptive-navigate:escalating", {
    url,
    sessionId: session.id,
    maxLevel: maxRetryLevel,
    isProfile: isProfileSession(session),
  });

  const escalationResult = await stealthEscalate(
    page,
    session,
    url,
    waitResult.finalStrategy,
    maxRetryLevel,
    sessionManager,
  );

  if (escalationResult) {
    const resultSession = escalationResult.session;
    const resultPage = escalationResult.page;

    // Update ref nav generation on the (possibly new) session
    resultSession.refNavGeneration = resultSession.navGeneration ?? 0;

    const pageUrl = resultPage.url();
    let title = "";
    try {
      title = await resultPage.title();
    } catch {
      /* */
    }

    return {
      snapshot: escalationResult.snapshot,
      classification: escalationResult.classification,
      url: pageUrl,
      title,
      quality: escalationResult.quality,
      finalStrategy: escalationResult.finalStrategy,
      escalation: escalationResult.escalation,
      session: resultSession,
      page: resultPage,
    };
  }

  // Escalation returned null (shouldn't happen, but handle gracefully)
  // BUG-2 fix: use the original session/page here — if escalation returned null,
  // no rotation happened so the original is still valid.
  const pageUrl = page.url();
  let title = "";
  try {
    title = await page.title();
  } catch {
    /* */
  }

  return {
    snapshot: waitResult.snapshot,
    classification: waitResult.classification,
    url: pageUrl,
    title,
    quality: "BLOCKED",
    finalStrategy: waitResult.finalStrategy,
    session,
    page,
  };
}

// ─── Output Formatter ────────────────────────────────────────────────────────

/**
 * Format the AdaptiveNavigateResult into the text output for the MCP tool response.
 * Matches the existing navigate output format with optional escalation metadata.
 */
export function formatAdaptiveResult(result: AdaptiveNavigateResult): string {
  const parts: string[] = [];

  // Escalation banner (if any escalation happened)
  if (result.escalation) {
    if (result.quality !== "BLOCKED") {
      parts.push(
        `[ESCALATION] Stealth retry succeeded at Level ${result.escalation.level} (${result.escalation.label}).` +
          (result.escalation.sessionRotated
            ? ` Session rotated to ${result.escalation.newSessionId}.`
            : ""),
      );
    } else {
      parts.push(
        `[BLOCKED] Page blocked after ${result.escalation.attempts} escalation attempts (max Level ${result.escalation.level}).` +
          (isProfileSession(result.session)
            ? " Profile session — escalation capped to protect auth state."
            : " Site may require manual intervention or proxy."),
      );
    }
    parts.push("");
  }

  // Standard navigate output
  parts.push(
    `[${result.session.id}] ${result.title}`,
    result.url,
    `${result.snapshot.nodeCount} elements`,
    "",
    result.snapshot.text,
  );

  // Classification line
  parts.push(
    "",
    `[page: ${result.classification.type} (${Math.round(result.classification.confidence * 100)}%)]`,
  );

  // Wait strategy info (if not the default)
  if (result.finalStrategy !== "load") {
    parts.push(`[wait: ${result.finalStrategy}]`);
  }

  return parts.join("\n");
}
