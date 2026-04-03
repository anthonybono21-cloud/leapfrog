import { logger } from "./logger.js";
import type { Session } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ApiCategory = "data" | "tracking" | "auth" | "cdn" | "ads";

export interface ApiCapture {
  index: number;
  url: string;
  method: string;
  status: number;
  bodySize: number;
  parsedBody?: unknown;
  rawBody?: string;
  bodyTruncated?: boolean;
  category: ApiCategory;
  confidence: number;
  classifiedBy: "domain" | "url-pattern" | "response-shape" | "heuristic" | "default";
  headers: Record<string, string>;
  timestamp: number;
  duration: number;
  dataShape?: Record<string, string>;
  graphql?: {
    operationName: string | null;
    operationType: "query" | "mutation" | "subscription" | null;
  };
  contentType: string;
}

export interface ApiDiscoverResult {
  total: number;
  captured: ApiCapture[];
  summary: { data: number; tracking: number; auth: number; cdn: number; ads: number };
}

export interface OpenApiSpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, unknown>;
  components?: { securitySchemes?: Record<string, unknown>; schemas?: Record<string, unknown> };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_API_ENTRIES = 50;
const MAX_API_BODY_BYTES = 256 * 1024;

const JSON_CONTENT_TYPES = [
  "application/json",
  "application/graphql+json",
  "application/vnd.api+json",
  "application/hal+json",
  "text/json",
];

const ELIGIBLE_RESOURCE_TYPES = ["xhr", "fetch"];

// ─── Domain Blocklists ───────────────────────────────────────────────────────

const TRACKING_DOMAINS: string[] = [
  "google-analytics.com",
  "analytics.google.com",
  "www.googletagmanager.com",
  "stats.g.doubleclick.net",
  "api.segment.io",
  "cdn.segment.com",
  "api.mixpanel.com",
  "api-js.mixpanel.com",
  "connect.facebook.net",
  "www.facebook.com",
  "api2.amplitude.com",
  "cdn.amplitude.com",
  "heapanalytics.com",
  "script.hotjar.com",
  "vars.hotjar.com",
  "edge.fullstory.com",
  "browser-intake-datadoghq.com",
  "sentry.io",
  "bam.nr-data.net",
  "js-agent.newrelic.com",
  "events.launchdarkly.com",
  "clientstream.launchdarkly.com",
  "api-iam.intercom.io",
  "widget.intercom.io",
];

const AD_DOMAINS: string[] = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "amazon-adsystem.com",
  "ads-api.twitter.com",
  "ads.linkedin.com",
  "adsapi.snapchat.com",
  "an.facebook.com",
  "moat.com",
  "adsrvr.org",
  "criteo.com",
  "outbrain.com",
  "taboola.com",
  "pubmatic.com",
  "rubiconproject.com",
  "openx.net",
  "casalemedia.com",
  "sharethrough.com",
];

// ─── URL Pattern Classifiers ─────────────────────────────────────────────────

const URL_CLASSIFIERS: Array<{ pattern: RegExp; category: ApiCategory }> = [
  // Auth patterns
  { pattern: /\/(oauth|auth|login|logout|signin|signup|token|csrf|session|sso)\b/i, category: "auth" },
  { pattern: /\/(\.well-known\/openid|authorize|callback|refresh)\b/i, category: "auth" },
  // Tracking patterns on first-party domains
  { pattern: /\/(collect|beacon|pixel|telemetry|ping|heartbeat|log-event)\b/i, category: "tracking" },
  { pattern: /\/(analytics|tracking|metrics|events\/track)\b/i, category: "tracking" },
  { pattern: /\/_analytics/i, category: "tracking" },
  // CDN / static config patterns
  { pattern: /\/(manifest\.json|sw\.js|service-worker|workbox)/i, category: "cdn" },
  { pattern: /\/(_next\/data|__next|_nuxt)\//i, category: "data" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isJsonContentType(contentType: string): boolean {
  const lower = contentType.toLowerCase();
  return JSON_CONTENT_TYPES.some((ct) => lower.startsWith(ct));
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function matchesDomain(hostname: string, domains: string[]): boolean {
  const lower = hostname.toLowerCase();
  return domains.some((d) => lower === d || lower.endsWith("." + d));
}

function isGraphqlUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return /\/graphql\b/i.test(pathname);
  } catch {
    return false;
  }
}

