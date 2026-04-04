import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkSSRFSync, checkSSRF } from '../ssrf.js';

// ---------------------------------------------------------------------------
// SSRF Protection Tests
//
// Tests the REAL production functions from src/ssrf.ts.
// checkSSRFSync() returns a block reason string (truthy) or null (allowed).
// checkSSRF() is the async version that adds DNS resolution on top.
//
// NOTE: Localhost/loopback is ALLOWED by default. Tests that verify blocking
// of 127.x.x.x and localhost set LEAP_BLOCK_LOCALHOST=true via beforeEach.
// ---------------------------------------------------------------------------

// Block localhost for existing SSRF blocking tests
beforeEach(() => { process.env.LEAP_BLOCK_LOCALHOST = 'true'; });
afterEach(() => { delete process.env.LEAP_BLOCK_LOCALHOST; });

// ── Helpers ────────────────────────────────────────────────────────────────

/** Assert that a hostname IS blocked by checkSSRFSync */
function expectBlocked(hostname: string, partialReason?: string) {
  const result = checkSSRFSync(hostname);
  expect(result, `Expected "${hostname}" to be blocked, but it was allowed`).not.toBeNull();
  if (partialReason) {
    expect(result).toContain(partialReason);
  }
}

/** Assert that a hostname is ALLOWED by checkSSRFSync */
function expectAllowed(hostname: string) {
  const result = checkSSRFSync(hostname);
  expect(result, `Expected "${hostname}" to be allowed, but got: ${result}`).toBeNull();
}

// ---------------------------------------------------------------------------
// A. IPv4 Internal IPs (should block)
// ---------------------------------------------------------------------------

describe('SSRF — IPv4 internal IPs', () => {
  it('blocks 127.0.0.1 (loopback)', () => {
    expectBlocked('127.0.0.1', 'internal IP');
  });

  it('blocks 127.0.0.2 (loopback range)', () => {
    expectBlocked('127.0.0.2', 'internal IP');
  });

  it('blocks 127.255.255.255 (loopback high end)', () => {
    expectBlocked('127.255.255.255', 'internal IP');
  });

  it('blocks 10.0.0.1 (private class A)', () => {
    expectBlocked('10.0.0.1', 'internal IP');
  });

  it('blocks 10.255.255.255 (private class A high end)', () => {
    expectBlocked('10.255.255.255', 'internal IP');
  });

  it('blocks 172.16.0.1 (private class B low end)', () => {
    expectBlocked('172.16.0.1', 'internal IP');
  });

  it('blocks 172.31.255.255 (private class B high end)', () => {
    expectBlocked('172.31.255.255', 'internal IP');
  });

  it('blocks 192.168.1.1 (private class C)', () => {
    expectBlocked('192.168.1.1', 'internal IP');
  });

  it('blocks 192.168.0.0 (private class C network)', () => {
    expectBlocked('192.168.0.0', 'internal IP');
  });

  it('blocks 169.254.169.254 (AWS metadata / link-local)', () => {
    expectBlocked('169.254.169.254', 'internal IP');
  });

  it('blocks 169.254.0.1 (link-local range)', () => {
    expectBlocked('169.254.0.1', 'internal IP');
  });

  it('blocks 100.64.0.0 (CGNAT low end)', () => {
    expectBlocked('100.64.0.0', 'internal IP');
  });

  it('blocks 100.127.255.255 (CGNAT high end)', () => {
    expectBlocked('100.127.255.255', 'internal IP');
  });

  it('blocks 0.0.0.0 (unspecified)', () => {
    expectBlocked('0.0.0.0', 'internal IP');
  });

  it('blocks 198.18.0.1 (benchmarking range)', () => {
    expectBlocked('198.18.0.1', 'internal IP');
  });

  it('blocks 198.19.255.255 (benchmarking high end)', () => {
    expectBlocked('198.19.255.255', 'internal IP');
  });

  // Boundary: just outside blocked ranges should be allowed
  it('allows 172.15.255.255 (just below private class B)', () => {
    expectAllowed('172.15.255.255');
  });

  it('allows 172.32.0.0 (just above private class B)', () => {
    expectAllowed('172.32.0.0');
  });

  it('allows 100.63.255.255 (just below CGNAT)', () => {
    expectAllowed('100.63.255.255');
  });

  it('allows 100.128.0.0 (just above CGNAT)', () => {
    expectAllowed('100.128.0.0');
  });
});

