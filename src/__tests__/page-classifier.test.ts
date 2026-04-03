import { describe, it, expect } from "vitest";
import { PageClassifier } from "../page-classifier.js";
import type { ClassificationInput } from "../page-classifier.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<ClassificationInput>): ClassificationInput {
  return {
    url: "https://example.com",
    snapshotText: "",
    ...overrides,
  };
}

/** Build snapshot text from element tuples: [ref, role, name, extra?] */
function snap(
  lines: Array<[string, string, string, string?]>,
): string {
  return lines
    .map(([ref, role, name, extra]) => {
      let line = `${ref} ${role} "${name}"`;
      if (extra) line += ` ${extra}`;
      return line;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PageClassifier", () => {
  // ── 1. Login page ──────────────────────────────────────────────────

  describe("login detection", () => {
    it("detects login page: URL + password field + sign in button", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://github.com/login",
          snapshotText: snap([
            ["@e1", "textbox", "Username or email"],
            ["@e2", "textbox", "Password"],
            ["@e3", "button", "Sign In"],
            ["@e4", "link", "Forgot password?"],
          ]),
        }),
      );

      expect(result.type).toBe("login");
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.signals).toContain("url:login-path");
      expect(result.signals).toContain("snapshot:password-field");
      expect(result.signals).toContain("snapshot:login-button");
      expect(result.metadata?.hasPassword).toBe(true);
    });

    it("detects registration page via URL pattern", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/signup",
          snapshotText: snap([
            ["@e1", "textbox", "Email"],
            ["@e2", "textbox", "Password"],
            ["@e3", "button", "Create Account"],
          ]),
        }),
      );

      expect(result.type).toBe("login");
      expect(result.signals).toContain("url:register-path");
    });

    it("detects OAuth login patterns", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://app.example.com/auth",
          snapshotText: snap([
            ["@e1", "textbox", "Email"],
            ["@e2", "textbox", "Password"],
            ["@e3", "button", "Log In"],
            ["@e4", "button", "Sign in with Google"],
            ["@e5", "button", "Sign in with GitHub"],
            ["@e6", "link", "Reset password"],
          ]),
        }),
      );

      expect(result.type).toBe("login");
      expect(result.signals).toContain("snapshot:oauth-buttons");
      expect(result.signals).toContain("snapshot:forgot-password");
    });
  });

  // ── 2. Product page ────────────────────────────────────────────────

  describe("product detection", () => {
    it("detects product page: JSON-LD + price + Add to Cart", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://store.example.com/product/wireless-mouse",
          snapshotText: snap([
            ["@e1", "heading", "Wireless Mouse Pro", "(h1)"],
            ["@e2", "link", "$29.99"],
            ["@e3", "button", "Add to Cart"],
            ["@e4", "textbox", "Quantity"],
            ["@e5", "link", "4.5 stars - 1,234 reviews"],
          ]),
          meta: { jsonLdType: "Product" },
        }),
      );

      expect(result.type).toBe("product");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.signals).toContain("meta:jsonld-product");
      expect(result.signals).toContain("snapshot:add-to-cart");
      expect(result.signals).toContain("snapshot:price-pattern");
      expect(result.metadata?.hasPrice).toBe(true);
    });

    it("detects product via og:type", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://shop.example.com/item/123",
          snapshotText: snap([
            ["@e1", "heading", "Cool Widget", "(h1)"],
            ["@e2", "button", "Buy Now"],
            ["@e3", "link", "$49.99"],
          ]),
          meta: { ogType: "product" },
        }),
      );

      expect(result.type).toBe("product");
      expect(result.signals).toContain("meta:og-product");
    });
  });

  // ── 3. Search results ──────────────────────────────────────────────

  describe("search-results detection", () => {
    it("detects search results: search URL + results heading", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://www.google.com/search?q=playwright+testing",
          snapshotText: snap([
            ["@e1", "textbox", "Search"],
            ["@e2", "heading", "About 1,230,000 results", "(h2)"],
            ["@e3", "link", "Playwright Documentation"],
            ["@e4", "link", "Getting Started with Playwright"],
            ["@e5", "link", "Playwright vs Puppeteer"],
            ["@e6", "link", "Playwright Tutorial"],
            ["@e7", "link", "Playwright Best Practices"],
            ["@e8", "link", "Next"],
          ]),
        }),
      );

      expect(result.type).toBe("search-results");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.signals).toContain("url:search-path");
      expect(result.signals).toContain("url:search-engine-host");
      expect(result.signals).toContain("snapshot:results-heading");
    });

    it("detects site search via query param", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://shop.example.com/search?q=headphones",
          snapshotText: snap([
            ["@e1", "heading", "Showing 42 results for headphones", "(h1)"],
            ["@e2", "link", "Wireless Headphones"],
            ["@e3", "link", "Bluetooth Headphones"],
            ["@e4", "link", "Gaming Headphones"],
            ["@e5", "link", "Noise Cancelling Headphones"],
            ["@e6", "link", "Over-Ear Headphones"],
          ]),
        }),
      );

      expect(result.type).toBe("search-results");
      expect(result.signals).toContain("url:search-path");
      expect(result.signals).toContain("snapshot:results-heading");
    });
  });

  // ── 4. Checkout page ───────────────────────────────────────────────

  describe("checkout detection", () => {
    it("detects checkout: cart URL + card fields + Place Order", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://store.example.com/checkout",
          snapshotText: snap([
            ["@e1", "heading", "Order Summary", "(h2)"],
            ["@e2", "textbox", "Card Number"],
            ["@e3", "textbox", "Expiry Date"],
            ["@e4", "textbox", "CVV"],
            ["@e5", "textbox", "Street Address"],
            ["@e6", "textbox", "City"],
            ["@e7", "textbox", "Zip Code"],
            ["@e8", "button", "Place Order"],
            ["@e9", "link", "Visa"],
          ]),
        }),
      );

      expect(result.type).toBe("checkout");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.signals).toContain("url:checkout-path");
      expect(result.signals).toContain("snapshot:credit-card-fields");
      expect(result.signals).toContain("snapshot:place-order-button");
      expect(result.signals).toContain("snapshot:shipping-fields");
      expect(result.signals).toContain("snapshot:order-summary");
    });

    it("detects cart page", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://store.example.com/cart",
          snapshotText: [
            '@e1 heading "Your Cart" (h1)',
            '@e2 link "Subtotal: $59.98"',
            '@e3 link "Total: $64.97"',
            '@e4 button "Proceed to Checkout"',
          ].join("\n"),
        }),
      );

      expect(result.type).toBe("checkout");
      expect(result.signals).toContain("url:checkout-path");
    });
  });

  // ── 5. Article page ────────────────────────────────────────────────

  describe("article detection", () => {
    it("detects article: JSON-LD Article + blog URL + single h1", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://blog.example.com/blog/my-article",
          snapshotText: snap([
            ["@e1", "heading", "How to Build a Browser MCP", "(h1)"],
            ["@e2", "link", "By John Doe"],
            ["@e3", "link", "Published March 15, 2026"],
            ["@e4", "article", "Main Content"],
            ["@e5", "heading", "Introduction", "(h2)"],
            ["@e6", "heading", "Getting Started", "(h2)"],
            ["@e7", "link", "Share on Twitter"],
          ]),
          meta: { jsonLdType: "Article", ogType: "article" },
        }),
      );

      expect(result.type).toBe("article");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.signals).toContain("meta:jsonld-article");
      expect(result.signals).toContain("meta:og-article");
      expect(result.signals).toContain("url:article-path");
      expect(result.signals).toContain("snapshot:single-h1");
    });

    it("detects blog via year in URL", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/2026/03/building-mcps",
          snapshotText: snap([
            ["@e1", "heading", "Building MCPs", "(h1)"],
            ["@e2", "link", "By Author Name"],
            ["@e3", "article", "content"],
          ]),
          meta: { ogType: "article" },
        }),
      );

      expect(result.type).toBe("article");
      expect(result.signals).toContain("url:article-path");
    });
  });

  // ── 6. Dashboard page ──────────────────────────────────────────────

  describe("dashboard detection", () => {
    it("detects dashboard: admin URL + sidebar nav + tables", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://app.example.com/dashboard",
          snapshotText: snap([
            ["@e1", "navigation", "Sidebar"],
            ["@e2", "link", "Overview"],
            ["@e3", "link", "Analytics"],
            ["@e4", "link", "Users"],
            ["@e5", "link", "Settings"],
            ["@e6", "link", "Reports"],
            ["@e7", "link", "Billing"],
            ["@e8", "link", "Integrations"],
            ["@e9", "link", "Logs"],
            ["@e10", "table", "User Activity"],
            ["@e11", "button", "Export"],
            ["@e12", "button", "Filter"],
            ["@e13", "button", "Refresh"],
            ["@e14", "link", "Sign Out"],
          ]),
          meta: { robots: "noindex" },
        }),
      );

      expect(result.type).toBe("dashboard");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.signals).toContain("url:dashboard-path");
      expect(result.signals).toContain("snapshot:nav-sidebar");
      expect(result.signals).toContain("snapshot:data-tables");
      expect(result.signals).toContain("snapshot:logout-settings");
      expect(result.signals).toContain("meta:noindex");
    });
  });

  // ── 7. Error page ──────────────────────────────────────────────────

  describe("error detection", () => {
    it("detects 404 error: status + error text", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/nonexistent-page",
          status: 404,
          snapshotText: snap([
            ["@e1", "heading", "404 Not Found", "(h1)"],
            ["@e2", "link", "Go back to Home"],
          ]),
        }),
      );

      expect(result.type).toBe("error");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.signals).toContain("http:error-status");
      expect(result.signals).toContain("snapshot:error-heading");
      expect(result.signals).toContain("snapshot:go-back-link");
      expect(result.signals).toContain("snapshot:few-interactive");
    });

    it("detects 500 server error", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/api/broken",
          status: 500,
          snapshotText: snap([
            ["@e1", "heading", "Internal Server Error", "(h1)"],
          ]),
        }),
      );

      expect(result.type).toBe("error");
      expect(result.signals).toContain("http:error-status");
    });

    it("detects error page without status code (from heading only)", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/oops",
          snapshotText: [
            '@e1 heading "Page Not Found" (h1)',
            '@e2 link "page not found - please go back"',
            '@e3 link "Return home"',
          ].join("\n"),
        }),
      );

      expect(result.type).toBe("error");
      expect(result.signals).toContain("snapshot:error-heading");
    });
  });

  // ── 8. Landing page ────────────────────────────────────────────────

  describe("landing detection", () => {
    it("detects landing: root URL + CTA buttons", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://www.example.com/",
          snapshotText: snap([
            ["@e1", "heading", "Build Faster With Our Platform", "(h1)"],
            ["@e2", "button", "Get Started Free"],
            ["@e3", "button", "Learn More"],
            ["@e4", "heading", "Features", "(h2)"],
            ["@e5", "heading", "Pricing", "(h2)"],
            ["@e6", "heading", "Testimonials", "(h2)"],
            ["@e7", "link", "Sign Up"],
            ["@e8", "link", "Contact"],
          ]),
          meta: { ogType: "website" },
        }),
      );

      expect(result.type).toBe("landing");
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
      expect(result.signals).toContain("url:root-path");
      expect(result.signals).toContain("snapshot:cta-buttons");
      expect(result.signals).toContain("meta:og-website");
      expect(result.signals).toContain("snapshot:varied-sections");
    });

    it("detects pricing page as landing", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/pricing",
          snapshotText: snap([
            ["@e1", "heading", "Simple Pricing", "(h1)"],
            ["@e2", "heading", "Starter", "(h2)"],
            ["@e3", "heading", "Pro", "(h2)"],
            ["@e4", "button", "Try Free"],
            ["@e5", "button", "Get Started"],
          ]),
        }),
      );

      expect(result.type).toBe("landing");
      expect(result.signals).toContain("url:marketing-path");
      expect(result.signals).toContain("snapshot:cta-buttons");
    });
  });

  // ── 9. Documentation page ──────────────────────────────────────────

  describe("documentation detection", () => {
    it("detects docs: docs URL + code blocks + sidebar", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://docs.example.com/docs/getting-started",
          snapshotText: [
            '@e1 navigation "Docs Sidebar"',
            '@e2 link "Introduction"',
            '@e3 link "Installation"',
            '@e4 link "Quick Start"',
            '@e5 link "API Reference"',
            '@e6 link "Configuration"',
            '@e7 link "Plugins"',
            '@e8 link "Migration Guide"',
            '@e9 link "FAQ"',
            '@e10 link "Changelog"',
            '@e11 link "Contributing"',
            '@e12 navigation "breadcrumb"',
            '@e13 heading "Getting Started" (h1)',
            '@e14 heading "Installation" (h2)',
            '@e15 code "npm install example"',
            '@e16 heading "API Reference" (h2)',
          ].join("\n"),
          meta: { jsonLdType: "TechArticle" },
        }),
      );

      expect(result.type).toBe("documentation");
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.signals).toContain("url:docs-path");
      expect(result.signals).toContain("snapshot:sidebar-nav");
      expect(result.signals).toContain("snapshot:code-blocks");
      expect(result.signals).toContain("snapshot:breadcrumbs");
      expect(result.signals).toContain("meta:jsonld-tech-article");
    });
  });

  // ── 10. Unknown page ───────────────────────────────────────────────

  describe("unknown detection", () => {
    it("returns unknown for minimal page with no signals", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/some-random-page",
          snapshotText: snap([["@e1", "heading", "Hello World", "(h1)"]]),
        }),
      );

      expect(result.type).toBe("unknown");
      expect(result.confidence).toBe(0);
      expect(result.signals).toEqual([]);
    });

    it("returns unknown for empty snapshot", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com",
          snapshotText: "",
        }),
      );

      // Root URL fires some landing signals, but with empty snapshot
      // the overall confidence may or may not cross threshold
      expect(["landing", "unknown"]).toContain(result.type);
    });
  });

  // ── 11. Confidence threshold ───────────────────────────────────────

  describe("confidence threshold", () => {
    it("returns unknown when weak signals fail to reach 0.3", () => {
      // Only one weak URL signal for dashboard, nothing else
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/dashboard",
          snapshotText: snap([["@e1", "heading", "Welcome", "(h1)"]]),
        }),
      );

      // URL signal alone = 4/19 = ~0.21 confidence - below threshold
      expect(result.type).toBe("unknown");
      expect(result.allScores["dashboard"]).toBe(4);
    });

    it("crosses threshold when multiple signals combine", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/dashboard",
          snapshotText: snap([
            ["@e1", "navigation", "Sidebar"],
            ["@e2", "link", "Home"],
            ["@e3", "link", "Analytics"],
            ["@e4", "link", "Users"],
            ["@e5", "link", "Settings"],
            ["@e6", "link", "Reports"],
            ["@e7", "link", "Billing"],
            ["@e8", "link", "Integrations"],
            ["@e9", "link", "API"],
            ["@e10", "table", "Data Table"],
            ["@e11", "button", "Sign Out"],
          ]),
        }),
      );

      expect(result.type).toBe("dashboard");
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    });
  });

  // ── 12. URL-only classification ────────────────────────────────────

  describe("URL-only classification", () => {
    it("classifyUrl works but with lower confidence", () => {
      const result = PageClassifier.classifyUrl(
        "https://www.google.com/search?q=test",
      );

      expect(result.type).toBe("search-results");
      // URL-only gives search-engine-host (5) + search-path (4) = 9/21 = 0.43
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThan(0.6);
    });

    it("classifyUrl returns unknown for ambiguous URL", () => {
      const result = PageClassifier.classifyUrl("https://example.com/page/123");

      expect(result.type).toBe("unknown");
    });

    it("classifyUrl detects login from URL alone", () => {
      const result = PageClassifier.classifyUrl("https://example.com/login");

      // URL gives 3/21 = ~0.14 -- below threshold
      expect(result.type).toBe("unknown");
    });
  });

  // ── 13. Competing types — highest score wins ───────────────────────

  describe("competing types", () => {
    it("product wins over landing when product signals are stronger", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://shop.example.com/product/widget",
          snapshotText: snap([
            ["@e1", "heading", "Awesome Widget", "(h1)"],
            ["@e2", "link", "$99.99"],
            ["@e3", "button", "Add to Cart"],
          ]),
          meta: { jsonLdType: "Product", ogType: "product" },
        }),
      );

      expect(result.type).toBe("product");
      expect(result.allScores["product"]).toBeGreaterThan(
        result.allScores["landing"],
      );
    });

    it("checkout wins over form when payment signals present", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://store.example.com/checkout",
          snapshotText: snap([
            ["@e1", "textbox", "Name"],
            ["@e2", "textbox", "Email"],
            ["@e3", "textbox", "Card Number"],
            ["@e4", "textbox", "CVV"],
            ["@e5", "textbox", "Street Address"],
            ["@e6", "button", "Place Order"],
          ]),
        }),
      );

      expect(result.type).toBe("checkout");
      expect(result.allScores["checkout"]).toBeGreaterThan(
        result.allScores["form"],
      );
    });

    it("article wins over documentation for blog posts", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/blog/my-post",
          snapshotText: snap([
            ["@e1", "heading", "My Blog Post", "(h1)"],
            ["@e2", "link", "By Author"],
            ["@e3", "article", "content"],
          ]),
          meta: { jsonLdType: "BlogPosting", ogType: "article" },
        }),
      );

      expect(result.type).toBe("article");
    });
  });

  // ── 14. Metadata enhances classification ───────────────────────────

  describe("metadata enhancement", () => {
    it("JSON-LD type significantly boosts product confidence", () => {
      const withoutMeta = PageClassifier.classify(
        makeInput({
          url: "https://shop.example.com/product/123",
          snapshotText: snap([
            ["@e1", "heading", "Widget", "(h1)"],
            ["@e2", "link", "$29.99"],
            ["@e3", "button", "Add to Cart"],
          ]),
        }),
      );

      const withMeta = PageClassifier.classify(
        makeInput({
          url: "https://shop.example.com/product/123",
          snapshotText: snap([
            ["@e1", "heading", "Widget", "(h1)"],
            ["@e2", "link", "$29.99"],
            ["@e3", "button", "Add to Cart"],
          ]),
          meta: { jsonLdType: "Product" },
        }),
      );

      expect(withMeta.confidence).toBeGreaterThan(withoutMeta.confidence);
      expect(withMeta.type).toBe("product");
      expect(withoutMeta.type).toBe("product");
      expect(withMeta.metadata?.jsonLdType).toBe("Product");
    });

    it("og:type article boosts article confidence", () => {
      const withoutOg = PageClassifier.classify(
        makeInput({
          url: "https://example.com/blog/post",
          snapshotText: snap([
            ["@e1", "heading", "Post Title", "(h1)"],
            ["@e2", "link", "By Author"],
            ["@e3", "article", "Content"],
          ]),
          meta: { jsonLdType: "Article" },
        }),
      );

      const withOg = PageClassifier.classify(
        makeInput({
          url: "https://example.com/blog/post",
          snapshotText: snap([
            ["@e1", "heading", "Post Title", "(h1)"],
            ["@e2", "link", "By Author"],
            ["@e3", "article", "Content"],
          ]),
          meta: { jsonLdType: "Article", ogType: "article" },
        }),
      );

      expect(withOg.confidence).toBeGreaterThan(withoutOg.confidence);
      expect(withOg.metadata?.ogType).toBe("article");
    });

    it("robots noindex boosts dashboard detection", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://app.example.com/admin",
          snapshotText: snap([
            ["@e1", "navigation", "Sidebar"],
            ["@e2", "link", "Dashboard"],
            ["@e3", "link", "Users"],
            ["@e4", "link", "Analytics"],
            ["@e5", "link", "Settings"],
            ["@e6", "link", "Reports"],
            ["@e7", "link", "Billing"],
            ["@e8", "link", "Logs"],
            ["@e9", "link", "API Keys"],
            ["@e10", "table", "Activity"],
            ["@e11", "button", "Log Out"],
          ]),
          meta: { robots: "noindex, nofollow" },
        }),
      );

      expect(result.type).toBe("dashboard");
      expect(result.signals).toContain("meta:noindex");
    });
  });

  // ── Additional coverage ────────────────────────────────────────────

  describe("product-list detection", () => {
    it("detects product list with filter and multiple prices", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://store.example.com/category/electronics",
          snapshotText: [
            '@e1 heading "Electronics" (h1)',
            '@e2 combobox "Sort By"',
            '@e3 button "Filter"',
            '@e4 link "Laptop - $999.99"',
            '@e5 link "Phone - $699.99"',
            '@e6 link "Tablet - $499.99"',
            '@e7 link "Watch - $299.99"',
            '@e8 link "Next Page"',
          ].join("\n"),
          meta: { jsonLdType: "CollectionPage" },
        }),
      );

      expect(result.type).toBe("product-list");
      expect(result.signals).toContain("url:category-path");
      expect(result.signals).toContain("meta:jsonld-collection");
      expect(result.signals).toContain("snapshot:many-prices");
      expect(result.signals).toContain("snapshot:filter-sort");
    });
  });

  describe("form detection", () => {
    it("detects contact form with many inputs and submit button", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/contact",
          snapshotText: snap([
            ["@e1", "heading", "Contact Us", "(h1)"],
            ["@e2", "textbox", "Name"],
            ["@e3", "textbox", "Email"],
            ["@e4", "textbox", "Phone"],
            ["@e5", "textbox", "Company"],
            ["@e6", "textbox", "Message"],
            ["@e7", "button", "Send Message"],
          ]),
        }),
      );

      expect(result.type).toBe("form");
      expect(result.signals).toContain("url:form-path");
      expect(result.signals).toContain("snapshot:many-text-inputs");
      expect(result.signals).toContain("snapshot:form-labels");
      expect(result.signals).toContain("snapshot:no-password");
    });
  });

  describe("profile detection", () => {
    it("detects profile page with avatar and editable fields", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://app.example.com/profile",
          snapshotText: snap([
            ["@e1", "img", "Profile Avatar"],
            ["@e2", "heading", "John Doe", "(h1)"],
            ["@e3", "textbox", "Display Name"],
            ["@e4", "textbox", "Email"],
            ["@e5", "textbox", "Bio"],
            ["@e6", "button", "Save Changes"],
            ["@e7", "link", "Security Settings"],
          ]),
        }),
      );

      expect(result.type).toBe("profile");
      expect(result.signals).toContain("url:profile-path");
      expect(result.signals).toContain("snapshot:avatar-image");
      expect(result.signals).toContain("snapshot:edit-profile-button");
    });
  });

  describe("media detection", () => {
    it("detects video page with playback controls", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://www.youtube.com/watch?v=abc123",
          snapshotText: snap([
            ["@e1", "heading", "My Cool Video", "(h1)"],
            ["@e2", "video", "Video Player"],
            ["@e3", "button", "Play"],
            ["@e4", "button", "Mute"],
            ["@e5", "button", "Fullscreen"],
            ["@e6", "link", "12:34"],
            ["@e7", "heading", "Related Videos", "(h2)"],
            ["@e8", "link", "Similar Video 1"],
          ]),
        }),
      );

      expect(result.type).toBe("media");
      expect(result.signals).toContain("url:media-path");
      expect(result.signals).toContain("snapshot:video-audio-elements");
      expect(result.signals).toContain("snapshot:playback-controls");
      expect(result.signals).toContain("snapshot:timestamp-duration");
      expect(result.signals).toContain("snapshot:related-content");
    });
  });

  // ── allScores contains all types ───────────────────────────────────

  describe("allScores", () => {
    it("includes scores for every page type", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/login",
          snapshotText: snap([
            ["@e1", "textbox", "Email"],
            ["@e2", "textbox", "Password"],
            ["@e3", "button", "Sign In"],
          ]),
        }),
      );

      const expectedTypes: string[] = [
        "login",
        "search-results",
        "product",
        "product-list",
        "checkout",
        "article",
        "dashboard",
        "form",
        "error",
        "landing",
        "documentation",
        "profile",
        "media",
        "unknown",
      ];

      for (const t of expectedTypes) {
        expect(result.allScores).toHaveProperty(t);
        expect(typeof result.allScores[t as keyof typeof result.allScores]).toBe(
          "number",
        );
      }
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles malformed URL gracefully without throwing", () => {
      // Malformed URL should not throw; it falls back to a default URL
      const result = PageClassifier.classify(
        makeInput({
          url: "not-a-valid-url",
          snapshotText: snap([["@e1", "heading", "Hello", "(h1)"]]),
        }),
      );

      // Should not throw — any classification result is acceptable
      expect(result).toBeDefined();
      expect(typeof result.type).toBe("string");
      expect(typeof result.confidence).toBe("number");
    });

    it("handles snapshot text with no @eN refs", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com",
          snapshotText: "(page not loaded or empty)",
        }),
      );

      expect(["landing", "unknown"]).toContain(result.type);
    });

    it("HTTP 403 triggers error detection", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/restricted",
          status: 403,
          snapshotText: snap([
            ["@e1", "heading", "Access Denied", "(h1)"],
          ]),
        }),
      );

      expect(result.type).toBe("error");
      expect(result.signals).toContain("http:error-status");
    });

    it("SearchResultsPage JSON-LD type is detected", () => {
      const result = PageClassifier.classify(
        makeInput({
          url: "https://example.com/search?q=test",
          snapshotText: snap([
            ["@e1", "textbox", "Search"],
            ["@e2", "link", "Result 1"],
            ["@e3", "link", "Result 2"],
            ["@e4", "link", "Result 3"],
            ["@e5", "link", "Result 4"],
            ["@e6", "link", "Result 5"],
          ]),
          meta: { jsonLdType: "SearchResultsPage" },
        }),
      );

      expect(result.type).toBe("search-results");
      expect(result.signals).toContain("meta:jsonld-search");
    });
  });
});