function parseGraphqlRequest(requestBody: string | undefined): {
  operationName: string | null;
  operationType: "query" | "mutation" | "subscription" | null;
} | null {
  if (!requestBody) return null;
  try {
    const parsed = JSON.parse(requestBody);
    const queryStr: string | undefined = parsed.query;
    let opType: "query" | "mutation" | "subscription" | null = null;
    if (typeof queryStr === "string") {
      const trimmed = queryStr.trimStart();
      if (trimmed.startsWith("mutation")) opType = "mutation";
      else if (trimmed.startsWith("subscription")) opType = "subscription";
      else opType = "query";
    }
    return {
      operationName: parsed.operationName ?? null,
      operationType: opType,
    };
  } catch {
    return null;
  }
}

function inferDataShape(body: unknown): Record<string, string> | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const shape: Record<string, string> = {};
  const obj = body as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (value === null) shape[key] = "null";
    else if (Array.isArray(value)) shape[key] = `array(${value.length})`;
    else if (typeof value === "object") shape[key] = "object";
    else shape[key] = typeof value;
  }
  return Object.keys(shape).length > 0 ? shape : undefined;
}

function classifyByShape(body: unknown): { category: ApiCategory; confidence: number } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Auth response shapes
  if (
    keys.includes("access_token") ||
    keys.includes("refresh_token") ||
    keys.includes("id_token") ||
    keys.includes("csrf_token") ||
    (keys.includes("token") && keys.includes("expires_in"))
  ) {
    return { category: "auth", confidence: 0.8 };
  }

  // Tracking acknowledgment shapes (tiny success-only)
  if (
    keys.length <= 2 &&
    (keys.includes("success") || keys.includes("ok") || keys.includes("status")) &&
    !keys.some((k) => Array.isArray(obj[k]) || (typeof obj[k] === "object" && obj[k] !== null))
  ) {
    return { category: "tracking", confidence: 0.8 };
  }

  return null;
}

function classifyByHeuristic(
  method: string,
  bodySize: number,
): { category: ApiCategory; confidence: number } | null {
  // POST with tiny response is likely tracking beacon
  if (method === "POST" && bodySize < 100) {
    return { category: "tracking", confidence: 0.6 };
  }
  // GET with substantial JSON is likely data
  if (method === "GET" && bodySize > 500) {
    return { category: "data", confidence: 0.6 };
  }
  return null;
}

/** UUID regex: 8-4-4-4-12 hex chars */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pure numeric segment */
const NUMERIC_REGEX = /^\d+$/;

/** Long hash-like segment (>20 chars, hex or alphanum) */
const HASH_REGEX = /^[0-9a-f]{21,}$/i;

function isParameterSegment(segment: string): boolean {
  if (NUMERIC_REGEX.test(segment)) return true;
  if (UUID_REGEX.test(segment)) return true;
  if (segment.length > 20 && HASH_REGEX.test(segment)) return true;
  return false;
}

function templatizePath(pathname: string): string {
  return pathname
    .split("/")
    .map((seg) => (seg && isParameterSegment(seg) ? "{id}" : seg))
    .join("/");
}

// ─── Module-Level Storage ────────────────────────────────────────────────────

const captureStore = new Map<string, ApiCapture[]>();
let globalIndex = 0;

function getCaptures(sessionId: string): ApiCapture[] {
  let arr = captureStore.get(sessionId);
  if (!arr) {
    arr = [];
    captureStore.set(sessionId, arr);
  }
  return arr;
}