// ---------------------------------------------------------------------------
// B. IPv4-mapped IPv6 (P0 SSRF bypass vector)
// ---------------------------------------------------------------------------

describe('SSRF — IPv4-mapped IPv6', () => {
  it('blocks ::ffff:127.0.0.1 (dotted loopback)', () => {
    expectBlocked('::ffff:127.0.0.1', 'IPv4-mapped IPv6');
  });

  it('blocks ::ffff:10.0.0.1 (dotted private)', () => {
    expectBlocked('::ffff:10.0.0.1', 'IPv4-mapped IPv6');
  });

  it('blocks ::ffff:192.168.1.1 (dotted private class C)', () => {
    expectBlocked('::ffff:192.168.1.1', 'IPv4-mapped IPv6');
  });

  it('blocks ::ffff:169.254.169.254 (dotted AWS metadata)', () => {
    expectBlocked('::ffff:169.254.169.254', 'IPv4-mapped IPv6');
  });

  it('blocks ::ffff:7f00:1 (hex form of 127.0.0.1)', () => {
    expectBlocked('::ffff:7f00:1', 'IPv4-mapped IPv6');
  });

  it('blocks ::ffff:a00:1 (hex form of 10.0.0.1)', () => {
    expectBlocked('::ffff:a00:1', 'IPv4-mapped IPv6');
  });

  it('blocks ::ffff:c0a8:101 (hex form of 192.168.1.1)', () => {
    expectBlocked('::ffff:c0a8:101', 'IPv4-mapped IPv6');
  });

  it('blocks ::ffff:a9fe:a9fe (hex form of 169.254.169.254)', () => {
    expectBlocked('::ffff:a9fe:a9fe', 'IPv4-mapped IPv6');
  });

  it('allows ::ffff:8.8.8.8 (public IP in mapped form)', () => {
    expectAllowed('::ffff:8.8.8.8');
  });

  it('allows ::ffff:808:808 (hex form of 8.8.8.8)', () => {
    expectAllowed('::ffff:808:808');
  });

  it('blocks ::FFFF:127.0.0.1 (uppercase prefix)', () => {
    expectBlocked('::FFFF:127.0.0.1', 'IPv4-mapped IPv6');
  });
});

// ---------------------------------------------------------------------------
// C. IPv6 Internal Addresses
// ---------------------------------------------------------------------------

describe('SSRF — IPv6 internal addresses', () => {
  it('blocks ::1 (loopback)', () => {
    expectBlocked('::1', 'internal IP');
  });

  it('blocks fe80::1 (link-local)', () => {
    expectBlocked('fe80::1', 'internal IP');
  });

  it('blocks fe80::abcd:1234 (link-local with interface)', () => {
    expectBlocked('fe80::abcd:1234', 'internal IP');
  });

  it('blocks fc00::1 (unique local address)', () => {
    expectBlocked('fc00::1', 'internal IP');
  });

  it('blocks fd00::1 (unique local address)', () => {
    expectBlocked('fd00::1', 'internal IP');
  });

  it('blocks fd12:3456:789a::1 (ULA with prefix)', () => {
    expectBlocked('fd12:3456:789a::1', 'internal IP');
  });

  // Bracket notation (as extracted from URLs)
  it('blocks [::1] with bracket notation', () => {
    expectBlocked('[::1]', 'internal IP');
  });

  it('blocks [fe80::1] with bracket notation', () => {
    expectBlocked('[fe80::1]', 'internal IP');
  });

  it('blocks [fc00::1] with bracket notation', () => {
    expectBlocked('[fc00::1]', 'internal IP');
  });
});

