// ─── Per-Domain Knowledge Persistence ─────────────────────────────────────
//
// Leapfrog remembers what it learned about every website across sessions.
// Storage: ~/.leapfrog/domains/{domain}.json
//
// This is the self-improvement foundation. Every navigation, block event,
// consent dismissal, and API discovery feeds back into future visits.

import { readFile, writeFile, mkdir, readdir, unlink, rename } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from './logger.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface DomainRecord {
  domain: string;

  // Stealth intelligence
  stealthTier: number;
  blockHistory: Array<{
    timestamp: number;
    reason: string;
  }>;

  // Wait strategy
  waitStrategy: {
    method: string;
    avgLoadTime: number;
    samples: number;
  } | null;

  // Rate limiting
  rateLimit: {
    minDelayMs: number;
    lastAdjusted: number;
  } | null;

  // Consent
  consentSelector: string | null;

  // Challenge resolution intelligence
  challengeResolution: {
    method: string;       // "recaptcha-checkbox" | "cloudflare-checkbox" | "verify-button" | "capsolver" | "2captcha" | "nopecha"
    successCount: number;
    lastSuccess: number;
  } | null;

  // Snapshot intelligence — stable elements learned across visits
  stableElements: Array<{
    fingerprint: string;  // "role:name" e.g. "link:home"
    seenCount: number;    // how many visits it appeared on
    firstSeen: number;    // timestamp
  }>;

  /** Consecutive visits where a tracked fingerprint was absent. Reset on re-appearance. */
  stableElementMisses?: Record<string, number>;

  // API intelligence
  apiEndpoints: Array<{
    path: string;
    method: string;
    classification: string;
    lastSeen: number;
  }>;

  // Element memory — selector healing across sessions
  elementMemory: Array<{
    fingerprint: string;  // "role:name" e.g. "button:submit"
    lastSelector: string; // last known CSS/role selector
    lastSeen: number;     // timestamp
  }>;

  // Visit tracking
  visitCount: number;
  firstVisit: number;
  lastVisit: number;
}

// ─── Types (public) ──────────────────────────────────────────────────────

export interface NavigationHints {
  waitUntil?: string;
  stealthTier?: number;
  consentSelector?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize a domain string for consistent storage.
 * Strips `www.` prefix and lowercases so that `www.wikipedia.org`
 * and `Wikipedia.org` resolve to the same record.
 */
export function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^www\./, '');
}

/** Sanitize domain for use as a filename. Keep `.` and `-`, replace the rest. */
function domainToFilename(domain: string): string {
  return normalizeDomain(domain).replace(/[^a-zA-Z0-9.\-]/g, '_') + '.json';
}

// ─── Class ────────────────────────────────────────────────────────────────

export class DomainKnowledge {
  private cache: Map<string, DomainRecord> = new Map();
  private dirty: Set<string> = new Set();
  private readonly baseDir: string;
  private readonly maxDomains: number;
  private dirEnsured = false;

  constructor(baseDir?: string, maxDomains?: number) {
    this.baseDir = baseDir ?? join(homedir(), '.leapfrog', 'domains');
    this.maxDomains = maxDomains ?? 500;
  }

  // ── Read ──────────────────────────────────────────────────────────────

  /** Load domain record from cache or disk. Creates empty if not found. */
  async load(domain: string): Promise<DomainRecord> {
    const key = normalizeDomain(domain);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const filePath = join(this.baseDir, domainToFilename(key));
    try {
      const raw = await readFile(filePath, 'utf-8');
      const record = JSON.parse(raw) as DomainRecord;
      record.domain = key; // ensure normalized
      this.cache.set(key, record);
      this.evict();
      return record;
    } catch {
      // File missing or corrupt — start fresh
      const record = this.createEmpty(key);
      this.cache.set(key, record);
      return record;
    }
  }

  /** Get from cache only (sync, for hot paths). */
  get(domain: string): DomainRecord | undefined {
    return this.cache.get(normalizeDomain(domain));
  }

  // ── Write ─────────────────────────────────────────────────────────────

