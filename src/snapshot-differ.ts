import type { SnapshotResult } from "./types.js";
import { logger } from "./logger.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface SnapshotDiff {
  /** Number of changes detected */
  changeCount: number;
  /** Human-readable diff text */
  diffText: string;
  /** Whether this is the first snapshot (no diff available) */
  isFirst: boolean;
  /** Token estimate for the diff vs full snapshot */
  diffTokenEstimate: number;
  fullTokenEstimate: number;
}

// ─── Cache entry ──────────────────────────────────────────────────────────
interface CacheEntry {
  text: string;
  accessedAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────
const MAX_CACHE_SIZE = 100;
const REF_LINE_RE = /^(\s*)(@e\d+)\s+(.*)$/;

// ─── Internal cache ───────────────────────────────────────────────────────
const cache = new Map<string, CacheEntry>();

function cacheKey(sessionId: string, pageUrl: string): string {
  return `${sessionId}:${pageUrl}`;
}

function evictLRU(): void {
  if (cache.size < MAX_CACHE_SIZE) return;

  let oldestKey = "";
  let oldestTime = Infinity;

  for (const [key, entry] of cache) {
    if (entry.accessedAt < oldestTime) {
      oldestTime = entry.accessedAt;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    cache.delete(oldestKey);
    logger.debug("snapshot_differ_evict", { key: oldestKey });
  }
}

// ─── Line parsing ─────────────────────────────────────────────────────────

/** Parsed element from a snapshot line */
interface ParsedElement {
  ref: string;       // e.g. "@e3"
  type: string;      // e.g. "link", "button", "heading"
  name: string;      // accessible name, lowercased+trimmed, or "" if none
  fullLine: string;  // original line (for structural comparison)
  desc: string;      // the content after the ref (e.g. 'link "Home"')
}

/** Extract type and accessible name from the content portion after the ref */
function parseContent(content: string): { type: string; name: string } {
  // content looks like: 'link "Home"' or 'main' or 'navigation "Main Nav"'
  const nameMatch = content.match(/^(\S+)\s+"(.*)"$/);
  if (nameMatch) {
    return { type: nameMatch[1].toLowerCase(), name: nameMatch[2].toLowerCase().trim() };
  }
  // No quoted name — just a type like "main"
  const typeOnly = content.trim().split(/\s+/)[0];
  return { type: (typeOnly || "unknown").toLowerCase(), name: "" };
}

/**
 * Build a fingerprint map from snapshot text.
 * Fingerprint = `${type}:${name}` for named elements, `${type}:${lineIndex}` for unnamed.
 * Duplicates are disambiguated with `_N` suffix.
 */
function parseFingerprintMap(text: string): Map<string, ParsedElement> {
  const lines = text.split("\n");
  const elements: ParsedElement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(REF_LINE_RE);
    if (m) {
      const ref = m[2];
      const desc = m[3];
      const { type, name } = parseContent(desc);
      elements.push({ ref, type, name, fullLine: line, desc });
    }
  }

  // Build raw fingerprints — type:name for named, type: for unnamed
  // Duplicates (both named and unnamed) are disambiguated below with _N suffix
  const rawFingerprints = elements.map((el) => {
    if (el.name) {
      return `${el.type}:${el.name}`;
    }
    return `${el.type}:`;
  });

  // Count occurrences of each fingerprint to find duplicates
  const countMap = new Map<string, number>();
  for (const fp of rawFingerprints) {
    countMap.set(fp, (countMap.get(fp) || 0) + 1);
  }

  // Assign final fingerprints with _N suffix for duplicates
  const occurrenceTracker = new Map<string, number>();
  const result = new Map<string, ParsedElement>();

  for (let i = 0; i < elements.length; i++) {
    let fp = rawFingerprints[i];
    const count = countMap.get(fp) || 1;
    if (count > 1) {
      const occurrence = occurrenceTracker.get(fp) || 0;
      occurrenceTracker.set(fp, occurrence + 1);
      fp = `${fp}_${occurrence}`;
    }
    result.set(fp, elements[i]);
  }

  return result;
}

/** Estimate tokens from character count (chars / 4) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Differ ───────────────────────────────────────────────────────────────

export class SnapshotDiffer {
  /** Compare current snapshot with cached version, update cache */
  static diff(
    sessionId: string,
    pageUrl: string,
    current: SnapshotResult,
  ): SnapshotDiff {
    const key = cacheKey(sessionId, pageUrl);
    const prev = cache.get(key);
    const fullTokenEstimate = estimateTokens(current.text);

    // Store / update cache (only evict if this is a genuinely new key)
    if (!cache.has(key)) evictLRU();
    cache.set(key, { text: current.text, accessedAt: Date.now() });

    // First snapshot — no previous to compare against
    if (!prev) {
      logger.debug("snapshot_differ_first", { sessionId, pageUrl });
      return {
        changeCount: 0,
        diffText: "",
        isFirst: true,
        diffTokenEstimate: 0,
        fullTokenEstimate,
      };
    }

    // Parse both snapshots into fingerprint -> element maps
    const oldMap = parseFingerprintMap(prev.text);
    const newMap = parseFingerprintMap(current.text);

    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    // Track which fingerprints have been matched
    const matchedOld = new Set<string>();
    const matchedNew = new Set<string>();

    // Pass 1: Exact fingerprint matches (same type + same name)
    for (const [fp, newEl] of newMap) {
      const oldEl = oldMap.get(fp);
      if (oldEl !== undefined) {
        matchedOld.add(fp);
        matchedNew.add(fp);
        // Same identity — check for structural/content changes (ignoring ref ID shifts)
        const oldStripped = oldEl.fullLine.replace(/@e\d+/, "");
        const newStripped = newEl.fullLine.replace(/@e\d+/, "");
        if (oldStripped !== newStripped) {
          changed.push(`~ ${newEl.ref} ${oldEl.desc} → ${newEl.desc} (changed)`);
        }
      }
    }

    // Pass 2: Pair unmatched elements of the same type as "changed"
    // (handles cases like heading text changing from "Welcome" to "New Title")
    const unmatchedOld = new Map<string, { fp: string; el: ParsedElement }[]>();
    for (const [fp, el] of oldMap) {
      if (!matchedOld.has(fp)) {
        const list = unmatchedOld.get(el.type) || [];
        list.push({ fp, el });
        unmatchedOld.set(el.type, list);
      }
    }

    const unmatchedNew = new Map<string, { fp: string; el: ParsedElement }[]>();
    for (const [fp, el] of newMap) {
      if (!matchedNew.has(fp)) {
        const list = unmatchedNew.get(el.type) || [];
        list.push({ fp, el });
        unmatchedNew.set(el.type, list);
      }
    }

    // Pair unmatched elements of the same type (in order) as changes
    for (const [type, oldList] of unmatchedOld) {
      const newList = unmatchedNew.get(type) || [];
      const pairCount = Math.min(oldList.length, newList.length);

      for (let i = 0; i < pairCount; i++) {
        const oldEl = oldList[i].el;
        const newEl = newList[i].el;
        matchedOld.add(oldList[i].fp);
        matchedNew.add(newList[i].fp);
        changed.push(`~ ${newEl.ref} ${oldEl.desc} → ${newEl.desc} (changed)`);
      }
    }

    // Remaining unmatched = pure adds / removes
    for (const [fp, newEl] of newMap) {
      if (!matchedNew.has(fp)) {
        added.push(`+ ${newEl.ref} ${newEl.desc} (new)`);
      }
    }

    for (const [fp, oldEl] of oldMap) {
      if (!matchedOld.has(fp)) {
        removed.push(`- ${oldEl.ref} ${oldEl.desc} (removed)`);
      }
    }

    const changeCount = added.length + removed.length + changed.length;

    if (changeCount === 0) {
      return {
        changeCount: 0,
        diffText: "[INCREMENTAL SNAPSHOT — 0 changes since last snapshot]",
        isFirst: false,
        diffTokenEstimate: estimateTokens(
          "[INCREMENTAL SNAPSHOT — 0 changes since last snapshot]",
        ),
        fullTokenEstimate,
      };
    }

    const lines = [
      `[INCREMENTAL SNAPSHOT — ${changeCount} change${changeCount === 1 ? "" : "s"} since last snapshot]`,
      ...added,
      ...changed,
      ...removed,
    ];
    const diffText = lines.join("\n");

    logger.debug("snapshot_differ_diff", {
      sessionId,
      pageUrl,
      added: added.length,
      changed: changed.length,
      removed: removed.length,
    });

    return {
      changeCount,
      diffText,
      isFirst: false,
      diffTokenEstimate: estimateTokens(diffText),
      fullTokenEstimate,
    };
  }

  /** Clear cached snapshots for a session */
  static clearSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const key of cache.keys()) {
      if (key.startsWith(prefix)) {
        cache.delete(key);
      }
    }
    logger.debug("snapshot_differ_clear_session", { sessionId });
  }

  /** Clear all cached snapshots */
  static clearAll(): void {
    cache.clear();
    logger.debug("snapshot_differ_clear_all");
  }

  /** Get cache stats */
  static stats(): { size: number; maxSize: number } {
    return { size: cache.size, maxSize: MAX_CACHE_SIZE };
  }
}

export default SnapshotDiffer;