// ---------------------------------------------------------------------------
// D. Blocked Hostnames
// ---------------------------------------------------------------------------

describe('SSRF — blocked hostnames', () => {
  it('blocks localhost', () => {
    expectBlocked('localhost', 'reserved hostname');
  });

  it('blocks localhost.localdomain', () => {
    expectBlocked('localhost.localdomain', 'reserved hostname');
  });

  it('blocks ip6-localhost', () => {
    expectBlocked('ip6-localhost', 'reserved hostname');
  });

  it('blocks ip6-loopback', () => {
    expectBlocked('ip6-loopback', 'reserved hostname');
  });

  it('blocks metadata.google.internal (cloud metadata)', () => {
    expectBlocked('metadata.google.internal', 'reserved hostname');
  });

  it('blocks kubernetes.default.svc', () => {
    expectBlocked('kubernetes.default.svc', 'reserved hostname');
  });

  it('blocks kubernetes.default.svc.cluster.local', () => {
    expectBlocked('kubernetes.default.svc.cluster.local', 'reserved hostname');
  });

  // Case insensitivity
  it('blocks LOCALHOST (case insensitive)', () => {
    expectBlocked('LOCALHOST', 'reserved hostname');
  });

  it('blocks LocalHost (mixed case)', () => {
    expectBlocked('LocalHost', 'reserved hostname');
  });
});

// ---------------------------------------------------------------------------
// E. Blocked TLDs
// ---------------------------------------------------------------------------

describe('SSRF — blocked TLDs', () => {
  it('blocks anything.internal', () => {
    expectBlocked('anything.internal', 'reserved TLD');
  });

  it('blocks deep.nested.host.internal', () => {
    expectBlocked('deep.nested.host.internal', 'reserved TLD');
  });

  it('blocks just "internal" (bare TLD)', () => {
    expectBlocked('internal', 'reserved TLD');
  });

  it('blocks ANYTHING.INTERNAL (case insensitive)', () => {
    expectBlocked('ANYTHING.INTERNAL', 'reserved TLD');
  });

  // Should NOT block similar-looking but different TLDs
  it('allows example.international (not .internal)', () => {
    expectAllowed('example.international');
  });

  it('allows internal.example.com (internal as subdomain, not TLD)', () => {
    expectAllowed('internal.example.com');
  });
});

// ---------------------------------------------------------------------------
// F. Legitimate Hostnames & IPs (should ALLOW)
// ---------------------------------------------------------------------------

describe('SSRF — legitimate hosts (should allow)', () => {
  it('allows google.com', () => {
    expectAllowed('google.com');
  });

  it('allows github.com', () => {
    expectAllowed('github.com');
  });

  it('allows example.com', () => {
    expectAllowed('example.com');
  });

  it('allows www.example.com', () => {
    expectAllowed('www.example.com');
  });

  it('allows 93.184.216.34 (example.com public IP)', () => {
    expectAllowed('93.184.216.34');
  });

  it('allows 8.8.8.8 (Google DNS)', () => {
    expectAllowed('8.8.8.8');
  });

  it('allows 1.1.1.1 (Cloudflare DNS)', () => {
    expectAllowed('1.1.1.1');
  });

  it('allows 203.0.113.1 (documentation range, but not blocked)', () => {
    expectAllowed('203.0.113.1');
  });

  it('allows subdomain.example.org', () => {
    expectAllowed('subdomain.example.org');
  });
});

// ---------------------------------------------------------------------------
// G. Special IP Encodings (obfuscation attacks)
// ---------------------------------------------------------------------------

describe('SSRF — octal IP encoding', () => {
  it('blocks 0177.0.0.1 (octal 127.0.0.1)', () => {
    expectBlocked('0177.0.0.1', 'octal');
  });

  it('blocks 012.0.0.1 (octal 10.0.0.1)', () => {
    expectBlocked('012.0.0.1', 'octal');
  });

  it('blocks 0300.0250.0251.0376 (octal 192.168.169.254)', () => {
    expectBlocked('0300.0250.0251.0376', 'octal');
  });
});

