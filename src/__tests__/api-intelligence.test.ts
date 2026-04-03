import { describe, it, expect, beforeEach } from "vitest";
import { ApiIntelligence } from "../api-intelligence.js";
import type { ApiCategory, ApiCapture } from "../api-intelligence.js";
import type { Session } from "../types.js";
import type { BrowserContext, Page } from "playwright-core";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSession(id = "test-session"): Session {
  return {
    id,
    context: {} as BrowserContext,
    page: {} as Page,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    refCounter: 0,
    refMap: new Map(),
  };
}

function captureJson(
  session: Session,
  url: string,
  body: unknown,
  overrides: {
    method?: string;
    status?: number;
    headers?: Record<string, string>;
    duration?: number;
    resourceType?: string;
    requestHeaders?: Record<string, string>;
    requestBody?: string;
  } = {},
): void {
  const json = JSON.stringify(body);
  const buf = Buffer.from(json, "utf-8");
  const headers = {
    "content-type": "application/json",
    ...(overrides.headers ?? {}),
  };
  ApiIntelligence.capture(
    session,
    url,
    overrides.method ?? "GET",
    overrides.status ?? 200,
    headers,
    buf,
    overrides.duration ?? 50,
    overrides.resourceType ?? "xhr",
    overrides.requestHeaders,
    overrides.requestBody,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApiIntelligence", () => {
  let session: Session;

  beforeEach(() => {
    session = makeSession();
    ApiIntelligence.clearSession(session.id);
  });

  // ── Classification ─────────────────────────────────────────────

  describe("classify", () => {
    it("1. known tracking domain -> tracking with confidence 1.0", () => {
      const result = ApiIntelligence.classify(
        "https://api.segment.io/v1/track",
        { "content-type": "application/json" },
        { success: true },
        "POST",
        20,
      );
      expect(result.category).toBe("tracking");
      expect(result.confidence).toBe(1.0);
      expect(result.classifiedBy).toBe("domain");
    });

    it("2. known ad domain -> ads with confidence 1.0", () => {
      const result = ApiIntelligence.classify(
        "https://securepubads.g.doubleclick.net/gampad/ads",
        { "content-type": "application/json" },
        {},
        "GET",
        500,
      );
      expect(result.category).toBe("ads");
      expect(result.confidence).toBe(1.0);
      expect(result.classifiedBy).toBe("domain");
    });

    it("3. auth URL pattern -> auth with confidence 0.9", () => {
      const result = ApiIntelligence.classify(
        "https://example.com/api/oauth/token",
        { "content-type": "application/json" },
        { token: "abc" },
        "POST",
        200,
      );
      expect(result.category).toBe("auth");
      expect(result.confidence).toBe(0.9);
      expect(result.classifiedBy).toBe("url-pattern");
    });

    it("4. response with access_token -> auth via response-shape", () => {
      // URL deliberately avoids auth URL patterns so shape analysis fires
      const result = ApiIntelligence.classify(
        "https://example.com/api/v2/identity",
        { "content-type": "application/json" },
        { access_token: "eyJhbGciOi...", expires_in: 3600 },
        "POST",
        250,
      );
      expect(result.category).toBe("auth");
      expect(result.confidence).toBe(0.8);
      expect(result.classifiedBy).toBe("response-shape");
    });

    it("5. small POST response -> tracking heuristic", () => {
      const result = ApiIntelligence.classify(
        "https://example.com/api/event",
        { "content-type": "application/json" },
        null, // body not parsed (or tiny)
        "POST",
        50,
      );
      expect(result.category).toBe("tracking");
      expect(result.confidence).toBe(0.6);
      expect(result.classifiedBy).toBe("heuristic");
    });

    it("6. normal JSON GET -> data default", () => {
      // No domain match, no URL pattern, no shape match, body too small for GET heuristic
      const result = ApiIntelligence.classify(
        "https://example.com/api/items",
        { "content-type": "application/json" },
        { items: [1, 2, 3] },
        "GET",
        200,
      );
      // The GET heuristic does not fire (bodySize 200 < 500), but shape does not match either.
      // Falls to default.
      expect(result.category).toBe("data");
      expect(result.confidence).toBe(0.5);
      expect(result.classifiedBy).toBe("default");
    });

    it("classifies subdomain of ad domain correctly", () => {
      const result = ApiIntelligence.classify(
        "https://bids.criteo.com/api/bid",
        {},
        null,
        "POST",
        0,
      );
      expect(result.category).toBe("ads");
      expect(result.confidence).toBe(1.0);
    });

    it("classifies /login path as auth", () => {
      const result = ApiIntelligence.classify(
        "https://myapp.com/api/login",
        {},
        null,
        "POST",
        400,
      );
      expect(result.category).toBe("auth");
    });

    it("classifies _next/data as data (framework fetch)", () => {
      const result = ApiIntelligence.classify(
        "https://myapp.com/_next/data/build123/product.json",
        {},
        { product: { id: 1 } },
        "GET",
        1200,
      );
      expect(result.category).toBe("data");
      expect(result.classifiedBy).toBe("url-pattern");
    });

    it("classifies response with {success: true} only as tracking via shape", () => {
      const result = ApiIntelligence.classify(
        "https://example.com/api/something",
        {},
        { success: true },
        "POST",
        25,
      );
      // Shape analysis fires first (layer 3) for {success: true} tiny object
      expect(result.category).toBe("tracking");
      expect(result.classifiedBy).toBe("response-shape");
    });
  });

  // ── GraphQL ────────────────────────────────────────────────────

  describe("GraphQL detection", () => {
    it("7. detects GraphQL operation name and type", () => {
      captureJson(
        session,
        "https://example.com/graphql",
        { data: { users: [{ id: 1, name: "Alice" }] } },
        {
          method: "POST",
          requestBody: JSON.stringify({
            operationName: "GetUsers",
            query: "query GetUsers { users { id name } }",
          }),
        },
      );

      const result = ApiIntelligence.discover(session.id);
      expect(result.total).toBe(1);
      const cap = result.captured[0];
      expect(cap.graphql).toBeDefined();
      expect(cap.graphql!.operationName).toBe("GetUsers");
      expect(cap.graphql!.operationType).toBe("query");
    });

    it("detects GraphQL mutation", () => {
      captureJson(
        session,
        "https://example.com/graphql",
        { data: { createUser: { id: 99 } } },
        {
          method: "POST",
          requestBody: JSON.stringify({
            operationName: "CreateUser",
            query: "mutation CreateUser($input: UserInput!) { createUser(input: $input) { id } }",
          }),
        },
      );

      const cap = ApiIntelligence.discover(session.id).captured[0];
      expect(cap.graphql!.operationType).toBe("mutation");
    });

    it("handles missing operationName gracefully", () => {
      captureJson(
        session,
        "https://example.com/graphql",
        { data: {} },
        {
          method: "POST",
          requestBody: JSON.stringify({ query: "{ viewer { name } }" }),
        },
      );

      const cap = ApiIntelligence.discover(session.id).captured[0];
      expect(cap.graphql!.operationName).toBeNull();
      expect(cap.graphql!.operationType).toBe("query");
    });
  });

  // ── Data shape inference ───────────────────────────────────────

  describe("data shape inference", () => {
    it("8. infers array, object, and primitive types", () => {
      captureJson(session, "https://example.com/api/products", {
        products: [{ id: 1 }, { id: 2 }],
        total: 42,
        page: 1,
        hasMore: true,
        meta: { cursor: "abc" },
        tags: null,
      });

      const cap = ApiIntelligence.discover(session.id).captured[0];
      expect(cap.dataShape).toEqual({
        products: "array(2)",
        total: "number",
        page: "number",
        hasMore: "boolean",
        meta: "object",
        tags: "null",
      });
    });

    it("does not produce dataShape for non-data categories", () => {
      captureJson(
        session,
        "https://api.segment.io/v1/track",
        { success: true },
        { method: "POST" },
      );

      const cap = ApiIntelligence.discover(session.id).captured[0];
      expect(cap.category).toBe("tracking");
      expect(cap.dataShape).toBeUndefined();
    });
  });

  // ── Ring buffer ────────────────────────────────────────────────

  describe("ring buffer", () => {
    it("9. evicts oldest at 50 entries", () => {
      for (let i = 0; i < 55; i++) {
        captureJson(session, `https://example.com/api/item/${i}`, { id: i });
      }

      const result = ApiIntelligence.discover(session.id);
      expect(result.total).toBe(50);
      // First 5 should have been evicted; remaining should be items 5-54
      const urls = result.captured.map((c) => c.url);
      expect(urls[0]).toContain("/item/5");
      expect(urls[urls.length - 1]).toContain("/item/54");
    });
  });

  // ── Discover filters ──────────────────────────────────────────

  describe("discover", () => {
    beforeEach(() => {
      // Add a mix of captures
      captureJson(session, "https://example.com/api/products", { products: [] });
      captureJson(session, "https://api.segment.io/v1/t", { ok: true }, { method: "POST" });
      captureJson(session, "https://example.com/api/users/me", { id: 1, name: "Alice" });
      captureJson(
        session,
        "https://example.com/api/auth/session",
        { access_token: "abc", expires_in: 3600 },
        { method: "POST" },
      );
    });

    it("10. filters by category", () => {
      const dataResult = ApiIntelligence.discover(session.id, { category: "data" });
      expect(dataResult.captured.every((c) => c.category === "data")).toBe(true);
      expect(dataResult.captured.length).toBeGreaterThanOrEqual(2);

      const trackingResult = ApiIntelligence.discover(session.id, { category: "tracking" });
      expect(trackingResult.captured.every((c) => c.category === "tracking")).toBe(true);
      expect(trackingResult.captured.length).toBeGreaterThanOrEqual(1);
    });

    it("11. filters by confidence", () => {
      const highConf = ApiIntelligence.discover(session.id, { minConfidence: 0.9 });
      expect(highConf.captured.every((c) => c.confidence >= 0.9)).toBe(true);
      // The segment.io capture has confidence 1.0
      expect(highConf.captured.length).toBeGreaterThanOrEqual(1);

      const lowConf = ApiIntelligence.discover(session.id, { minConfidence: 0.5 });
      expect(lowConf.captured.length).toBe(4); // all captured entries
    });

    it("summary counts all categories regardless of filter", () => {
      const result = ApiIntelligence.discover(session.id, { category: "data" });
      // Summary should reflect ALL captures, not just filtered
      expect(result.summary.tracking).toBeGreaterThanOrEqual(1);
      expect(result.total).toBe(4);
    });
  });

  // ── Endpoint clustering ────────────────────────────────────────

  describe("endpoint clustering (OpenAPI export)", () => {
    it("12. clusters numeric IDs into {id}", () => {
      captureJson(session, "https://example.com/api/products/123", { name: "Widget" });
      captureJson(session, "https://example.com/api/products/456", { name: "Gadget" });
      captureJson(session, "https://example.com/api/products/789", { name: "Doohickey" });

      const spec = ApiIntelligence.exportOpenApi(session.id);
      const paths = Object.keys(spec.paths);
      expect(paths).toContain("/api/products/{id}");
      expect(paths).not.toContain("/api/products/123");
      expect(paths).not.toContain("/api/products/456");
    });

    it("13. clusters UUID IDs into {id}", () => {
      captureJson(
        session,
        "https://example.com/api/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        { name: "Alice" },
      );
      captureJson(
        session,
        "https://example.com/api/users/f9e8d7c6-b5a4-3210-fedc-ba9876543210",
        { name: "Bob" },
      );

      const spec = ApiIntelligence.exportOpenApi(session.id);
      expect(Object.keys(spec.paths)).toContain("/api/users/{id}");
    });

    it("preserves static path segments correctly", () => {
      captureJson(session, "https://example.com/v2/items/42/reviews", {
        reviews: [],
      });
      captureJson(session, "https://example.com/v2/items/99/reviews", {
        reviews: [],
      });

      const spec = ApiIntelligence.exportOpenApi(session.id);
      expect(Object.keys(spec.paths)).toContain("/v2/items/{id}/reviews");
    });
  });

  // ── OpenAPI export ─────────────────────────────────────────────

  describe("exportOpenApi", () => {
    it("14. generates valid OpenAPI 3.0.3 structure", () => {
      captureJson(session, "https://example.com/api/products", {
        products: [{ id: 1, name: "Widget", price: 9.99 }],
        total: 1,
      });
      captureJson(session, "https://example.com/api/products/1", {
        id: 1,
        name: "Widget",
        price: 9.99,
      });

      const spec = ApiIntelligence.exportOpenApi(session.id, { title: "Test API" });

      expect(spec.openapi).toBe("3.0.3");
      expect(spec.info.title).toBe("Test API");
      expect(spec.info.version).toBe("1.0.0");
      expect(typeof spec.paths).toBe("object");

      // Should have path entries
      const pathKeys = Object.keys(spec.paths);
      expect(pathKeys.length).toBeGreaterThanOrEqual(1);

      // Each path should have at least one method with responses
      for (const pathKey of pathKeys) {
        const methods = spec.paths[pathKey] as Record<string, Record<string, unknown>>;
        for (const method of Object.values(methods)) {
          expect(method.responses).toBeDefined();
        }
      }
    });

    it("15. includes detected auth patterns (Bearer token)", () => {
      captureJson(session, "https://example.com/api/me", { id: 1 }, {
        requestHeaders: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.test" },
      });

      const spec = ApiIntelligence.exportOpenApi(session.id);
      expect(spec.components).toBeDefined();
      expect(spec.components!.securitySchemes).toBeDefined();
      expect(spec.components!.securitySchemes!["bearerAuth"]).toEqual({
        type: "http",
        scheme: "bearer",
      });
    });

    it("detects API key header", () => {
      captureJson(session, "https://example.com/api/data", { ok: true }, {
        requestHeaders: { "X-Api-Key": "sk-1234567890" },
      });

      // Even though {ok:true} might classify as tracking shape,
      // exportOpenApi with includeTracking should still pick it up
      const spec = ApiIntelligence.exportOpenApi(session.id, { includeTracking: true });
      expect(spec.components?.securitySchemes?.["apiKeyHeader"]).toBeDefined();
    });

    it("detects CSRF token header", () => {
      captureJson(session, "https://example.com/api/items", { items: [] }, {
        requestHeaders: { "X-CSRF-Token": "abc123" },
      });

      const spec = ApiIntelligence.exportOpenApi(session.id);
      expect(spec.components?.securitySchemes?.["csrfToken"]).toBeDefined();
    });

    it("includes query parameters as spec parameters", () => {
      captureJson(
        session,
        "https://example.com/api/search?q=widget&page=1&limit=20",
        { results: [] },
      );

      const spec = ApiIntelligence.exportOpenApi(session.id);
      const searchPath = spec.paths["/api/search"] as Record<string, Record<string, unknown>>;
      expect(searchPath).toBeDefined();
      const getOp = searchPath["get"] as Record<string, unknown>;
      expect(getOp.parameters).toBeDefined();
      const params = getOp.parameters as Array<{ name: string; in: string }>;
      const queryParams = params.filter((p) => p.in === "query");
      expect(queryParams.map((p) => p.name)).toContain("q");
      expect(queryParams.map((p) => p.name)).toContain("page");
    });

    it("excludes tracking by default", () => {
      captureJson(session, "https://example.com/api/products", { products: [] });
      captureJson(
        session,
        "https://api.segment.io/v1/track",
        { ok: true },
        { method: "POST" },
      );

      const spec = ApiIntelligence.exportOpenApi(session.id);
      const pathKeys = Object.keys(spec.paths);
      // Should not have segment.io path
      expect(pathKeys.some((p) => p.includes("segment"))).toBe(false);
    });

    it("generates response schema from observed body", () => {
      captureJson(session, "https://example.com/api/products", {
        products: [{ id: 1, name: "Widget" }],
        total: 42,
        hasMore: true,
      });

      const spec = ApiIntelligence.exportOpenApi(session.id);
      const productsPath = spec.paths["/api/products"] as Record<string, Record<string, unknown>>;
      const getOp = productsPath["get"] as Record<string, unknown>;
      const responses = getOp.responses as Record<string, Record<string, unknown>>;
      const resp200 = responses["200"] as Record<string, unknown>;
      const content = resp200.content as Record<string, Record<string, unknown>>;
      const schema = content["application/json"].schema as Record<string, unknown>;

      expect(schema.type).toBe("object");
      expect(schema.properties).toBeDefined();
      const props = schema.properties as Record<string, Record<string, unknown>>;
      expect(props.products.type).toBe("array");
      expect(props.total.type).toBe("integer");
      expect(props.hasMore.type).toBe("boolean");
    });
  });

  // ── clearSession ───────────────────────────────────────────────

  describe("clearSession", () => {
    it("16. removes all captures for a session", () => {
      captureJson(session, "https://example.com/api/a", { a: 1 });
      captureJson(session, "https://example.com/api/b", { b: 2 });
      expect(ApiIntelligence.discover(session.id).total).toBe(2);

      ApiIntelligence.clearSession(session.id);
      expect(ApiIntelligence.discover(session.id).total).toBe(0);
    });
  });

  // ── Capture edge cases ─────────────────────────────────────────

  describe("capture edge cases", () => {
    it("skips non-XHR/fetch resource types", () => {
      captureJson(session, "https://example.com/api/data", { x: 1 }, {
        resourceType: "document",
      });
      expect(ApiIntelligence.discover(session.id).total).toBe(0);
    });

    it("skips OPTIONS requests", () => {
      captureJson(session, "https://example.com/api/data", {}, { method: "OPTIONS" });
      expect(ApiIntelligence.discover(session.id).total).toBe(0);
    });

    it("skips non-2xx/3xx status codes", () => {
      captureJson(session, "https://example.com/api/data", {}, { status: 500 });
      expect(ApiIntelligence.discover(session.id).total).toBe(0);
    });

    it("skips non-JSON content types", () => {
      const buf = Buffer.from("<html></html>", "utf-8");
      ApiIntelligence.capture(
        session,
        "https://example.com/page",
        "GET",
        200,
        { "content-type": "text/html" },
        buf,
        50,
        "xhr",
      );
      expect(ApiIntelligence.discover(session.id).total).toBe(0);
    });

    it("handles null body gracefully", () => {
      ApiIntelligence.capture(
        session,
        "https://example.com/api/empty",
        "GET",
        204,
        { "content-type": "application/json" },
        null,
        10,
        "fetch",
      );
      const result = ApiIntelligence.discover(session.id);
      expect(result.total).toBe(1);
      expect(result.captured[0].bodySize).toBe(0);
    });

    it("handles invalid JSON body as rawBody", () => {
      const buf = Buffer.from("not valid json {{{", "utf-8");
      ApiIntelligence.capture(
        session,
        "https://example.com/api/broken",
        "GET",
        200,
        { "content-type": "application/json" },
        buf,
        50,
        "xhr",
      );
      const result = ApiIntelligence.discover(session.id);
      expect(result.total).toBe(1);
      expect(result.captured[0].rawBody).toBe("not valid json {{{");
      expect(result.captured[0].parsedBody).toBeUndefined();
    });

    it("marks oversized bodies as truncated", () => {
      // Create a buffer larger than 256KB
      const bigBuf = Buffer.alloc(MAX_API_BODY_BYTES_TEST + 1, 0x20);
      ApiIntelligence.capture(
        session,
        "https://example.com/api/huge",
        "GET",
        200,
        { "content-type": "application/json" },
        bigBuf,
        100,
        "xhr",
      );
      const result = ApiIntelligence.discover(session.id);
      expect(result.total).toBe(1);
      expect(result.captured[0].bodyTruncated).toBe(true);
      expect(result.captured[0].parsedBody).toBeUndefined();
    });

    it("captures fetch resource type", () => {
      captureJson(session, "https://example.com/api/data", { x: 1 }, {
        resourceType: "fetch",
      });
      expect(ApiIntelligence.discover(session.id).total).toBe(1);
    });
  });
});

// ─── Constants for test assertions ───────────────────────────────────────────
const MAX_API_BODY_BYTES_TEST = 256 * 1024;
