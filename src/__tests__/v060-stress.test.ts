import { describe, it, expect, afterAll } from "vitest";
import { DomainKnowledge } from "../domain-knowledge.js";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync } from "fs";
import { readdir, rm } from "fs/promises";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(
    tmpdir(),
    `leapfrog-v060-stress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  testDirs.push(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  for (const dir of testDirs) {
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOMAIN KNOWLEDGE STRESS TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("DomainKnowledge stress", { timeout: 30_000 }, () => {
  // ── 1. Scale test — 500 domains ──────────────────────────────────────

  it("creates, navigates, flushes, and verifies 500 domains under 10s", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir, 600); // cap above 500 so no eviction

    const start = Date.now();

    for (let i = 0; i < 500; i++) {
      await dk.load(`domain-${i}.example.com`);
      dk.recordNavigation(`domain-${i}.example.com`, "load", 100 + (i % 50));
    }

    await dk.flush();
    const elapsed = Date.now() - start;

    // Verify all 500 files exist on disk
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    expect(jsonFiles.length).toBe(500);

    expect(elapsed).toBeLessThan(10_000);
    console.log(`[Stress 1] 500 domains: load+record+flush in ${elapsed}ms`);
  });

  // ── 2. Rapid-fire updates — 1000 recordNavigation on single domain ──

  it("1000 recordNavigation calls produce correct running average", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("rapid.example.com");

    // Alternate 100ms and 200ms — expected average after 1000 calls is 150
    for (let i = 0; i < 1000; i++) {
      const duration = i % 2 === 0 ? 100 : 200;
      dk.recordNavigation("rapid.example.com", "load", duration);
    }

    const record = dk.get("rapid.example.com")!;
    expect(record.waitStrategy).not.toBeNull();
    expect(record.waitStrategy!.samples).toBe(1000);

    // Welford's running mean with alternating 100/200 converges to 150.
    // Compute the exact value by replaying the formula.
    let avg = 100; // first call: 100
    for (let n = 2; n <= 1000; n++) {
      const x = n % 2 === 0 ? 200 : 100; // n=2 → 200, n=3 → 100, ...
      avg += (x - avg) / n;
    }

    expect(record.waitStrategy!.avgLoadTime).toBeCloseTo(avg, 6);
    // Also verify it's very close to the intuitive 150
    expect(Math.abs(record.waitStrategy!.avgLoadTime - 150)).toBeLessThan(0.01);
    expect(record.visitCount).toBe(1000);

    console.log(
      `[Stress 2] 1000 rapid-fire: avg=${record.waitStrategy!.avgLoadTime}, expected=${avg}`,
    );
  });

  // ── 3. Concurrent domain loads ───────────────────────────────────────

  it("50 concurrent load() calls all resolve without errors", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir, 100);

    const domains = Array.from({ length: 50 }, (_, i) => `concurrent-${i}.example.com`);
    const results = await Promise.all(domains.map((d) => dk.load(d)));

    expect(results.length).toBe(50);
    for (let i = 0; i < 50; i++) {
      expect(results[i].domain).toBe(`concurrent-${i}.example.com`);
      expect(results[i].visitCount).toBe(0);
    }

    const listed = dk.listDomains();
    expect(listed.length).toBe(50);
  });

  // ── 4. Concurrent flush under writes ─────────────────────────────────

  it("flush() mid-write-loop does not corrupt data or throw", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir, 100);

    // Pre-load 20 domains
    for (let i = 0; i < 20; i++) {
      await dk.load(`flushrace-${i}.example.com`);
    }

    // Start writing in a loop and flush from another promise concurrently
    const writeLoop = (async () => {
      for (let round = 0; round < 50; round++) {
        for (let i = 0; i < 20; i++) {
          dk.recordNavigation(`flushrace-${i}.example.com`, "load", 100 + round);
        }
      }
    })();

    const flushLoop = (async () => {
      // Fire multiple flushes while writes are happening
      for (let f = 0; f < 5; f++) {
        await dk.flush();
      }
    })();

    // Neither should throw
    await expect(Promise.all([writeLoop, flushLoop])).resolves.toBeDefined();

    // Final flush to persist everything
    await dk.flush();

    // Verify files exist and are valid JSON
    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    expect(jsonFiles.length).toBe(20);

    // Spot-check: load in a new instance to verify no corruption
    const dk2 = new DomainKnowledge(dir);
    const record = await dk2.load("flushrace-0.example.com");
    expect(record.domain).toBe("flushrace-0.example.com");
    expect(record.visitCount).toBeGreaterThan(0);
  });

  // ── 5. Persistence round-trip at scale ───────────────────────────────

  it("100 domains with varied data survive flush + reload in new instance", async () => {
    const dir = makeTempDir();
    const dk1 = new DomainKnowledge(dir, 200);

    // Build 100 domains with diverse data
    for (let i = 0; i < 100; i++) {
      const domain = `roundtrip-${i}.example.com`;
      await dk1.load(domain);

      // Navigation
      dk1.recordNavigation(domain, i % 2 === 0 ? "load" : "networkidle", 100 + i);
      dk1.recordNavigation(domain, "load", 200 + i);

      // Blocks (every 5th domain)
      if (i % 5 === 0) {
        dk1.recordBlock(domain, "captcha");
      }

      // Consent (every 3rd domain)
      if (i % 3 === 0) {
        dk1.recordConsent(domain, `#consent-btn-${i}`);
      }

      // API endpoints (every 4th domain)
      if (i % 4 === 0) {
        dk1.recordApiEndpoints(domain, [
          { path: `/api/v${i}`, method: "GET", classification: "list" },
          { path: `/api/v${i}/item`, method: "POST", classification: "create" },
        ]);
      }
    }

    await dk1.flush();

    // New instance pointing to same directory
    const dk2 = new DomainKnowledge(dir, 200);

    for (let i = 0; i < 100; i++) {
      const domain = `roundtrip-${i}.example.com`;
      const record = await dk2.load(domain);

      expect(record.domain).toBe(domain);
      expect(record.visitCount).toBe(2);
      expect(record.waitStrategy).not.toBeNull();
      expect(record.waitStrategy!.samples).toBe(2);

      // Blocks
      if (i % 5 === 0) {
        expect(record.blockHistory.length).toBe(1);
        expect(record.blockHistory[0].reason).toBe("captcha");
      } else {
        expect(record.blockHistory.length).toBe(0);
      }

      // Consent
      if (i % 3 === 0) {
        expect(record.consentSelector).toBe(`#consent-btn-${i}`);
      } else {
        expect(record.consentSelector).toBeNull();
      }

      // API endpoints
      if (i % 4 === 0) {
        expect(record.apiEndpoints.length).toBe(2);
        expect(record.apiEndpoints[0].path).toBe(`/api/v${i}`);
        expect(record.apiEndpoints[1].path).toBe(`/api/v${i}/item`);
      } else {
        expect(record.apiEndpoints.length).toBe(0);
      }
    }
  });

  // ── 6. Eviction preserves most recent ────────────────────────────────

  it("eviction with maxDomains=10 retains the 10 most recently visited", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir, 10);

    // Add 11 domains with explicit lastVisit timestamps via update().
    // Load them first, then flush to clear dirty flags, then add more.
    // Strategy: load 10, flush (dirty cleared), then load 1 more to trigger eviction.

    // Phase 1: load domains 1-10, set lastVisit = i, then flush
    for (let i = 1; i <= 10; i++) {
      await dk.load(`evict-${i}.example.com`);
      dk.update(`evict-${i}.example.com`, { lastVisit: i });
    }
    await dk.flush(); // clears dirty flags — these can now be evicted

    // Phase 2: add domains 11-50 one at a time. Each triggers eviction.
    // Because we flush between adds, old non-dirty records get evicted.
    for (let i = 11; i <= 50; i++) {
      await dk.load(`evict-${i}.example.com`);
      dk.update(`evict-${i}.example.com`, { lastVisit: i });
      await dk.flush(); // clear dirty so eviction can remove the oldest
    }

    // After all this, the cache should contain at most 10 entries
    const remaining = dk.listDomains();
    expect(remaining.length).toBeLessThanOrEqual(10);

    // The retained domains should be the most recently visited ones
    const retainedDomains = remaining.map((d) => d.domain).sort();
    const retainedVisits = remaining.map((d) => d.lastVisit).sort((a, b) => a - b);

    // All retained should have lastVisit >= 41 (the 10 most recent out of 50)
    for (const visit of retainedVisits) {
      expect(visit).toBeGreaterThanOrEqual(41);
    }

    console.log(
      `[Stress 6] Eviction: ${remaining.length} domains retained, visits: [${retainedVisits.join(", ")}]`,
    );
  });
});