  /** Merge partial updates into a domain record. Marks dirty. */
  update(domain: string, partial: Partial<DomainRecord>): void {
    const key = normalizeDomain(domain);
    let record = this.cache.get(key);
    if (!record) {
      record = this.createEmpty(key);
      this.cache.set(key, record);
    }
    Object.assign(record, partial, { domain: key }); // domain is immutable
    this.dirty.add(key);
    this.evict();
  }

  /** Record a successful navigation — updates waitStrategy running average. */
  recordNavigation(domain: string, method: string, durationMs: number): void {
    const key = normalizeDomain(domain);
    let record = this.cache.get(key);
    if (!record) {
      record = this.createEmpty(key);
      this.cache.set(key, record);
    }

    if (!record.waitStrategy) {
      record.waitStrategy = { method, avgLoadTime: durationMs, samples: 1 };
    } else {
      record.waitStrategy.samples++;
      record.waitStrategy.avgLoadTime +=
        (durationMs - record.waitStrategy.avgLoadTime) / record.waitStrategy.samples;
      record.waitStrategy.method = method;
    }

    record.visitCount++;
    record.lastVisit = Date.now();
    this.dirty.add(key);
    this.evict();
  }

  /** Record a block event — escalates stealth tier if 2+ blocks in the last hour. */
  recordBlock(domain: string, reason: string): void {
    const key = normalizeDomain(domain);
    let record = this.cache.get(key);
    if (!record) {
      record = this.createEmpty(key);
      this.cache.set(key, record);
    }

    record.blockHistory.push({ timestamp: Date.now(), reason });

    const oneHourAgo = Date.now() - 3_600_000;
    const recentBlocks = record.blockHistory.filter(b => b.timestamp > oneHourAgo);
    if (recentBlocks.length >= 2 && record.stealthTier < 3) {
      record.stealthTier++;
      logger.info('domain-knowledge:stealth-escalated', {
        domain: key,
        newTier: record.stealthTier,
        recentBlocks: recentBlocks.length,
      });
    }

    this.dirty.add(key);
  }

  /** Record a consent dismissal selector for future visits. */
  recordConsent(domain: string, selector: string): void {
    const key = normalizeDomain(domain);
    let record = this.cache.get(key);
    if (!record) {
      record = this.createEmpty(key);
      this.cache.set(key, record);
    }

    record.consentSelector = selector;
    this.dirty.add(key);
  }

  /** Record a successful challenge resolution method for future visits. */
  recordChallengeResolution(domain: string, method: string): void {
    const key = normalizeDomain(domain);
    let record = this.cache.get(key);
    if (!record) {
      record = this.createEmpty(key);
      this.cache.set(key, record);
    }

    if (!record.challengeResolution || record.challengeResolution.method !== method) {
      record.challengeResolution = { method, successCount: 1, lastSuccess: Date.now() };
    } else {
      record.challengeResolution.successCount++;
      record.challengeResolution.lastSuccess = Date.now();
    }

    this.dirty.add(key);
    logger.info('domain-knowledge:challenge-method-learned', { domain: key, method, count: record.challengeResolution.successCount });
  }

  /** Get the known-good challenge resolution method for a domain. */
  getLearnedChallengeMethod(domain: string): string | null {
    const record = this.cache.get(normalizeDomain(domain));
    return record?.challengeResolution?.method ?? null;
  }

  /** Record discovered API endpoints, merging with existing. */
  recordApiEndpoints(
    domain: string,
    endpoints: Array<{ path: string; method: string; classification: string }>,
  ): void {
    const key = normalizeDomain(domain);
    let record = this.cache.get(key);
    if (!record) {
      record = this.createEmpty(key);
      this.cache.set(key, record);
    }

    const now = Date.now();
    for (const ep of endpoints) {
      const existing = record.apiEndpoints.find(
        a => a.path === ep.path && a.method === ep.method,
      );
      if (existing) {
        existing.classification = ep.classification;
        existing.lastSeen = now;
      } else {
        record.apiEndpoints.push({ ...ep, lastSeen: now });
      }
    }

    this.dirty.add(key);
  }

