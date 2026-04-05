import { describe, it, expect, afterAll, vi } from "vitest";
import { DomainKnowledge } from "../domain-knowledge.js";
import { SidecarServer, type SidecarDeps } from "../sidecar.js";
import * as http from "node:http";
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

/** HTTP GET returning { status, body } as a Promise. */
function httpGet(
  url: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
        res.on("error", reject);
      })
      .on("error", reject);
  });
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

// ═══════════════════════════════════════════════════════════════════════════
// SIDECAR STRESS TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe("SidecarServer stress", { timeout: 30_000 }, () => {
  /** Create mock deps with sensible defaults. */
  function makeDeps(overrides?: Partial<SidecarDeps>): SidecarDeps {
    return {
      listSessions: vi.fn(() => [
        { id: "s_001", name: "sess-1", url: "https://a.com" },
        { id: "s_002", name: "sess-2", url: "https://b.com" },
      ]),
      focusSession: vi.fn(async () => {}),
      zoomSession: vi.fn(async () => {}),
      restoreGrid: vi.fn(async () => {}),
      setLayout: vi.fn(async () => {}),
      destroyAll: vi.fn(async () => {}),
      screenshot: vi.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
      ...overrides,
    };
  }

  /** Start a server on port 0 and return it + the base URL. */
  async function startServer(
    deps: SidecarDeps,
  ): Promise<{ server: SidecarServer; baseUrl: string; port: number }> {
    const server = new SidecarServer(deps);
    await server.start(0);
    const addr = (server as any).server.address();
    const port = typeof addr === "object" ? addr.port : 0;
    return { server, baseUrl: `http://127.0.0.1:${port}`, port };
  }

  // ── 7. Concurrent request blast ──────────────────────────────────────

  it("100 concurrent GET /sessions all return 200 with valid JSON", async () => {
    const deps = makeDeps();
    const { server, baseUrl } = await startServer(deps);

    try {
      const requests = Array.from({ length: 100 }, () => httpGet(`${baseUrl}/sessions`));
      const results = await Promise.all(requests);

      let ok200 = 0;
      for (const r of results) {
        expect(r.status).toBe(200);
        const json = JSON.parse(r.body.toString());
        expect(json.ok).toBe(true);
        expect(Array.isArray(json.data)).toBe(true);
        ok200++;
      }

      expect(ok200).toBe(100);
      console.log(`[Stress 7] 100 concurrent requests: all returned 200`);
    } finally {
      await server.stop();
    }
  });

  // ── 8. Rapid start/stop cycles ───────────────────────────────────────

  it("10 rapid start/stop cycles with no port leaks", async () => {
    const deps = makeDeps();
    const ports: number[] = [];

    for (let i = 0; i < 10; i++) {
      const server = new SidecarServer(deps);
      await server.start(0);

      const addr = (server as any).server.address();
      const port = typeof addr === "object" ? addr.port : 0;
      ports.push(port);
      expect(port).toBeGreaterThan(0);

      // Quick health check to confirm it's listening
      const { status } = await httpGet(`http://127.0.0.1:${port}/health`);
      expect(status).toBe(200);

      await server.stop();
      expect((server as any).server).toBeNull();
    }

    console.log(`[Stress 8] 10 start/stop cycles, ports used: ${ports.join(", ")}`);
  });

  // ── 9. Large response handling — 1000 sessions ───────────────────────

  it("/sessions handles 1000 sessions and returns complete JSON", async () => {
    const largeSessions = Array.from({ length: 1000 }, (_, i) => ({
      id: `s_${String(i).padStart(4, "0")}`,
      name: `session-${i}`,
      url: `https://site-${i}.example.com`,
    }));

    const deps = makeDeps({
      listSessions: vi.fn(() => largeSessions),
    });

    const { server, baseUrl } = await startServer(deps);

    try {
      const { status, body } = await httpGet(`${baseUrl}/sessions`);
      expect(status).toBe(200);

      const json = JSON.parse(body.toString());
      expect(json.ok).toBe(true);
      expect(json.data.length).toBe(1000);
      expect(json.data[0].id).toBe("s_0000");
      expect(json.data[999].id).toBe("s_0999");
      expect(json.data[999].url).toBe("https://site-999.example.com");

      console.log(
        `[Stress 9] 1000-session response: ${body.length} bytes, ${json.data.length} items`,
      );
    } finally {
      await server.stop();
    }
  });

  // ── 10. Mixed endpoint barrage ───────────────────────────────────────

  it("50 concurrent requests to mixed endpoints all resolve", async () => {
    const deps = makeDeps();
    const { server, baseUrl } = await startServer(deps);

    try {
      const endpoints = [
        "/health",
        "/sessions",
        "/focus/s_001",
        "/grid",
        "/health",
        "/sessions",
        "/focus/s_002",
        "/zoom/s_001",
        "/layout/stack",
        "/health",
      ];

      // Build 50 requests cycling through the endpoints
      const requests = Array.from({ length: 50 }, (_, i) =>
        httpGet(`${baseUrl}${endpoints[i % endpoints.length]}`),
      );

      const results = await Promise.all(requests);

      let success = 0;
      let errors = 0;
      for (const r of results) {
        // All should return a valid HTTP response (not hang or drop)
        expect(r.status).toBeGreaterThanOrEqual(200);
        expect(r.status).toBeLessThan(600);

        const json = JSON.parse(r.body.toString());
        if (json.ok) {
          success++;
        } else {
          errors++;
        }
      }

      // All these endpoints exist and have valid sessions, so all should succeed
      expect(success).toBe(50);
      expect(errors).toBe(0);

      console.log(`[Stress 10] 50 mixed-endpoint requests: ${success} ok, ${errors} errors`);
    } finally {
      await server.stop();
    }
  });
});
