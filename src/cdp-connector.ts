// ─── CDP Connector ─────────────────────────────────────────────────────────
//
// Connects Leapfrog to an already-running Chrome instance via CDP.
// User launches Chrome with --remote-debugging-port=9222, and Leapfrog
// attaches to use real cookies, extensions, and OAuth tokens.

import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import { logger } from "./logger.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CdpDiscoveryResult {
  endpoint: string;       // e.g. "http://localhost:9222"
  browser: string;        // e.g. "Chrome", "Brave", "Canary", "Chromium"
  source: "env" | "param" | "devtools-port-file" | "port-scan";
}

// ─── Port File Locations ───────────────────────────────────────────────────

interface PortFileEntry {
  /** Path to DevToolsActivePort file (relative to home or absolute) */
  path: string;
  /** Browser display name */
  browser: string;
}

function getPortFileEntries(): PortFileEntry[] {
  const home = os.homedir();
  const platform = os.platform();

  if (platform === "darwin") {
    const base = path.join(home, "Library", "Application Support");
    return [
      { path: path.join(base, "Google", "Chrome", "DevToolsActivePort"), browser: "Chrome" },
      { path: path.join(base, "Google", "Chrome Canary", "DevToolsActivePort"), browser: "Canary" },
      { path: path.join(base, "BraveSoftware", "Brave-Browser", "DevToolsActivePort"), browser: "Brave" },
      { path: path.join(base, "Chromium", "DevToolsActivePort"), browser: "Chromium" },
    ];
  }

  if (platform === "linux") {
    return [
      { path: path.join(home, ".config", "google-chrome", "DevToolsActivePort"), browser: "Chrome" },
      { path: path.join(home, ".config", "google-chrome-canary", "DevToolsActivePort"), browser: "Canary" },
      { path: path.join(home, ".config", "BraveSoftware", "Brave-Browser", "DevToolsActivePort"), browser: "Brave" },
      { path: path.join(home, ".config", "chromium", "DevToolsActivePort"), browser: "Chromium" },
    ];
  }

  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return [
      { path: path.join(localAppData, "Google", "Chrome", "User Data", "DevToolsActivePort"), browser: "Chrome" },
      { path: path.join(localAppData, "Google", "Chrome SxS", "User Data", "DevToolsActivePort"), browser: "Canary" },
      { path: path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data", "DevToolsActivePort"), browser: "Brave" },
      { path: path.join(localAppData, "Chromium", "User Data", "DevToolsActivePort"), browser: "Chromium" },
    ];
  }

  return [];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Parse DevToolsActivePort file: line 1 = port, line 2 = path */
export function parseDevToolsActivePort(contents: string): number | null {
  const lines = contents.trim().split("\n");
  if (lines.length < 1) return null;
  const port = parseInt(lines[0].trim(), 10);
  return Number.isFinite(port) && port > 0 && port < 65536 ? port : null;
}

/** Probe a single port via HTTP GET /json/version with a tight timeout */
export function probePort(port: number, timeoutMs = 500): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "127.0.0.1", port, path: "/json/version", timeout: timeoutMs },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => {
          try {
            const json = JSON.parse(body) as { Browser?: string; webSocketDebuggerUrl?: string };
            resolve(json.Browser ?? "Chrome");
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

// ─── CDP Connector ─────────────────────────────────────────────────────────

const SCAN_PORTS = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229];

export class CdpConnector {
  /**
   * Discover available CDP endpoints on this machine.
   * Checks env var, DevToolsActivePort files, and scans common ports in parallel.
   * Total time target: <2s.
   */
  static async discover(): Promise<CdpDiscoveryResult[]> {
    const results: CdpDiscoveryResult[] = [];

    // 1. Environment variable — highest priority
    const envEndpoint = process.env.LEAP_CDP_ENDPOINT;
    if (envEndpoint) {
      results.push({ endpoint: envEndpoint, browser: "Chrome", source: "env" });
    }

    // 2. Run port-file checks and port scans in parallel
    const [portFileResults, portScanResults] = await Promise.all([
      CdpConnector.discoverFromPortFiles(),
      CdpConnector.discoverFromPortScan(),
    ]);

    results.push(...portFileResults, ...portScanResults);

    // Deduplicate by endpoint
    const seen = new Set<string>();
    const deduped: CdpDiscoveryResult[] = [];
    for (const r of results) {
      const key = r.endpoint.replace(/\/$/, "");
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(r);
      }
    }

    logger.debug("cdp.discover", { found: deduped.length });
    return deduped;
  }

  /** Check all known DevToolsActivePort file locations */
  static async discoverFromPortFiles(): Promise<CdpDiscoveryResult[]> {
    const entries = getPortFileEntries();
    const results: CdpDiscoveryResult[] = [];

    const checks = entries.map(async (entry) => {
      try {
        const contents = await fs.readFile(entry.path, "utf-8");
        const port = parseDevToolsActivePort(contents);
        if (port) {
          results.push({
            endpoint: `http://localhost:${port}`,
            browser: entry.browser,
            source: "devtools-port-file",
          });
        }
      } catch {
        // File doesn't exist or isn't readable — expected
      }
    });

    await Promise.all(checks);
    return results;
  }

  /** Scan common debug ports (9222-9229) for active CDP endpoints */
  static async discoverFromPortScan(): Promise<CdpDiscoveryResult[]> {
    const results: CdpDiscoveryResult[] = [];

    const probes = SCAN_PORTS.map(async (port) => {
      const browserName = await probePort(port);
      if (browserName) {
        results.push({
          endpoint: `http://localhost:${port}`,
          browser: browserName,
          source: "port-scan",
        });
      }
    });

    await Promise.all(probes);
    return results;
  }

  /** Connect to a CDP endpoint. Returns a Playwright Browser object. */
  static async connect(endpoint: string): Promise<Browser> {
    logger.info("cdp.connect", { endpoint });
    try {
      const browser = await chromium.connectOverCDP(endpoint);
      logger.info("cdp.connected", { endpoint, contexts: browser.contexts().length });
      return browser;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error("cdp.connect_failed", { endpoint, error: msg });
      throw new Error(`CDP connection failed to ${endpoint}: ${msg}`);
    }
  }

  /**
   * Get the best available endpoint and connect.
   * Priority: LEAP_CDP_ENDPOINT env > DevToolsActivePort file > port scan
   */
  static async autoConnect(): Promise<{ browser: Browser; info: CdpDiscoveryResult }> {
    const results = await CdpConnector.discover();

    if (results.length === 0) {
      throw new Error(
        "No CDP endpoint found. Launch Chrome with --remote-debugging-port=9222 " +
        "or set LEAP_CDP_ENDPOINT environment variable.",
      );
    }

    // Take the first (highest priority) result
    const info = results[0];
    logger.info("cdp.auto_connect", { endpoint: info.endpoint, browser: info.browser, source: info.source });
    const browser = await CdpConnector.connect(info.endpoint);
    return { browser, info };
  }
}

export default CdpConnector;
