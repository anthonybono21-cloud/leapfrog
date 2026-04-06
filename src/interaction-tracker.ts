// ─── Interaction Heat Maps ────────────────────────────────────────────────
//
// Tracks which elements agents actually interact with (click, fill, extract)
// on each domain. After enough visits, elements that were never touched can
// be suppressed from snapshots for additional token savings on top of the
// existing stable-element suppression.
//
// Storage: piggybacks on DomainRecord persistence via toJSON/fromJSON.

import { logger } from './logger.js';
import { normalizeDomain } from './domain-knowledge.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface InteractionRecord {
  fingerprint: string;    // "role:name" e.g. "link:sign in"
  clicks: number;
  fills: number;
  extracts: number;
  lastUsed: number;       // timestamp
}

type InteractionType = 'click' | 'fill' | 'extract';

// ─── Constants ────────────────────────────────────────────────────────────

/** Maximum interaction records per domain (LRU by lastUsed). */
const MAX_RECORDS_PER_DOMAIN = 200;

/** Minimum visits before relevance scoring activates. */
const MIN_VISIT_THRESHOLD = 10;

/** Recency boost boundaries in milliseconds. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Form input roles that must NEVER be suppressed. */
const FORM_INPUT_ROLES = new Set([
  'textbox',
  'checkbox',
  'radio',
  'combobox',
  'searchbox',
  'spinbutton',
  'slider',
  'switch',
  'listbox',
]);

// ─── Class ────────────────────────────────────────────────────────────────

export class InteractionTracker {
  private cache: Map<string, InteractionRecord[]> = new Map();

  // ── Recording ─────────────────────────────────────────────────────────

  /**
   * Record an agent interaction with an element on a domain.
   * Upserts the record, incrementing the relevant counter.
   */
  recordInteraction(domain: string, fingerprint: string, type: InteractionType): void {
    const key = normalizeDomain(domain);
    let records = this.cache.get(key);
    if (!records) {
      records = [];
      this.cache.set(key, records);
    }

    const now = Date.now();
    const existing = records.find(r => r.fingerprint === fingerprint);

    if (existing) {
      existing[type === 'click' ? 'clicks' : type === 'fill' ? 'fills' : 'extracts']++;
      existing.lastUsed = now;
    } else {
      const record: InteractionRecord = {
        fingerprint,
        clicks: type === 'click' ? 1 : 0,
        fills: type === 'fill' ? 1 : 0,
        extracts: type === 'extract' ? 1 : 0,
        lastUsed: now,
      };
      records.push(record);
    }

    // LRU cap: evict least-recently-used if over limit
    if (records.length > MAX_RECORDS_PER_DOMAIN) {
      records.sort((a, b) => b.lastUsed - a.lastUsed);
      records.length = MAX_RECORDS_PER_DOMAIN;
    }

    logger.debug('interaction-tracker:recorded', { domain: key, fingerprint, type });
  }

  // ── Scoring ───────────────────────────────────────────────────────────

  /**
   * Compute relevance scores (0.0–1.0) for all tracked fingerprints on a domain.
   * Only activates after MIN_VISIT_THRESHOLD visits (safety threshold).
   *
   * Score = (totalInteractions / visitCount) * recencyBoost
   * Capped at 1.0.
   */
  getRelevanceScores(domain: string, visitCount: number): Map<string, number> {
    const result = new Map<string, number>();
    if (visitCount < MIN_VISIT_THRESHOLD) return result;

    const key = normalizeDomain(domain);
    const records = this.cache.get(key);
    if (!records) return result;

    const now = Date.now();

    for (const rec of records) {
      const total = rec.clicks + rec.fills + rec.extracts;
      const recencyBoost = this.computeRecencyBoost(now, rec.lastUsed);
      const score = Math.min((total / visitCount) * recencyBoost, 1.0);
      result.set(rec.fingerprint, score);
    }

    return result;
  }

  /**
   * Get fingerprints eligible for suppression — elements never interacted with
   * after enough visits. Excludes form input roles which must never be suppressed.
   *
   * NOTE: This returns fingerprints with relevance 0.0 (no interaction records).
   * The caller must combine this with the full set of known fingerprints from
   * the snapshot to identify which zero-interaction elements to suppress.
   * Elements that appear in getRelevanceScores have score > 0 and should NOT
   * be suppressed. This method returns the set of tracked fingerprints whose
   * total interactions are zero — which in practice means fingerprints that
   * were recorded via other means but never acted upon.
   */
  getSuppressSet(domain: string, visitCount: number): Set<string> {
    const suppressSet = new Set<string>();
    if (visitCount < MIN_VISIT_THRESHOLD) return suppressSet;

    const key = normalizeDomain(domain);
    const records = this.cache.get(key);
    if (!records) return suppressSet;

    for (const rec of records) {
      const total = rec.clicks + rec.fills + rec.extracts;
      if (total > 0) continue;

      // Never suppress form input roles
      const role = rec.fingerprint.split(':')[0];
      if (FORM_INPUT_ROLES.has(role)) continue;

      suppressSet.add(rec.fingerprint);
    }

    return suppressSet;
  }

  // ── Serialization ─────────────────────────────────────────────────────

  /** Serialize interaction records for a domain (for persistence in DomainRecord). */
  toJSON(domain: string): InteractionRecord[] {
    const key = normalizeDomain(domain);
    return this.cache.get(key) ?? [];
  }

  /** Restore interaction records for a domain from persisted data. */
  fromJSON(domain: string, data: InteractionRecord[]): void {
    const key = normalizeDomain(domain);
    this.cache.set(key, data);
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private computeRecencyBoost(now: number, lastUsed: number): number {
    const age = now - lastUsed;
    if (age <= SEVEN_DAYS_MS) return 1.0;
    if (age <= THIRTY_DAYS_MS) return 0.7;
    return 0.4;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

export const interactionTracker = new InteractionTracker();
