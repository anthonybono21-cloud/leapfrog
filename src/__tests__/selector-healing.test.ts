import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { DomainKnowledge } from '../domain-knowledge.js';
import { SnapshotEngine } from '../snapshot-engine.js';
import type { Session } from '../types.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { rm } from 'fs/promises';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `leapfrog-heal-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  testDirs.push(dir);
  return dir;
}

/** Build a minimal Session object for testing. */
function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: 's_test01',
    context: {} as any,
    page: {} as any,
    pages: [],
    activePageIndex: 0,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    refCounter: 0,
    refMap: new Map(),
    refFingerprints: new Map(),
    networkLog: [],
    consoleLog: [],
    interceptRules: [],
    ...overrides,
  };
}

/** Build a mock Page whose ariaSnapshot returns the given YAML. */
function mockPage(yaml: string) {
  return {
    ariaSnapshot: vi.fn().mockResolvedValue(yaml),
    locator: vi.fn().mockReturnValue({
      first: () => ({
        ariaSnapshot: vi.fn().mockResolvedValue(yaml),
      }),
    }),
  } as any;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  for (const dir of testDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Selector Healing', () => {
  // ── 1. Element mappings are recorded during snapshot ──────────────────

  describe('element mappings during snapshot', () => {
    let engine: SnapshotEngine;

    beforeEach(() => {
      engine = new SnapshotEngine();
    });

    it('populates elementMappings in the snapshot result', async () => {
      const yaml = [
        '- button "Save" [ref=e1]',
        '- link "Home" [ref=e2]',
        '- textbox "Email" [ref=e3]',
      ].join('\n');

      const session = makeSession();
      const page = mockPage(yaml);
      const result = await engine.snapshot(page, session);

      expect(result.elementMappings).toBeDefined();
      expect(result.elementMappings!.length).toBe(3);

      // Verify fingerprint format is "role:lowercased_name"
      const fingerprints = result.elementMappings!.map(m => m.fingerprint);
      expect(fingerprints).toContain('button:save');
      expect(fingerprints).toContain('link:home');
      expect(fingerprints).toContain('textbox:email');

      // Verify selectors are assigned
      for (const mapping of result.elementMappings!) {
        expect(mapping.selector).toBeTruthy();
      }
    });

    it('populates refFingerprints on the session', async () => {
      const yaml = [
        '- button "Submit" [ref=e1]',
        '- link "About" [ref=e2]',
      ].join('\n');

      const session = makeSession();
      const page = mockPage(yaml);
      await engine.snapshot(page, session);

      expect(session.refFingerprints.size).toBe(2);
      expect(session.refFingerprints.get('@e1')).toBe('button:submit');
      expect(session.refFingerprints.get('@e2')).toBe('link:about');
    });

    it('works without refFingerprints (backward compat)', async () => {
      const yaml = '- button "OK" [ref=e1]';
      // Session without refFingerprints (simulating old session objects)
      const session = makeSession();
      delete (session as any).refFingerprints;
      const page = mockPage(yaml);

      // Should not throw
      const result = await engine.snapshot(page, session);
      expect(result.nodeCount).toBe(1);
      // elementMappings still populated from ctx
      expect(result.elementMappings!.length).toBe(1);
    });
  });

  // ── 2. Domain knowledge element memory ────────────────────────────────

  describe('DomainKnowledge element memory', () => {
    it('records and retrieves element selectors by fingerprint', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      dk.recordElement('example.com', 'button:submit', 'role=button[name="Submit"]');
      const found = dk.findElement('example.com', 'button:submit');

      expect(found).toBe('role=button[name="Submit"]');
    });

    it('upserts existing entries with new selectors', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      dk.recordElement('example.com', 'button:submit', 'aria-ref=e5');
      dk.recordElement('example.com', 'button:submit', 'role=button[name="Submit"]');

      const found = dk.findElement('example.com', 'button:submit');
      expect(found).toBe('role=button[name="Submit"]');
    });

    it('returns undefined for unknown fingerprints', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      const found = dk.findElement('example.com', 'button:nonexistent');
      expect(found).toBeUndefined();
    });

    it('returns undefined for unknown domains', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      dk.recordElement('example.com', 'button:submit', 'role=button[name="Submit"]');
      const found = dk.findElement('other.com', 'button:submit');
      expect(found).toBeUndefined();
    });

    it('normalizes domains (strips www.)', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      dk.recordElement('www.example.com', 'button:login', '#login-btn');
      const found = dk.findElement('example.com', 'button:login');

      expect(found).toBe('#login-btn');
    });

    it('caps elementMemory at 50 entries per domain (LRU)', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      // Mock Date.now to ensure distinct timestamps for LRU ordering
      const originalNow = Date.now;
      let mockTime = 1000000;
      Date.now = () => ++mockTime;

      try {
        // Add 55 entries — each gets a unique, ascending timestamp
        for (let i = 0; i < 55; i++) {
          dk.recordElement('example.com', `button:btn${i}`, `#btn-${i}`);
        }

        // Load the record to check the actual array
        const record = await dk.load('example.com');
        expect(record.elementMemory.length).toBe(50);

        // The oldest entries (btn0-btn4) should have been evicted
        const found0 = dk.findElement('example.com', 'button:btn0');
        expect(found0).toBeUndefined();

        // The newest entries should still be present
        const found54 = dk.findElement('example.com', 'button:btn54');
        expect(found54).toBe('#btn-54');
      } finally {
        Date.now = originalNow;
      }
    });

    it('LRU preserves recently accessed entries', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      const originalNow = Date.now;
      let mockTime = 2000000;
      Date.now = () => ++mockTime;

      try {
        // Add entry early (gets the lowest timestamp)
        dk.recordElement('example.com', 'button:early', '#early');

        // Add 50 more entries to fill the cap
        for (let i = 0; i < 50; i++) {
          dk.recordElement('example.com', `link:link${i}`, `#link-${i}`);
        }

        // Re-touch the early entry to make it recent (gets a high timestamp now)
        dk.recordElement('example.com', 'button:early', '#early-updated');

        // Add one more to trigger eviction
        dk.recordElement('example.com', 'button:overflow', '#overflow');

        // Early entry should survive because it was recently updated
        const found = dk.findElement('example.com', 'button:early');
        expect(found).toBe('#early-updated');
      } finally {
        Date.now = originalNow;
      }
    });
  });

  // ── 3. Selector healing integration ───────────────────────────────────

  describe('selector healing in resolve', () => {
    it('heals a missing ref using domain knowledge fingerprint', () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      // Simulate: a previous visit recorded the button's selector
      dk.recordElement('example.com', 'button:submit', 'role=button[name="Submit"]');

      // Session has the fingerprint mapping but the refMap entry was cleared
      const session = makeSession({ domain: 'example.com' });
      session.refFingerprints.set('@e5', 'button:submit');
      // refMap does NOT have @e5 — simulating a stale/cleared ref

      // The healing logic (as implemented in index.ts resolve function):
      const ref = '@e5';
      const selector = session.refMap.get(ref);
      let healedSelector: string | undefined;

      if (!selector && session.domain && session.refFingerprints) {
        const fingerprint = session.refFingerprints.get(ref);
        if (fingerprint) {
          healedSelector = dk.findElement(session.domain, fingerprint);
        }
      }

      expect(healedSelector).toBe('role=button[name="Submit"]');
    });

    it('falls back to error when fingerprint is also not in domain knowledge', () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      const session = makeSession({ domain: 'example.com' });
      session.refFingerprints.set('@e5', 'button:unknown-button');

      const ref = '@e5';
      const selector = session.refMap.get(ref);
      let healedSelector: string | undefined;

      if (!selector && session.domain && session.refFingerprints) {
        const fingerprint = session.refFingerprints.get(ref);
        if (fingerprint) {
          healedSelector = dk.findElement(session.domain, fingerprint);
        }
      }

      expect(healedSelector).toBeUndefined();
    });

    it('falls back to error when no fingerprint exists for the ref', () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      dk.recordElement('example.com', 'button:submit', 'role=button[name="Submit"]');

      const session = makeSession({ domain: 'example.com' });
      // refFingerprints does NOT have @e5

      const ref = '@e5';
      const selector = session.refMap.get(ref);
      let healedSelector: string | undefined;

      if (!selector && session.domain && session.refFingerprints) {
        const fingerprint = session.refFingerprints.get(ref);
        if (fingerprint) {
          healedSelector = dk.findElement(session.domain, fingerprint);
        }
      }

      expect(healedSelector).toBeUndefined();
    });

    it('does not attempt healing when session has no domain', () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      dk.recordElement('example.com', 'button:submit', 'role=button[name="Submit"]');

      // Session with no domain
      const session = makeSession();
      session.refFingerprints.set('@e5', 'button:submit');

      const ref = '@e5';
      const selector = session.refMap.get(ref);
      let healedSelector: string | undefined;

      if (!selector && session.domain && session.refFingerprints) {
        const fingerprint = session.refFingerprints.get(ref);
        if (fingerprint) {
          healedSelector = dk.findElement(session.domain, fingerprint);
        }
      }

      // No healing because session.domain is undefined
      expect(healedSelector).toBeUndefined();
    });
  });

  // ── 4. End-to-end: snapshot → record → heal ───────────────────────────

  describe('end-to-end snapshot to healing', () => {
    it('records mappings from snapshot and uses them for healing', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);
      const engine = new SnapshotEngine();

      const yaml = [
        '- button "Save" [ref=e1]',
        '- link "Home" [ref=e2]',
      ].join('\n');

      const session = makeSession({ domain: 'example.com' });
      const page = mockPage(yaml);

      // Step 1: Take a snapshot (this populates refFingerprints and elementMappings)
      const result = await engine.snapshot(page, session);

      // Step 2: Record element mappings to domain knowledge (as index.ts does)
      for (const mapping of result.elementMappings!) {
        dk.recordElement('example.com', mapping.fingerprint, mapping.selector);
      }

      // Step 3: Simulate the ref being cleared from refMap (page re-rendered)
      const savedFingerprints = new Map(session.refFingerprints);
      session.refMap.clear();

      // Step 4: Restore fingerprints (they're preserved across the clearing)
      session.refFingerprints = savedFingerprints;

      // Step 5: Try to heal @e1
      const fp = session.refFingerprints.get('@e1');
      expect(fp).toBe('button:save');

      const healed = dk.findElement('example.com', fp!);
      expect(healed).toBeDefined();
      // The healed selector should be the same one we originally recorded
      expect(healed).toBe('aria-ref=e1');
    });
  });

  // ── 5. elementMemory persistence via createEmpty ──────────────────────

  describe('elementMemory initialization', () => {
    it('createEmpty includes elementMemory as empty array', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      const record = await dk.load('fresh-domain.com');
      expect(record.elementMemory).toEqual([]);
    });

    it('handles legacy records without elementMemory', async () => {
      const dir = makeTempDir();
      const dk = new DomainKnowledge(dir);

      // Load creates a fresh record with elementMemory
      const record = await dk.load('legacy.com');
      // Simulate a legacy record by deleting elementMemory
      delete (record as any).elementMemory;

      // recordElement should handle missing elementMemory gracefully
      dk.recordElement('legacy.com', 'button:ok', '#ok');

      const found = dk.findElement('legacy.com', 'button:ok');
      expect(found).toBe('#ok');
    });
  });
});
