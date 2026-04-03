// ─── SSRF Protection (shared module) ─────────────────────────────────────
//
// Centralized SSRF validation used by:
//   - index.ts (navigate tool pre-check + post-redirect check)
//   - session-manager.ts (page.route interception for redirect chains)
//   - recording.ts (session_replay navigate steps)
//   - paginate.ts (URL-pattern pagination)
//
// checkSSRFSync()  — fast synchronous check (IP ranges, hostnames, TLDs)
// checkSSRF()      — full async check (sync checks + DNS resolution)

import * as dns from "dns/promises";
import * as net from "net";
import { logger } from "./logger.js";

// ─── Blocked ranges & hostnames ─────────────────────────────────────────

const BLOCKED_IP_RANGES = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^::1$/, /^fc00:/, /^fe80:/, /^fd/,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT range 100.64.0.0/10
  /^198\.1[89]\./, // Benchmarking range 198.18.0.0/15
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  // Cloud metadata hostnames
  'metadata.google.internal',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

/** TLDs that should be blocked outright */
const BLOCKED_TLDS = [
  '.internal',
];

// ─── IP format parsers ──────────────────────────────────────────────────

function isInternalIP(ip: string): boolean {
  return BLOCKED_IP_RANGES.some((r) => r.test(ip));
}

/**
 * Parse octal IP notation like 0177.0.0.1 -> 127.0.0.1
 * Returns null if not a valid octal IP.
 */
function parseOctalIP(hostname: string): string | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^0?\d+$/.test(part)) return null;
    const n = part.startsWith('0') && part.length > 1 ? parseInt(part, 8) : parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    nums.push(n);
  }
  return nums.join('.');
}

/**
 * Parse hex IP notation like 0x7f000001 -> 127.0.0.1
 * Returns null if not a valid hex IP.
 */
function parseHexIP(hostname: string): string | null {
  if (!/^0x[0-9a-fA-F]+$/.test(hostname)) return null;
  const num = parseInt(hostname, 16);
  if (isNaN(num) || num < 0 || num > 0xFFFFFFFF) return null;
  return [
    (num >>> 24) & 0xFF,
    (num >>> 16) & 0xFF,
    (num >>> 8) & 0xFF,
    num & 0xFF,
  ].join('.');
}

/**
 * Parse decimal IP notation like 2130706433 -> 127.0.0.1
 * Returns null if not a valid decimal IP.
 */
function parseDecimalIP(hostname: string): string | null {
  if (!/^\d+$/.test(hostname)) return null;
  const num = parseInt(hostname, 10);
  if (isNaN(num) || num < 0 || num > 0xFFFFFFFF) return null;
  return [
    (num >>> 24) & 0xFF,
    (num >>> 16) & 0xFF,
    (num >>> 8) & 0xFF,
    num & 0xFF,
  ].join('.');
}

/**
 * Extract the embedded IPv4 address from an IPv4-mapped IPv6 address.
 * Handles both dotted form (::ffff:127.0.0.1) and hex form (::ffff:7f00:1).
 * Returns the IPv4 address string, or null if not an IPv4-mapped IPv6.
 */
function extractIPv4FromMappedIPv6(ip: string): string | null {
  const lower = ip.toLowerCase();

  // Match ::ffff: prefix (case-insensitive)
  if (!lower.startsWith('::ffff:')) return null;

  const suffix = ip.slice(7); // strip "::ffff:"

  // Dotted form: ::ffff:127.0.0.1
  if (suffix.includes('.')) {
    // Validate it's a proper IPv4
    if (net.isIPv4(suffix)) return suffix;
    return null;
  }

  // Hex form: ::ffff:7f00:1 (URL constructor normalizes to this)
  // Two 16-bit hex groups representing the IPv4 address
  const hexParts = suffix.split(':');
  if (hexParts.length !== 2) return null;

  const hi = parseInt(hexParts[0], 16);
  const lo = parseInt(hexParts[1], 16);
  if (isNaN(hi) || isNaN(lo) || hi < 0 || hi > 0xFFFF || lo < 0 || lo > 0xFFFF) return null;

  return [
    (hi >>> 8) & 0xFF,
    hi & 0xFF,
    (lo >>> 8) & 0xFF,
    lo & 0xFF,
  ].join('.');
}

// ─── Synchronous SSRF check (fast path) ─────────────────────────────────

/**
 * Synchronous SSRF check covering:
 *   - Blocked hostnames (localhost, cloud metadata)
 *   - Blocked TLDs (.internal)
 *   - Direct IP ranges (IPv4, IPv6)
 *   - IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1)
 *   - Octal, hex, decimal IP encodings
 *
 * Returns a block reason string, or null if allowed.
 * Does NOT perform DNS resolution -- use checkSSRF() for full protection.
 */