function pushToRingBuffer(buffer: ApiCapture[], entry: ApiCapture): void {
  if (buffer.length >= MAX_API_ENTRIES) {
    buffer.shift();
  }
  buffer.push(entry);
}

// ─── ApiIntelligence ─────────────────────────────────────────────────────────

export class ApiIntelligence {
  /**
   * Classify a URL + response into a category.
   * Exported for testability.
   */
  static classify(
    url: string,
    headers: Record<string, string>,
    body: unknown,
    method: string,
    bodySize: number,
  ): { category: ApiCategory; confidence: number; classifiedBy: string } {
    const hostname = extractHostname(url);

    // Layer 1: Known domain blocklist
    if (matchesDomain(hostname, TRACKING_DOMAINS)) {
      return { category: "tracking", confidence: 1.0, classifiedBy: "domain" };
    }
    if (matchesDomain(hostname, AD_DOMAINS)) {
      return { category: "ads", confidence: 1.0, classifiedBy: "domain" };
    }

    // Layer 2: URL path patterns
    let pathname = "";
    try {
      pathname = new URL(url).pathname;
    } catch {
      /* ignore */
    }
    for (const { pattern, category } of URL_CLASSIFIERS) {
      if (pattern.test(pathname)) {
        return { category, confidence: 0.9, classifiedBy: "url-pattern" };
      }
    }

    // Layer 3: Response shape analysis
    const shapeResult = classifyByShape(body);
    if (shapeResult) {
      return { ...shapeResult, classifiedBy: "response-shape" };
    }

    // Layer 4: Size/method heuristics
    const heuristicResult = classifyByHeuristic(method, bodySize);
    if (heuristicResult) {
      return { ...heuristicResult, classifiedBy: "heuristic" };
    }

    // Default
    return { category: "data", confidence: 0.5, classifiedBy: "default" };
  }

  /**
   * Process a response event and store if it's a JSON API call.
   * Designed to be called from the existing response listener in network-intelligence.ts.
   */
  static capture(
    session: Session,
    url: string,
    method: string,
    status: number,
    headers: Record<string, string>,
    body: Buffer | null,
    duration: number,
    resourceType: string,
    requestHeaders?: Record<string, string>,
    requestBody?: string,
  ): void {
    try {
      // Skip non-XHR/fetch
      if (!ELIGIBLE_RESOURCE_TYPES.includes(resourceType)) return;

      // Skip OPTIONS (CORS preflight)
      if (method === "OPTIONS" || method === "HEAD") return;

      // Skip non-success responses
      if (status < 200 || status > 399) return;

      const contentType = (headers["content-type"] ?? "").toLowerCase();
      if (!isJsonContentType(contentType)) return;

      const captures = getCaptures(session.id);

      let parsedBody: unknown;
      let rawBody: string | undefined;
      let bodyTruncated = false;
      let bodySize = 0;

      if (body) {
        bodySize = body.length;
        if (bodySize > MAX_API_BODY_BYTES) {
          bodyTruncated = true;
        } else {
          const text = body.toString("utf-8");
          try {
            parsedBody = JSON.parse(text);
          } catch {
            rawBody = text;
          }
        }
      }

      const classification = ApiIntelligence.classify(url, headers, parsedBody, method, bodySize);

      // GraphQL handling
      let graphql: ApiCapture["graphql"] | undefined;
      if (isGraphqlUrl(url)) {
        const gqlInfo = parseGraphqlRequest(requestBody);
        if (gqlInfo) {
          graphql = gqlInfo;
        }
      }

      // Data shape inference for data category
      let dataShape: Record<string, string> | undefined;
      if (classification.category === "data" && parsedBody) {
        dataShape = inferDataShape(parsedBody);
      }

      const entry: ApiCapture = {
        index: globalIndex++,
        url,
        method,
        status,
        bodySize,
        ...(parsedBody !== undefined ? { parsedBody } : {}),
        ...(rawBody !== undefined ? { rawBody } : {}),
        ...(bodyTruncated ? { bodyTruncated } : {}),
        category: classification.category,
        confidence: classification.confidence,
        classifiedBy: classification.classifiedBy as ApiCapture["classifiedBy"],
        headers: { ...headers },
        timestamp: Date.now(),
        duration,
        ...(dataShape ? { dataShape } : {}),
        ...(graphql ? { graphql } : {}),
        contentType: contentType.split(";")[0].trim(),
      };

      // Also merge request headers for auth detection in export
      if (requestHeaders) {
        entry.headers = { ...entry.headers, _requestHeaders: JSON.stringify(requestHeaders) };
      }

      pushToRingBuffer(captures, entry);

      logger.debug("api-intelligence:capture", {
        url,
        category: classification.category,
        confidence: classification.confidence,
        classifiedBy: classification.classifiedBy,
        bodySize,
      });
    } catch {
      // Capture must never crash the server
    }
  }