describe('SSRF — decimal IP encoding', () => {
  it('blocks 2130706433 (decimal for 127.0.0.1)', () => {
    expectBlocked('2130706433', 'decimal');
  });

  it('blocks 167772161 (decimal for 10.0.0.1)', () => {
    expectBlocked('167772161', 'decimal');
  });

  it('blocks 3232235777 (decimal for 192.168.1.1)', () => {
    expectBlocked('3232235777', 'decimal');
  });

  it('blocks 2852039166 (decimal for 169.254.169.254)', () => {
    expectBlocked('2852039166', 'decimal');
  });

  // Public IP in decimal should be allowed
  it('allows 134744072 (decimal for 8.8.8.8)', () => {
    expectAllowed('134744072');
  });
});

describe('SSRF — hex IP encoding', () => {
  it('blocks 0x7f000001 (hex for 127.0.0.1)', () => {
    expectBlocked('0x7f000001', 'hex');
  });

  it('blocks 0x0a000001 (hex for 10.0.0.1)', () => {
    expectBlocked('0x0a000001', 'hex');
  });

  it('blocks 0xc0a80101 (hex for 192.168.1.1)', () => {
    expectBlocked('0xc0a80101', 'hex');
  });

  it('blocks 0xa9fea9fe (hex for 169.254.169.254)', () => {
    expectBlocked('0xa9fea9fe', 'hex');
  });

  // Public IP in hex should be allowed
  it('allows 0x08080808 (hex for 8.8.8.8)', () => {
    expectAllowed('0x08080808');
  });

  // Case insensitivity in hex
  it('blocks 0x7F000001 (uppercase hex)', () => {
    expectBlocked('0x7F000001', 'hex');
  });
});

// ---------------------------------------------------------------------------
// H. Edge Cases
// ---------------------------------------------------------------------------

describe('SSRF — edge cases', () => {
  it('allows empty string (no crash, not blocked)', () => {
    // Empty string is not a valid IP or hostname, so sync check should not block.
    // The caller (navigate tool) validates the URL before extracting hostname.
    const result = checkSSRFSync('');
    // Either null (allowed) or a block reason -- just verify no exception
    expect(typeof result === 'string' || result === null).toBe(true);
  });

  it('handles hostname with port stripped (just hostname part)', () => {
    // URL constructor extracts hostname without port, so checkSSRFSync
    // receives just the hostname. Verify the hostname part is blocked.
    expectBlocked('localhost'); // port would be stripped by URL parser
    expectBlocked('127.0.0.1');
  });

  it('handles IPv6 in bracket notation from URL parser', () => {
    // new URL('http://[::1]:8080/').hostname === '::1' (no brackets in modern Node)
    // But some parsers include brackets, so test both
    expectBlocked('::1');
    expectBlocked('[::1]');
  });

  it('does not block normal domain that looks similar to blocked ones', () => {
    expectAllowed('notlocalhost.com');
    expectAllowed('my-localhost.example.com');
    expectAllowed('localhost.com'); // .com TLD, not bare localhost
  });

  it('handles very long hostnames without crashing', () => {
    const long = 'a'.repeat(253) + '.com';
    const result = checkSSRFSync(long);
    // Should not throw, just return null (allowed) or a reason
    expect(typeof result === 'string' || result === null).toBe(true);
  });

  it('blocks 0.0.0.0 (all-zeros IPv4)', () => {
    expectBlocked('0.0.0.0', 'internal IP');
  });
});

// ---------------------------------------------------------------------------
// I. Async checkSSRF — full path including DNS resolution
// ---------------------------------------------------------------------------