export function checkSSRFSync(hostname: string): string | null {
  const lowerHostname = hostname.toLowerCase();

  // Blocked hostname check (localhost, cloud metadata, etc.)
  if (BLOCKED_HOSTNAMES.has(lowerHostname)) {
    return `Blocked: ${hostname} is a reserved hostname.`;
  }

  // Blocked TLD check (.internal)
  for (const tld of BLOCKED_TLDS) {
    if (lowerHostname === tld.slice(1) || lowerHostname.endsWith(tld)) {
      return `Blocked: ${hostname} uses a reserved TLD (${tld}).`;
    }
  }

  // IPv6 bracket notation: [::1] -> ::1
  let normalizedHost = hostname;
  if (normalizedHost.startsWith('[') && normalizedHost.endsWith(']')) {
    normalizedHost = normalizedHost.slice(1, -1);
  }

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  const mappedIPv4 = extractIPv4FromMappedIPv6(normalizedHost);
  if (mappedIPv4) {
    if (isInternalIP(mappedIPv4)) {
      return `Blocked: ${hostname} is an IPv4-mapped IPv6 address resolving to internal IP ${mappedIPv4}.`;
    }
    // It's a valid IPv4-mapped IPv6 pointing to a public IP -- allow
    return null;
  }

  // Direct IP check
  if (net.isIP(normalizedHost)) {
    if (isInternalIP(normalizedHost)) return `Blocked: ${hostname} is an internal IP address.`;
    return null;
  }

  // Hex IP notation: 0x7f000001 -> 127.0.0.1
  const hexResolved = parseHexIP(normalizedHost);
  if (hexResolved) {
    if (isInternalIP(hexResolved)) return `Blocked: ${hostname} resolves to internal IP ${hexResolved} (hex notation).`;
    return null;
  }

  // Octal IP notation: 0177.0.0.1 -> 127.0.0.1
  const octalResolved = parseOctalIP(normalizedHost);
  if (octalResolved) {
    if (isInternalIP(octalResolved)) return `Blocked: ${hostname} resolves to internal IP ${octalResolved} (octal notation).`;
    return null;
  }

  // Decimal IP notation: 2130706433 -> 127.0.0.1
  const decimalResolved = parseDecimalIP(normalizedHost);
  if (decimalResolved) {
    if (isInternalIP(decimalResolved)) return `Blocked: ${hostname} resolves to internal IP ${decimalResolved} (decimal notation).`;
    return null;
  }

  return null;
}

// ─── Full async SSRF check (sync + DNS) ─────────────────────────────────

/**
 * Full SSRF check: runs all synchronous checks, then performs DNS resolution
 * to catch hostnames that resolve to internal IPs (DNS rebinding, etc.).
 */
export async function checkSSRF(hostname: string): Promise<string | null> {
  // Run synchronous checks first (fast path)
  const syncResult = checkSSRFSync(hostname);
  if (syncResult !== null) return syncResult;

  // If it was a recognized IP format (direct, hex, octal, decimal, mapped IPv6),
  // the sync check already returned. Only hostnames reach here.

  // Strip brackets for DNS resolution
  let normalizedHost = hostname;
  if (normalizedHost.startsWith('[') && normalizedHost.endsWith(']')) {
    normalizedHost = normalizedHost.slice(1, -1);
  }

  // Skip DNS for raw IPs (already handled by sync check)
  if (net.isIP(normalizedHost)) return null;

  // DNS resolution check (catches DNS rebinding)
  try {
    const addresses = await dns.resolve4(normalizedHost);
    for (const addr of addresses) {
      if (isInternalIP(addr)) {
        return `Blocked: ${hostname} resolves to internal IP ${addr}.`;
      }
    }
  } catch {
    // DNS failure -- let the browser handle it (will show its own error)
  }
  return null;
}

// ─── Route handler for Playwright page interception ─────────────────────

/**
 * Install a Playwright route handler on a page that intercepts ALL requests
 * and blocks those targeting internal IPs / blocked hostnames.
 *
 * This catches redirect chains (302 -> internal IP) BEFORE the browser
 * follows them, closing the TOCTOU gap in the post-navigation check.
 *
 * Uses the synchronous check only (no DNS) to avoid blocking the request
 * pipeline. DNS-based checks are still applied at the navigate tool level.
 */
export async function installSSRFRouteGuard(page: import("playwright-core").Page): Promise<void> {
  await page.route('**/*', (route) => {
    try {
      const url = new URL(route.request().url());

      // Only check http/https -- allow data:, blob:, etc.
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        route.continue().catch(() => {});
        return;
      }

      const blockReason = checkSSRFSync(url.hostname);
      if (blockReason) {
        logger.warn("security.ssrf_route_blocked", {
          url: route.request().url(),
          hostname: url.hostname,
          reason: blockReason,
        });
        route.abort('blockedbyclient').catch(() => {});
        return;
      }

      route.continue().catch(() => {});
    } catch {
      // URL parse error or other failure -- let the request through
      // rather than breaking legitimate navigation
      route.continue().catch(() => {});
    }
  });
}