  /**
   * Record element fingerprints from a snapshot visit.
   * Increments seenCount for known fingerprints, adds new ones,
   * and removes fingerprints not seen in 3+ consecutive visits.
   */
  recordElementFingerprints(domain: string, fingerprints: string[]): void {
    const key = normalizeDomain(domain);
    let record = this.cache.get(key);
    if (!record) {
      record = this.createEmpty(key);
      this.cache.set(key, record);
    }

    const now = Date.now();
    const fpSet = new Set(fingerprints);

    // Initialize misses tracker if needed (backwards compat with old records)
    if (!record.stableElementMisses) {
      record.stableElementMisses = {};
    }

    // Update existing stable elements
    for (const el of record.stableElements) {
      if (fpSet.has(el.fingerprint)) {
        el.seenCount++;
        // Reset miss counter — it appeared
        record.stableElementMisses[el.fingerprint] = 0;
      } else {
        // Increment miss counter
        record.stableElementMisses[el.fingerprint] =
          (record.stableElementMisses[el.fingerprint] ?? 0) + 1;
      }
    }

    // Add new fingerprints not yet tracked
    const tracked = new Set(record.stableElements.map(e => e.fingerprint));
    for (const fp of fingerprints) {
      if (!tracked.has(fp)) {
        record.stableElements.push({
          fingerprint: fp,
          seenCount: 1,
          firstSeen: now,
        });
      }
    }

    // Remove fingerprints not seen in 3+ consecutive visits (they're no longer stable)
    record.stableElements = record.stableElements.filter(el => {
      const misses = record!.stableElementMisses?.[el.fingerprint] ?? 0;
      return misses < 3;
    });

    // Clean up miss tracker for removed entries
    const remainingFPs = new Set(record.stableElements.map(e => e.fingerprint));
    for (const fpKey of Object.keys(record.stableElementMisses)) {
      if (!remainingFPs.has(fpKey)) {
        delete record.stableElementMisses[fpKey];
      }
    }

    this.dirty.add(key);
  }

  /**
   * Get fingerprints of stable elements (seenCount >= minSeen) for suppression.
   * Returns them sorted by seenCount descending (highest confidence first).
   */
  getStableFingerprints(domain: string, minSeen = 3): string[] {
    const key = normalizeDomain(domain);
    const record = this.cache.get(key);
    if (!record) return [];

    return record.stableElements
      .filter(el => el.seenCount >= minSeen)
      .sort((a, b) => b.seenCount - a.seenCount)
      .map(el => el.fingerprint);
  }

  // ── Element Memory (selector healing) ─────────────────────────────────

  private static readonly ELEMENT_MEMORY_CAP = 50;

  /** Upsert an element fingerprint → selector mapping into domain memory. */
  recordElement(domain: string, fingerprint: string, selector: string): void {
    const key = normalizeDomain(domain);
    let record = this.cache.get(key);
    if (!record) {
      record = this.createEmpty(key);
      this.cache.set(key, record);
    }

    if (!record.elementMemory) {
      record.elementMemory = [];
    }

    const now = Date.now();
    const existing = record.elementMemory.find(e => e.fingerprint === fingerprint);
    if (existing) {
      existing.lastSelector = selector;
      existing.lastSeen = now;
    } else {
      record.elementMemory.push({ fingerprint, lastSelector: selector, lastSeen: now });
    }

    // LRU cap: sort by lastSeen descending, keep only the newest entries
    if (record.elementMemory.length > DomainKnowledge.ELEMENT_MEMORY_CAP) {
      record.elementMemory.sort((a, b) => b.lastSeen - a.lastSeen);
      record.elementMemory.length = DomainKnowledge.ELEMENT_MEMORY_CAP;
    }

    this.dirty.add(key);
  }

  /** Look up the last known selector for an element fingerprint on a domain. */
  findElement(domain: string, fingerprint: string): string | undefined {
    const key = normalizeDomain(domain);
    const record = this.cache.get(key);
    if (!record?.elementMemory) return undefined;

    const entry = record.elementMemory.find(e => e.fingerprint === fingerprint);
    return entry?.lastSelector;
  }

  // ── Persistence ───────────────────────────────────────────────────────

  /** Flush all dirty records to disk. */
  async flush(): Promise<void> {
    if (this.dirty.size === 0) return;

    await this.ensureDir();

    const promises: Promise<void>[] = [];
    for (const domain of this.dirty) {
      promises.push(this.writeDomain(domain));
    }

    await Promise.allSettled(promises);
    this.dirty.clear();
    logger.debug('domain-knowledge:flushed', { count: promises.length });
  }