describe('SSRF — async checkSSRF()', () => {
  it('blocks localhost synchronously (no DNS needed)', async () => {
    const result = await checkSSRF('localhost');
    expect(result).not.toBeNull();
    expect(result).toContain('reserved hostname');
  });

  it('blocks 127.0.0.1 synchronously (no DNS needed)', async () => {
    const result = await checkSSRF('127.0.0.1');
    expect(result).not.toBeNull();
    expect(result).toContain('internal IP');
  });

  it('blocks ::ffff:127.0.0.1 synchronously', async () => {
    const result = await checkSSRF('::ffff:127.0.0.1');
    expect(result).not.toBeNull();
    expect(result).toContain('IPv4-mapped IPv6');
  });

  it('blocks 0x7f000001 (hex) synchronously', async () => {
    const result = await checkSSRF('0x7f000001');
    expect(result).not.toBeNull();
    expect(result).toContain('hex');
  });

  it('blocks anything.internal synchronously', async () => {
    const result = await checkSSRF('anything.internal');
    expect(result).not.toBeNull();
    expect(result).toContain('reserved TLD');
  });

  it('allows a public hostname (DNS resolves to public IP)', async () => {
    // This test makes a real DNS call -- skip if offline
    const result = await checkSSRF('example.com');
    // example.com resolves to 93.184.216.34 (public), should be allowed
    expect(result).toBeNull();
  });

  it('allows a public IP without DNS call', async () => {
    const result = await checkSSRF('8.8.8.8');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// J. Return value format validation
// ---------------------------------------------------------------------------

describe('SSRF — return value format', () => {
  it('returns null for allowed hosts', () => {
    expect(checkSSRFSync('example.com')).toBeNull();
  });

  it('returns a non-empty string for blocked hosts', () => {
    const result = checkSSRFSync('127.0.0.1');
    expect(result).toBeTypeOf('string');
    expect(result!.length).toBeGreaterThan(0);
  });

  it('includes "Blocked:" prefix in reason string', () => {
    expect(checkSSRFSync('127.0.0.1')).toMatch(/^Blocked:/);
    expect(checkSSRFSync('localhost')).toMatch(/^Blocked:/);
    expect(checkSSRFSync('foo.internal')).toMatch(/^Blocked:/);
    expect(checkSSRFSync('::ffff:127.0.0.1')).toMatch(/^Blocked:/);
    expect(checkSSRFSync('0x7f000001')).toMatch(/^Blocked:/);
    expect(checkSSRFSync('2130706433')).toMatch(/^Blocked:/);
    expect(checkSSRFSync('0177.0.0.1')).toMatch(/^Blocked:/);
  });

  it('includes the original hostname in the reason', () => {
    expect(checkSSRFSync('192.168.1.1')).toContain('192.168.1.1');
    expect(checkSSRFSync('localhost')).toContain('localhost');
    expect(checkSSRFSync('evil.internal')).toContain('evil.internal');
  });
});

// ---------------------------------------------------------------------------
// J. Localhost allow-by-default (LEAP_BLOCK_LOCALHOST not set)
// ---------------------------------------------------------------------------

describe('SSRF — localhost allowed by default', () => {
  beforeEach(() => { delete process.env.LEAP_BLOCK_LOCALHOST; });

  it('allows localhost by default', () => {
    expectAllowed('localhost');
  });

  it('allows localhost.localdomain by default', () => {
    expectAllowed('localhost.localdomain');
  });

  it('allows 127.0.0.1 by default', () => {
    expectAllowed('127.0.0.1');
  });

  it('allows ::1 by default', () => {
    expectAllowed('::1');
  });

  it('still blocks other internal IPs by default', () => {
    expectBlocked('10.0.0.1', 'internal IP');
    expectBlocked('192.168.1.1', 'internal IP');
    expectBlocked('172.16.0.1', 'internal IP');
    expectBlocked('169.254.169.254', 'internal IP');
  });

  it('still blocks cloud metadata by default', () => {
    expectBlocked('metadata.google.internal');
  });

  it('blocks localhost when LEAP_BLOCK_LOCALHOST=true', () => {
    process.env.LEAP_BLOCK_LOCALHOST = 'true';
    expectBlocked('localhost', 'reserved hostname');
    expectBlocked('127.0.0.1', 'internal IP');
    delete process.env.LEAP_BLOCK_LOCALHOST;
  });
});
