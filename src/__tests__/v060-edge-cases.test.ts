// ─── v0.6.0 Edge Case & Hardening Tests ──────────────────────────────────
//
// These tests probe boundaries, race conditions, injection vectors, and
// malformed inputs across the 6 new v0.6.0 modules. The goal is to break
// things that basic unit tests miss.

import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, mkdir, chmod, rm, readFile, readdir } from "fs/promises";
import * as http from "node:http";

import { DomainKnowledge } from "../domain-knowledge.js";
import { SidecarServer, type SidecarDeps } from "../sidecar.js";
import {
  parseDetectionResult,
  getOverlayScript,
} from "../intervention.js";
import {
  getHUDInitScript,
  getHUDUpdateScript,
  getClickRippleScript,
} from "../session-hud.js";
import type { HUDStatus } from "../session-hud.js";
import {
  CONSENT_SELECTORS,
  getCacheSelectorScript,
} from "../consent-dismiss.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cleanupDirs: string[] = [];
const cleanupServers: SidecarServer[] = [];

function makeTempDir(suffix = ""): string {
  const dir = join(
    tmpdir(),
    `leapfrog-edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${suffix}`,
  );
  cleanupDirs.push(dir);
  return dir;
}

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
  for (const s of cleanupServers) {
    try {
      await s.stop();
    } catch {
      /* best-effort */
    }
  }
  for (const dir of cleanupDirs) {
    try {
      // Restore write permissions so rm can clean up
      await chmod(dir, 0o755).catch(() => {});
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DOMAIN KNOWLEDGE EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("DomainKnowledge — edge cases", () => {
  // ── 1. Malformed JSON on disk ──────────────────────────────────────────

  it("load() returns a fresh record when JSON on disk is corrupt", async () => {
    const dir = makeTempDir();
    await mkdir(dir, { recursive: true });
    // Write garbage to the file that would be loaded for "corrupt.com"
    await writeFile(join(dir, "corrupt.com.json"), "{{{{NOT JSON!!!!", "utf-8");

    const dk = new DomainKnowledge(dir);
    const record = await dk.load("corrupt.com");

    expect(record).toBeDefined();
    expect(record.domain).toBe("corrupt.com");
    expect(record.stealthTier).toBe(0);
    expect(record.visitCount).toBe(0);
    expect(record.blockHistory).toEqual([]);
  });

  it("load() returns a fresh record when JSON is truncated mid-object", async () => {
    const dir = makeTempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "truncated.com.json"),
      '{"domain":"truncated.com","stealthTier":2,',
      "utf-8",
    );

    const dk = new DomainKnowledge(dir);
    const record = await dk.load("truncated.com");

    expect(record.domain).toBe("truncated.com");
    expect(record.stealthTier).toBe(0); // fresh, not the truncated "2"
  });

  it("load() returns a fresh record when file contains empty string", async () => {
    const dir = makeTempDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "empty.com.json"), "", "utf-8");

    const dk = new DomainKnowledge(dir);
    const record = await dk.load("empty.com");

    expect(record.domain).toBe("empty.com");
    expect(record.stealthTier).toBe(0);
  });

  // ── 2. Concurrent flush ────────────────────────────────────────────────

  it("concurrent recordNavigation + flush persists all data without loss", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    // Rapidly record navigations on 20 different domains
    const domains = Array.from({ length: 20 }, (_, i) => `rapid-${i}.com`);
    for (const d of domains) {
      dk.recordNavigation(d, "load", Math.random() * 1000);
    }

    // Flush once — all 20 should persist
    await dk.flush();

    // Verify all files exist on disk
    const files = await readdir(dir);
    for (const d of domains) {
      const filename = d.replace(/[^a-zA-Z0-9.\-]/g, "_") + ".json";
      expect(files).toContain(filename);
    }

    // Read back with a fresh instance, verify all domains are valid
    const dk2 = new DomainKnowledge(dir);
    for (const d of domains) {
      const record = await dk2.load(d);
      expect(record.domain).toBe(d);
      expect(record.visitCount).toBe(1);
      expect(record.waitStrategy).not.toBeNull();
    }
  });

  // ── 3. Domain name sanitization ────────────────────────────────────────

  it("path traversal domain does not escape the domains dir", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    const evilDomain = "evil.com/../../etc/passwd";
    dk.recordNavigation(evilDomain, "load", 100);
    await dk.flush();

    // Verify the file is written inside dir, not elsewhere
    const files = await readdir(dir);
    expect(files.length).toBe(1);
    // The filename should be sanitized — slashes become underscores
    expect(files[0]).toContain("evil.com");
    expect(files[0]).not.toContain("/");
  });

  it("deeply nested subdomain does not throw", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    const deepDomain = "a.b.c.d.e.f.g.h";
    dk.recordNavigation(deepDomain, "load", 100);
    await dk.flush();

    const record = dk.get(deepDomain);
    expect(record).toBeDefined();
    expect(record!.domain).toBe(deepDomain);
  });

  it("empty string domain does not throw", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    expect(() => dk.recordNavigation("", "load", 100)).not.toThrow();

    const record = dk.get("");
    expect(record).toBeDefined();
    expect(record!.domain).toBe("");
  });

  it("very long domain (300 chars) does not throw", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    const longDomain = "a".repeat(300) + ".com";
    expect(() => dk.recordNavigation(longDomain, "load", 100)).not.toThrow();

    const record = dk.get(longDomain);
    expect(record).toBeDefined();
    expect(record!.visitCount).toBe(1);
  });

  it("unicode domain gets sanitized without throwing", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    const unicodeDomain = "\u{1F600}.example.\u{1F4A9}.com";
    expect(() => dk.recordNavigation(unicodeDomain, "load", 100)).not.toThrow();

    const record = dk.get(unicodeDomain);
    expect(record).toBeDefined();
  });

  // ── 4. Running average math ────────────────────────────────────────────

  it("running average of 100 navigations matches expected value", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    // Record values 1..100 — the true average is 50.5
    for (let i = 1; i <= 100; i++) {
      dk.recordNavigation("avg-precision.com", "load", i);
    }

    const record = dk.get("avg-precision.com")!;
    expect(record.waitStrategy!.samples).toBe(100);
    // Welford's online mean should converge to 50.5
    expect(record.waitStrategy!.avgLoadTime).toBeCloseTo(50.5, 5);
    expect(record.visitCount).toBe(100);
  });

  it("running average with identical values stays exact", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    for (let i = 0; i < 50; i++) {
      dk.recordNavigation("constant.com", "load", 200);
    }

    const record = dk.get("constant.com")!;
    expect(record.waitStrategy!.avgLoadTime).toBe(200);
  });

  it("running average with extreme outlier does not overflow or NaN", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    dk.recordNavigation("outlier.com", "load", 1);
    dk.recordNavigation("outlier.com", "load", Number.MAX_SAFE_INTEGER);

    const record = dk.get("outlier.com")!;
    expect(Number.isFinite(record.waitStrategy!.avgLoadTime)).toBe(true);
    expect(Number.isNaN(record.waitStrategy!.avgLoadTime)).toBe(false);
  });

  // ── 5. Stealth tier ceiling ────────────────────────────────────────────

  it("stealthTier never exceeds 3 even after 50 rapid blocks", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);
    await dk.load("hammered.com");

    for (let i = 0; i < 50; i++) {
      dk.recordBlock("hammered.com", `block-${i}`);
    }

    const record = dk.get("hammered.com")!;
    expect(record.stealthTier).toBeLessThanOrEqual(3);
    expect(record.blockHistory.length).toBe(50);
  });

  // ── 6. LRU eviction under pressure ────────────────────────────────────

  it("maxDomains=3: after flushing and adding more, only recent survive eviction", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir, 3);

    // Load initial domains with distinct lastVisit times
    for (let i = 0; i < 3; i++) {
      dk.recordNavigation(`old-${i}.com`, "load", 100);
    }
    await dk.flush(); // clear dirty flags so they become evictable

    // Now add 4 more domains (exceeding maxDomains=3) — should trigger eviction of old ones
    for (let i = 0; i < 4; i++) {
      dk.recordNavigation(`new-${i}.com`, "load", 200);
    }

    const domains = dk.listDomains();
    const names = domains.map((d) => d.domain);

    // All new domains should be present (they're dirty, protected from eviction)
    for (let i = 0; i < 4; i++) {
      expect(names).toContain(`new-${i}.com`);
    }

    // Total cache should be less than 3 + 4 = 7 (some old ones should be evicted)
    expect(domains.length).toBeLessThan(7);
  });

  // ── 7. Empty flush ────────────────────────────────────────────────────

  it("flush() with no dirty records is a no-op and does not throw", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    // No records loaded, nothing dirty
    await expect(dk.flush()).resolves.toBeUndefined();
  });

  it("double flush is safe — second flush is a no-op", async () => {
    const dir = makeTempDir();
    const dk = new DomainKnowledge(dir);

    dk.recordNavigation("double-flush.com", "load", 100);
    await dk.flush();
    // Second flush — dirty set is now empty
    await expect(dk.flush()).resolves.toBeUndefined();
  });

  // ── 8. Disk permission error ──────────────────────────────────────────

  it("flush to a read-only directory logs error but does not throw", async () => {
    const dir = makeTempDir("-readonly");
    await mkdir(dir, { recursive: true });
    // Make it read-only
    await chmod(dir, 0o444);

    const dk = new DomainKnowledge(dir);
    // The dirEnsured flag won't be set yet, so ensureDir will try mkdir (fail),
    // but the overall flush should not throw
    dk.recordNavigation("readonly-test.com", "load", 100);

    // This should NOT throw — errors are logged internally
    await expect(dk.flush()).resolves.toBeUndefined();

    // Restore permissions for cleanup
    await chmod(dir, 0o755);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SIDECAR EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("SidecarServer — edge cases", () => {
  function makeMockDeps(overrides?: Partial<SidecarDeps>): SidecarDeps {
    return {
      listSessions: vi.fn(() => [
        { id: "s_test1", name: "test-1", url: "https://example.com" },
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

  async function startServer(deps?: SidecarDeps): Promise<{ server: SidecarServer; baseUrl: string }> {
    const server = new SidecarServer(deps ?? makeMockDeps());
    await server.start(0);
    cleanupServers.push(server);
    const addr = (server as any).server.address();
    const port = typeof addr === "object" ? addr.port : 0;
    return { server, baseUrl: `http://127.0.0.1:${port}` };
  }

  // ── 9. Double start ────────────────────────────────────────────────────

  it("calling start() twice on the same port rejects (EADDRINUSE)", async () => {
    const deps = makeMockDeps();
    const server1 = new SidecarServer(deps);
    await server1.start(0);
    cleanupServers.push(server1);
    const addr = (server1 as any).server.address();
    const port = addr.port;

    // Starting a second server on the same port should fail
    const server2 = new SidecarServer(deps);
    await expect(server2.start(port)).rejects.toThrow();
  });

  // ── 10. Start, stop, start lifecycle ───────────────────────────────────

  it("start -> stop -> start lifecycle works cleanly", async () => {
    const deps = makeMockDeps();
    const server = new SidecarServer(deps);

    await server.start(0);
    const addr1 = (server as any).server.address();
    expect(addr1).toBeTruthy();

    await server.stop();
    expect((server as any).server).toBeNull();

    // Restart on a new port
    await server.start(0);
    cleanupServers.push(server);
    const addr2 = (server as any).server.address();
    expect(addr2).toBeTruthy();

    const { status } = await httpGet(`http://127.0.0.1:${addr2.port}/health`);
    expect(status).toBe(200);
  });

  // ── 11. Concurrent requests ────────────────────────────────────────────

  it("20 concurrent GET /sessions all return valid JSON", async () => {
    const { baseUrl } = await startServer();

    const requests = Array.from({ length: 20 }, () =>
      httpGet(`${baseUrl}/sessions`),
    );
    const results = await Promise.all(requests);

    for (const { status, body } of results) {
      expect(status).toBe(200);
      const json = JSON.parse(body.toString());
      expect(json.ok).toBe(true);
      expect(Array.isArray(json.data)).toBe(true);
    }
  });

  // ── 12. Invalid paths ─────────────────────────────────────────────────

  it("GET /focus/ (no ID) returns 400", async () => {
    const { baseUrl } = await startServer();
    const { status, body } = await httpGet(`${baseUrl}/focus/`);
    expect(status).toBe(400);
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(false);
    expect(json.error).toContain("Missing session ID");
  });

  it("GET /zoom/ (no ID) returns 400", async () => {
    const { baseUrl } = await startServer();
    const { status, body } = await httpGet(`${baseUrl}/zoom/`);
    expect(status).toBe(400);
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(false);
  });

  it("GET /layout/invalid_type still returns 200 (layout is passthrough)", async () => {
    const deps = makeMockDeps();
    const { baseUrl } = await startServer(deps);
    const { status, body } = await httpGet(`${baseUrl}/layout/invalid_type`);
    expect(status).toBe(200);
    const json = JSON.parse(body.toString());
    expect(json.ok).toBe(true);
    expect(json.data.layout).toBe("invalid_type");
    expect(deps.setLayout).toHaveBeenCalledWith("invalid_type");
  });

  // ── 13. Large screenshot ───────────────────────────────────────────────

  it("5MB screenshot response is delivered completely", async () => {
    const bigBuf = Buffer.alloc(5 * 1024 * 1024, 0x42);
    // Set PNG magic bytes at start
    bigBuf[0] = 0x89;
    bigBuf[1] = 0x50;
    bigBuf[2] = 0x4e;
    bigBuf[3] = 0x47;

    const deps = makeMockDeps({
      screenshot: vi.fn(async () => bigBuf),
    });
    const { baseUrl } = await startServer(deps);

    const { status, headers, body } = await httpGet(
      `${baseUrl}/screenshot/s_test1`,
    );
    expect(status).toBe(200);
    expect(headers["content-type"]).toBe("image/png");
    expect(body.length).toBe(5 * 1024 * 1024);
    expect(body[0]).toBe(0x89);
  });

  // ── 14. Stop without start ─────────────────────────────────────────────

  it("stop() on a never-started server resolves without throwing", async () => {
    const server = new SidecarServer(makeMockDeps());
    await expect(server.stop()).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTERVENTION EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("intervention — edge cases", () => {
  // ── 15. parseDetectionResult with garbage ──────────────────────────────

  describe("parseDetectionResult with garbage inputs", () => {
    it("returns null for a number", () => {
      expect(parseDetectionResult(42)).toBeNull();
    });

    it("returns null for an array", () => {
      expect(parseDetectionResult([1, 2, 3])).toBeNull();
    });

    it("returns null for a deeply nested object", () => {
      expect(parseDetectionResult({ a: { b: { c: { d: "deep" } } } })).toBeNull();
    });

    it("returns null for a string", () => {
      expect(parseDetectionResult("captcha")).toBeNull();
    });

    it("returns null for a boolean", () => {
      expect(parseDetectionResult(true)).toBeNull();
      expect(parseDetectionResult(false)).toBeNull();
    });

    it("returns null for NaN", () => {
      expect(parseDetectionResult(NaN)).toBeNull();
    });

    it("returns null for an empty object", () => {
      expect(parseDetectionResult({})).toBeNull();
    });
  });

  // ── 16. parseDetectionResult with extra fields ─────────────────────────

  it("parseDetectionResult accepts valid event with extra unknown fields", () => {
    const raw = {
      type: "captcha",
      reason: "reCAPTCHA detected",
      timestamp: 999,
      elementSelector: "#cap",
      extraField: "should be ignored",
      anotherOne: { nested: true },
      count: 42,
    };
    const result = parseDetectionResult(raw);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("captcha");
    expect(result!.reason).toBe("reCAPTCHA detected");
    expect(result!.timestamp).toBe(999);
    expect(result!.elementSelector).toBe("#cap");
    // Extra fields should NOT appear on the returned event
    expect((result as any).extraField).toBeUndefined();
    expect((result as any).anotherOne).toBeUndefined();
  });

  // ── 17. XSS in overlay reason ──────────────────────────────────────────

  it("getOverlayScript with script tags uses textContent (safe against HTML injection)", () => {
    const xssPayload = '<script>alert(1)</script>';
    const script = getOverlayScript(xssPayload);

    // The overlay sets .textContent, not .innerHTML, so <script> tags
    // render as literal text, never parsed as HTML. Verify the safe pattern:
    expect(script).toContain("textContent");
    // The reason string IS present in the output (it's a JS string literal
    // used for textContent assignment, which is safe).
    expect(script).toContain(xssPayload);
    // Crucially, it's NOT assigned via innerHTML
    expect(script).not.toContain("reasonEl.innerHTML");
  });

  it("getOverlayScript escapes backslashes in reason", () => {
    const reason = "Path: C:\\Users\\test\\file";
    const script = getOverlayScript(reason);
    // Backslashes should be double-escaped for JS string embedding
    expect(script).toContain("C:\\\\Users\\\\test\\\\file");
  });

  it("getOverlayScript escapes newlines in reason", () => {
    const reason = "Line1\nLine2\nLine3";
    const script = getOverlayScript(reason);
    // Newlines should be escaped to \\n in JS string
    expect(script).toContain("Line1\\nLine2\\nLine3");
  });

  // ── 18. Very long reason string ────────────────────────────────────────

  it("getOverlayScript handles a 10,000 character reason without error", () => {
    const longReason = "A".repeat(10_000);
    const script = getOverlayScript(longReason);
    expect(script).toBeTruthy();
    expect(script.length).toBeGreaterThan(10_000);
    expect(script).toContain("A".repeat(100)); // at least some of the reason is there
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SESSION HUD EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("session-hud — edge cases", () => {
  // ── 19. XSS in session name ────────────────────────────────────────────

  it("getHUDInitScript does not embed session name (no XSS vector)", () => {
    const xssName = '<img onerror=alert(1)>';
    const script = getHUDInitScript(xssName);

    // Session name is no longer embedded in the init script (status bar removed).
    // Verify the XSS payload is not present in the output.
    expect(script).not.toContain("onerror=alert(1)");
    expect(script).not.toContain("<img");

    // Script should still be valid ripple setup
    expect(script).toContain("leapfrog-ripple");
  });

  // ── 20. Empty session name ─────────────────────────────────────────────

  it("getHUDInitScript with empty string does not throw or produce broken JS", () => {
    const script = getHUDInitScript("");
    expect(script).toBeTruthy();
    expect(script).toContain("leapfrog-ripple");
    // Verify the output is still well-formed — contains opening and closing IIFE
    expect(script).toContain("(function()");
    expect(script.trim().endsWith("})();")).toBe(true);
  });

  // ── 21. All HUD statuses produce distinct colors ───────────────────────

  it("every HUDStatus returns empty string from update script (status bar removed)", () => {
    const statuses: HUDStatus[] = ["active", "loading", "waiting", "error", "complete"];
    const scripts = statuses.map((s) => getHUDUpdateScript(s));

    // All should be empty strings (status bar was removed)
    for (const script of scripts) {
      expect(script).toBe("");
    }
  });

  it("HUD init script contains ripple CSS but not status colors (status bar removed)", () => {
    const script = getHUDInitScript("color-test");
    // Status colors are no longer embedded (status bar removed)
    // But the ripple green color IS present in the CSS
    expect(script).toContain("leapfrog-ripple");
    expect(script).toContain("rgba(34, 197, 94");
  });

  // ── 22. Negative coordinates ───────────────────────────────────────────

  it("getClickRippleScript with negative coordinates produces valid JS", () => {
    const script = getClickRippleScript(-100, -200);
    expect(script).toBeTruthy();
    expect(script).toContain("-100");
    expect(script).toContain("-200");
    // Should be syntactically valid — contains the function call
    expect(script).toContain("__leapfrog_clickRipple");
  });

  // ── 23. Very large coordinates ─────────────────────────────────────────

  it("getClickRippleScript with very large coordinates produces valid JS", () => {
    const script = getClickRippleScript(99999, 99999);
    expect(script).toBeTruthy();
    expect(script).toContain("99999");
    expect(script).toContain("__leapfrog_clickRipple");
  });

  it("getClickRippleScript with zero coordinates produces valid JS", () => {
    const script = getClickRippleScript(0, 0);
    expect(script).toContain("__leapfrog_clickRipple");
    expect(script).toContain("0");
  });

  it("getClickRippleScript with NaN coordinates embeds NaN but does not throw", () => {
    expect(() => getClickRippleScript(NaN, NaN)).not.toThrow();
  });

  it("getClickRippleScript with Infinity coordinates does not throw", () => {
    expect(() => getClickRippleScript(Infinity, -Infinity)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONSENT DISMISS EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("consent-dismiss — edge cases", () => {
  // ── 24. XSS in domain/selector for cache script ────────────────────────

  it("getCacheSelectorScript escapes single quotes in domain", () => {
    const script = getCacheSelectorScript("evil.com'; alert(1); '", "div");
    // The injected domain should have its single quotes escaped
    expect(script).not.toContain("evil.com'; alert(1); '");
    // Should contain the escaped version
    expect(script).toContain("evil.com\\'; alert(1); \\'");
  });

  it("getCacheSelectorScript escapes single quotes in selector", () => {
    const script = getCacheSelectorScript("safe.com", "div'; alert(1); '");
    expect(script).not.toContain("div'; alert(1); '");
    expect(script).toContain("div\\'; alert(1); \\'");
  });

  it("getCacheSelectorScript escapes backslashes", () => {
    const script = getCacheSelectorScript("test.com", "div\\[class]");
    // Backslash should be double-escaped
    expect(script).toContain("div\\\\[class]");
  });

  it('getCacheSelectorScript with double-quote payload does not break JS', () => {
    const script = getCacheSelectorScript('"; alert(1); "', "div");
    // Double quotes are not single-quote escaped, but the string uses single quotes
    // so double quotes are safe. Verify it doesn't break the structure.
    expect(script).toContain("__leapfrog_consent_cache");
    expect(typeof script).toBe("string");
  });

  // ── 25. All framework selectors are valid CSS ──────────────────────────

  it("no CONSENT_SELECTORS entry has an empty string selector", () => {
    for (const fw of CONSENT_SELECTORS) {
      for (const sel of fw.selectors) {
        expect(sel.length).toBeGreaterThan(0);
      }
    }
  });

  it("no CONSENT_SELECTORS entry has bare curly braces in selector", () => {
    for (const fw of CONSENT_SELECTORS) {
      for (const sel of fw.selectors) {
        expect(sel).not.toMatch(/^\s*\{\s*\}\s*$/);
      }
    }
  });

  it("all CONSENT_SELECTORS selectors are syntactically valid CSS", () => {
    // We can't use document.querySelector in Node, but we can check for
    // common issues: no selectors start/end with comma, no double spaces
    // in selector class/id names, no unmatched brackets
    for (const fw of CONSENT_SELECTORS) {
      for (const sel of fw.selectors) {
        // Should not start or end with comma
        expect(sel.trim()).not.toMatch(/^,|,$/);
        // Brackets should be balanced
        const openBrackets = (sel.match(/\[/g) || []).length;
        const closeBrackets = (sel.match(/\]/g) || []).length;
        expect(openBrackets).toBe(closeBrackets);
        // Parentheses should be balanced
        const openParens = (sel.match(/\(/g) || []).length;
        const closeParens = (sel.match(/\)/g) || []).length;
        expect(openParens).toBe(closeParens);
      }
    }
  });

  it("every framework has a non-empty name", () => {
    for (const fw of CONSENT_SELECTORS) {
      expect(typeof fw.name).toBe("string");
      expect(fw.name.trim().length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFY EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("notify — edge cases", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadNotify() {
    return await import("../notify.js");
  }

  // ── 26. Alert with quotes and special chars ────────────────────────────

  it("alert with double quotes does not throw (disabled)", async () => {
    delete process.env.LEAP_NOTIFY;
    const { alert } = await loadNotify();
    expect(() => alert('Title "with" quotes', "Message with 'single' and $pecial chars")).not.toThrow();
  });

  it("alert with backticks and template literal syntax does not throw (disabled)", async () => {
    delete process.env.LEAP_NOTIFY;
    const { alert } = await loadNotify();
    expect(() => alert("Title `with` backticks", "Message ${with} template")).not.toThrow();
  });

  it("alert with newlines in title and message does not throw (disabled)", async () => {
    delete process.env.LEAP_NOTIFY;
    const { alert } = await loadNotify();
    expect(() => alert("Title\nwith\nnewlines", "Message\nwith\nnewlines")).not.toThrow();
  });

  it("alert with empty strings does not throw (disabled)", async () => {
    delete process.env.LEAP_NOTIFY;
    const { alert } = await loadNotify();
    expect(() => alert("", "")).not.toThrow();
  });

  // ── 27. Volume boundaries ──────────────────────────────────────────────

  it("chime(0) does not throw when sound is disabled", async () => {
    delete process.env.LEAP_SOUND;
    const { chime } = await loadNotify();
    expect(() => chime(0)).not.toThrow();
  });

  it("chime(1) does not throw when sound is disabled", async () => {
    delete process.env.LEAP_SOUND;
    const { chime } = await loadNotify();
    expect(() => chime(1)).not.toThrow();
  });

  it("chime(-1) does not throw when sound is disabled", async () => {
    delete process.env.LEAP_SOUND;
    const { chime } = await loadNotify();
    expect(() => chime(-1)).not.toThrow();
  });

  it("chime(100) does not throw when sound is disabled", async () => {
    delete process.env.LEAP_SOUND;
    const { chime } = await loadNotify();
    expect(() => chime(100)).not.toThrow();
  });

  it("chime(NaN) does not throw when sound is disabled", async () => {
    delete process.env.LEAP_SOUND;
    const { chime } = await loadNotify();
    expect(() => chime(NaN)).not.toThrow();
  });

  it("chime(Infinity) does not throw when sound is disabled", async () => {
    delete process.env.LEAP_SOUND;
    const { chime } = await loadNotify();
    expect(() => chime(Infinity)).not.toThrow();
  });

  it("playSound with boundary volumes does not throw when sound is disabled", async () => {
    delete process.env.LEAP_SOUND;
    const { playSound } = await loadNotify();
    expect(() => playSound("/tmp/test.mp3", 0)).not.toThrow();
    expect(() => playSound("/tmp/test.mp3", -1)).not.toThrow();
    expect(() => playSound("/tmp/test.mp3", NaN)).not.toThrow();
    expect(() => playSound("/tmp/test.mp3", Infinity)).not.toThrow();
  });
});