  /** Flush a single domain to disk. */
  async flushDomain(domain: string): Promise<void> {
    const key = normalizeDomain(domain);
    if (!this.dirty.has(key)) return;
    await this.ensureDir();
    await this.writeDomain(key);
    this.dirty.delete(key);
  }

  // ── Query ─────────────────────────────────────────────────────────────

  /** List all loaded domains (for MCP tool display). */
  listDomains(): Array<{
    domain: string;
    visitCount: number;
    lastVisit: number;
    stealthTier: number;
  }> {
    return Array.from(this.cache.values()).map(r => ({
      domain: r.domain,
      visitCount: r.visitCount,
      lastVisit: r.lastVisit,
      stealthTier: r.stealthTier,
    }));
  }

  /** Get full record for display. Loads from disk if needed. */
  async inspect(domain: string): Promise<DomainRecord | null> {
    const key = normalizeDomain(domain);
    const cached = this.cache.get(key);
    if (cached) return cached;

    const filePath = join(this.baseDir, domainToFilename(key));
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as DomainRecord;
    } catch {
      return null;
    }
  }

  // ── Navigation Hints ──────────────────────────────────────────────────

  /**
   * Return actionable navigation hints from stored domain knowledge.
   * This is the read-side of the self-improvement loop: past visits
   * inform future navigation strategy, stealth tier, and consent handling.
   *
   * Returns an empty object if no useful knowledge exists yet.
   */
  async getNavigationHints(domain: string): Promise<NavigationHints> {
    const record = await this.load(domain);
    const hints: NavigationHints = {};

    // Wait strategy: only trust it with 2+ samples
    if (record.waitStrategy?.method && record.waitStrategy.samples >= 2) {
      hints.waitUntil = record.waitStrategy.method;
    }

    // Stealth tier: propagate if non-zero
    if (record.stealthTier > 0) {
      hints.stealthTier = record.stealthTier;
    }

    // Consent selector: pass through if known
    if (record.consentSelector) {
      hints.consentSelector = record.consentSelector;
    }

    return hints;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private createEmpty(domain: string): DomainRecord {
    return {
      domain,
      stealthTier: 0,
      blockHistory: [],
      waitStrategy: null,
      rateLimit: null,
      consentSelector: null,
      challengeResolution: null,
      stableElements: [],
      elementMemory: [],
      apiEndpoints: [],
      visitCount: 0,
      firstVisit: Date.now(),
      lastVisit: Date.now(),
    };
  }

  /** Ensure the storage directory exists (once per instance). */
  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    try {
      await mkdir(this.baseDir, { recursive: true });
      this.dirEnsured = true;
    } catch (err) {
      logger.error('domain-knowledge:mkdir-failed', {
        dir: this.baseDir,
        error: String(err),
      });
    }
  }

  /** Write a single domain record to disk. */
  private async writeDomain(domain: string): Promise<void> {
    const record = this.cache.get(domain);
    if (!record) return;

    const filePath = join(this.baseDir, domainToFilename(domain));
    const tmpPath = filePath + '.tmp';
    try {
      await writeFile(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
      await rename(tmpPath, filePath);
    } catch (err) {
      logger.error('domain-knowledge:write-failed', {
        domain,
        file: filePath,
        error: String(err),
      });
    }
  }

  /** LRU eviction — remove least-recently-visited domains when over cap. */
  private evict(): void {
    if (this.cache.size <= this.maxDomains) return;

    const sorted = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].lastVisit - b[1].lastVisit,
    );

    // Evict oldest 10%
    const evictCount = Math.ceil(this.maxDomains * 0.1);
    for (let i = 0; i < evictCount && i < sorted.length; i++) {
      const [key] = sorted[i];
      // Don't evict dirty records — they haven't been saved yet
      if (this.dirty.has(key)) continue;
      this.cache.delete(key);
    }

    logger.debug('domain-knowledge:evicted', {
      evicted: evictCount,
      remaining: this.cache.size,
    });
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

export const domainKnowledge = new DomainKnowledge();