  /**
   * Get captured API calls for a session, optionally filtered.
   */
  static discover(
    sessionId: string,
    options?: { category?: ApiCategory; minConfidence?: number },
  ): ApiDiscoverResult {
    const captures = captureStore.get(sessionId) ?? [];

    let filtered = captures;
    if (options?.category) {
      filtered = filtered.filter((c) => c.category === options.category);
    }
    if (options?.minConfidence !== undefined) {
      filtered = filtered.filter((c) => c.confidence >= options.minConfidence!);
    }

    const summary = { data: 0, tracking: 0, auth: 0, cdn: 0, ads: 0 };
    for (const c of captures) {
      summary[c.category]++;
    }

    return {
      total: captures.length,
      captured: filtered,
      summary,
    };
  }

  /**
   * Generate OpenAPI v3 spec from captured traffic.
   */
  static exportOpenApi(
    sessionId: string,
    options?: { title?: string; includeTracking?: boolean },
  ): OpenApiSpec {
    const captures = captureStore.get(sessionId) ?? [];
    const title = options?.title ?? "Discovered API";
    const includeTracking = options?.includeTracking ?? false;

    // Filter to relevant captures
    const relevant = includeTracking
      ? captures
      : captures.filter((c) => c.category === "data" || c.category === "auth");

    // ── Endpoint clustering ──────────────────────────────────────────
    // Group by templatized path + method
    const endpointMap = new Map<
      string,
      {
        template: string;
        method: string;
        captures: ApiCapture[];
        pathParams: Set<number>; // indices of parameterized segments
        exampleValues: Map<number, string>; // first observed value per param slot
        queryParams: Map<string, string>; // param name -> example value
      }
    >();

    for (const cap of relevant) {
      let parsed: URL;
      try {
        parsed = new URL(cap.url);
      } catch {
        continue;
      }

      const pathSegments = parsed.pathname.split("/");
      const templateSegments = pathSegments.map((seg) =>
        seg && isParameterSegment(seg) ? "{id}" : seg,
      );
      const template = templateSegments.join("/") || "/";
      const key = `${cap.method}::${template}`;

      let group = endpointMap.get(key);
      if (!group) {
        // Record which segments are parameterized and their first real values
        const pathParams = new Set<number>();
        const exampleValues = new Map<number, string>();
        for (let i = 0; i < pathSegments.length; i++) {
          if (pathSegments[i] && isParameterSegment(pathSegments[i])) {
            pathParams.add(i);
            exampleValues.set(i, pathSegments[i]);
          }
        }
        group = {
          template,
          method: cap.method.toLowerCase(),
          captures: [],
          pathParams,
          exampleValues,
          queryParams: new Map(),
        };
        endpointMap.set(key, group);
      }
      group.captures.push(cap);

      // Collect query params from the first observation
      if (group.queryParams.size === 0) {
        for (const [k, v] of parsed.searchParams.entries()) {
          group.queryParams.set(k, v);
        }
      }
    }

    // ── Build paths ──────────────────────────────────────────────────
    const paths: Record<string, Record<string, unknown>> = {};

    for (const [, group] of endpointMap) {
      const pathKey = group.template;
      if (!paths[pathKey]) paths[pathKey] = {};

      const parameters: unknown[] = [];

      // Path parameters
      for (const [idx, example] of group.exampleValues) {
        parameters.push({
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string" },
          example,
        });
        // Only push one param named "id" even if multiple segments
        break;
      }

      // Query parameters
      for (const [name, example] of group.queryParams) {
        parameters.push({
          name,
          in: "query",
          schema: { type: "string" },
          example,
        });
      }

      // Response schema from first capture with a parsed body
      const sampleCapture = group.captures.find((c) => c.parsedBody !== undefined);
      const responseSchema = sampleCapture?.parsedBody
        ? inferJsonSchema(sampleCapture.parsedBody)
        : { type: "object" };

      const responses: Record<string, unknown> = {};
      // Use the most common status code
      const statusCounts = new Map<number, number>();
      for (const c of group.captures) {
        statusCounts.set(c.status, (statusCounts.get(c.status) ?? 0) + 1);
      }
      const primaryStatus = [...statusCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 200;
      responses[String(primaryStatus)] = {
        description: "Observed response",
        content: {
          "application/json": {
            schema: responseSchema,
          },
        },
      };

      const operation: Record<string, unknown> = {
        responses,
        ...(parameters.length > 0 ? { parameters } : {}),
      };

      // GraphQL annotation
      const gqlCapture = group.captures.find((c) => c.graphql);
      if (gqlCapture?.graphql) {
        operation["x-graphql"] = gqlCapture.graphql;
      }

      paths[pathKey][group.method] = operation;
    }

    // ── Auth detection → security schemes ────────────────────────────
    const securitySchemes: Record<string, unknown> = {};
    for (const cap of relevant) {
      const reqHeaders = extractRequestHeaders(cap);
      if (!reqHeaders) continue;

      const authHeader = reqHeaders["authorization"] ?? reqHeaders["Authorization"];
      if (authHeader) {
        if (authHeader.startsWith("Bearer ")) {
          securitySchemes["bearerAuth"] = {
            type: "http",
            scheme: "bearer",
          };
        } else if (authHeader.startsWith("Basic ")) {
          securitySchemes["basicAuth"] = {
            type: "http",
            scheme: "basic",
          };
        }
      }

      // API key patterns
      for (const header of Object.keys(reqHeaders)) {
        const lower = header.toLowerCase();
        if (lower === "x-api-key" || lower === "api-key") {
          securitySchemes["apiKeyHeader"] = {
            type: "apiKey",
            in: "header",
            name: header,
          };
        }
        if (lower === "x-csrf-token" || lower === "csrf-token") {
          securitySchemes["csrfToken"] = {
            type: "apiKey",
            in: "header",
            name: header,
          };
        }
      }
    }

    const spec: OpenApiSpec = {
      openapi: "3.0.3",
      info: { title, version: "1.0.0" },
      paths,
    };

    if (Object.keys(securitySchemes).length > 0) {
      spec.components = { securitySchemes };
    }

    return spec;
  }

  /**
   * Clear captures for a session.
   */
  static clearSession(sessionId: string): void {
    captureStore.delete(sessionId);
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

function extractRequestHeaders(cap: ApiCapture): Record<string, string> | null {
  const raw = cap.headers["_requestHeaders"];
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Infer a minimal JSON Schema object from a runtime value.
 * Used to generate OpenAPI response schemas from observed traffic.
 */
function inferJsonSchema(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 3) return { type: "object" }; // prevent deep recursion

  if (value === null) return { type: "string", nullable: true };
  if (Array.isArray(value)) {
    const items = value.length > 0 ? inferJsonSchema(value[0], depth + 1) : { type: "object" };
    return { type: "array", items };
  }
  if (typeof value === "object") {
    const properties: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      properties[k] = inferJsonSchema(v, depth + 1);
    }
    return { type: "object", properties };
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
  }
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export default ApiIntelligence;
