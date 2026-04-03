// ─── Page Classifier ──────────────────────────────────────────────────────
//
// LLM-free page classification using weighted signal scoring.
// Operates on URL, HTTP status, snapshot text, and optional meta tags.
// Zero browser access — pure function, no side effects, no async.
//

// ─── Types ────────────────────────────────────────────────────────────────

export type PageType =
  | "login"
  | "search-results"
  | "product"
  | "product-list"
  | "checkout"
  | "article"
  | "dashboard"
  | "form"
  | "error"
  | "challenge"
  | "landing"
  | "documentation"
  | "profile"
  | "media"
  | "feed"       // P0-5: Reddit, HN, social feeds
  | "qa"         // P0-5: StackOverflow, Q&A sites
  | "ecommerce"  // P0-5: Amazon/eBay homepage, marketplace
  | "unknown";

export interface ClassificationResult {
  type: PageType;
  confidence: number;
  signals: string[];
  allScores: Record<PageType, number>;
  metadata?: {
    formFields?: number;
    interactiveElements?: number;
    hasPassword?: boolean;
    hasPrice?: boolean;
    jsonLdType?: string;
    ogType?: string;
  };
}

export interface ClassificationInput {
  url: string;
  status?: number;
  snapshotText: string;
  meta?: {
    ogType?: string;
    jsonLdType?: string;
    robots?: string;
    description?: string;
  };
}

// ─── Internal types ───────────────────────────────────────────────────────

interface ParsedElement {
  ref: string;
  role: string;
  name: string;
  level?: number;
}

interface SnapshotAnalysis {
  elements: ParsedElement[];
  headings: ParsedElement[];
  buttons: ParsedElement[];
  links: ParsedElement[];
  textboxes: ParsedElement[];
  comboboxes: ParsedElement[];
  images: ParsedElement[];
  hasPasswordField: boolean;
  priceCount: number;
  interactiveCount: number;
  totalCount: number;
  rawText: string;
}

interface SignalDef {
  name: string;
  weight: number;
  test: (ctx: ClassifyContext) => boolean;
}

interface TypeProfile {
  type: PageType;
  maxPossible: number;
  signals: SignalDef[];
}

interface ClassifyContext {
  url: URL;
  status?: number;
  snapshot: SnapshotAnalysis;
  meta: {
    ogType?: string;
    jsonLdType?: string;
    robots?: string;
    description?: string;
  };
}

// ─── Snapshot text parser ─────────────────────────────────────────────────

const SNAP_LINE_RE = /^(\s*)(@e\d+)\s+(\w[\w-]*)\s+"([^"]*)"/;
const HEADING_LEVEL_RE = /\(h(\d)\)/;
const PRICE_RE = /(?:\$|£|€|¥|₹)\s?\d[\d,.]+|\d[\d,.]+\s?(?:USD|EUR|GBP|JPY|INR)/gi;

function parseSnapshotText(text: string): SnapshotAnalysis {
  const elements: ParsedElement[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(SNAP_LINE_RE);
    if (!match) continue;

    const el: ParsedElement = {
      ref: match[2],
      role: match[3],
      name: match[4],
    };

    if (el.role === "heading") {
      const lvl = line.match(HEADING_LEVEL_RE);
      if (lvl) el.level = parseInt(lvl[1], 10);
    }

    elements.push(el);
  }

  const headings = elements.filter((e) => e.role === "heading");
  const buttons = elements.filter((e) => e.role === "button");
  const links = elements.filter((e) => e.role === "link");
  const textboxes = elements.filter(
    (e) => e.role === "textbox" || e.role === "searchbox",
  );
  const comboboxes = elements.filter(
    (e) => e.role === "combobox" || e.role === "listbox",
  );
  const images = elements.filter((e) => e.role === "img");

  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "option",
    "menuitem",
    "tab",
    "switch",
    "slider",
    "spinbutton",
    "searchbox",
  ]);

  const interactiveCount = elements.filter((e) =>
    INTERACTIVE_ROLES.has(e.role),
  ).length;

  const hasPasswordField = textboxes.some((t) => /password|passwd/i.test(t.name));

  // Count price patterns in the full snapshot text
  const priceMatches = text.match(PRICE_RE);
  const priceCount = priceMatches ? priceMatches.length : 0;

  return {
    elements,
    headings,
    buttons,
    links,
    textboxes,
    comboboxes,
    images,
    hasPasswordField,
    priceCount,
    interactiveCount,
    totalCount: elements.length,
    rawText: text,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Case-insensitive check: does any element's name match the pattern? */
function anyNameMatches(
  elements: ParsedElement[],
  pattern: RegExp,
): boolean {
  return elements.some((e) => pattern.test(e.name));
}

/** Count elements whose name matches a pattern */
function countNameMatches(
  elements: ParsedElement[],
  pattern: RegExp,
): number {
  return elements.filter((e) => pattern.test(e.name)).length;
}

/** Check if snapshot raw text contains a pattern (case-insensitive) */
function snapshotContains(snapshot: SnapshotAnalysis, pattern: RegExp): boolean {
  return pattern.test(snapshot.rawText);
}

// ─── Search engine hosts ──────────────────────────────────────────────────

const SEARCH_ENGINE_HOSTS = new Set([
  "google.com",
  "www.google.com",
  "bing.com",
  "www.bing.com",
  "duckduckgo.com",
  "www.duckduckgo.com",
  "yahoo.com",
  "search.yahoo.com",
  "baidu.com",
  "www.baidu.com",
]);

// ─── Media hosts ──────────────────────────────────────────────────────────

const MEDIA_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "vimeo.com",
  "www.vimeo.com",
  "twitch.tv",
  "www.twitch.tv",
  "spotify.com",
  "open.spotify.com",
]);

// ─── Signal definitions ───────────────────────────────────────────────────

const LOGIN_SIGNALS: SignalDef[] = [
  {
    name: "url:login-path",
    weight: 3,
    test: (ctx) => /\/(login|signin|sign-in|auth|sso)(\/|$|\?)/i.test(ctx.url.pathname),
  },
  {
    name: "url:register-path",
    weight: 3,
    test: (ctx) => /\/(register|signup|sign-up|join)(\/|$|\?)/i.test(ctx.url.pathname),
  },
  {
    name: "snapshot:password-field",
    weight: 5,
    test: (ctx) => ctx.snapshot.hasPasswordField,
  },
  {
    name: "snapshot:few-text-inputs",
    weight: 3,
    test: (ctx) => {
      const count = ctx.snapshot.textboxes.length;
      return count >= 1 && count <= 3;
    },
  },
  {
    name: "snapshot:login-button",
    weight: 3,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.buttons,
        /\b(log\s*in|sign\s*in|sign\s*up|register|create\s*account)\b/i,
      ),
  },
  {
    name: "snapshot:oauth-buttons",
    weight: 2,
    test: (ctx) => {
      const all = [...ctx.snapshot.buttons, ...ctx.snapshot.links];
      return anyNameMatches(
        all,
        /\b(google|github|facebook|apple|sso|microsoft|twitter)\b/i,
      );
    },
  },
  {
    name: "snapshot:forgot-password",
    weight: 2,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.links,
        /\b(forgot|reset)\s*(your\s*)?password\b/i,
      ),
  },
];

const SEARCH_RESULTS_SIGNALS: SignalDef[] = [
  {
    name: "url:search-path",
    weight: 4,
    test: (ctx) =>
      /\/(search|results)(\/|$|\?)/i.test(ctx.url.pathname) ||
      ctx.url.searchParams.has("q") ||
      ctx.url.searchParams.has("query") ||
      ctx.url.searchParams.has("s"),
  },
  {
    name: "url:search-engine-host",
    weight: 5,
    test: (ctx) => SEARCH_ENGINE_HOSTS.has(ctx.url.hostname),
  },
  {
    name: "meta:jsonld-search",
    weight: 5,
    test: (ctx) => ctx.meta.jsonLdType === "SearchResultsPage",
  },
  {
    name: "snapshot:results-heading",
    weight: 3,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.headings,
        /\bresults?\b|showing\s+\d+\s+results?\b/i,
      ),
  },
  {
    name: "snapshot:many-similar-links",
    weight: 2,
    test: (ctx) => ctx.snapshot.links.length >= 5,
  },
  {
    name: "url:pagination-params",
    weight: 2,
    test: (ctx) =>
      ctx.url.searchParams.has("page") ||
      ctx.url.searchParams.has("start") ||
      ctx.url.searchParams.has("p"),
  },
];

const PRODUCT_SIGNALS: SignalDef[] = [
  {
    name: "meta:jsonld-product",
    weight: 6,
    test: (ctx) => ctx.meta.jsonLdType === "Product",
  },
  {
    name: "meta:og-product",
    weight: 4,
    test: (ctx) =>
      ctx.meta.ogType === "product" || ctx.meta.ogType === "product:item",
  },
  {
    name: "url:product-path",
    weight: 3,
    test: (ctx) =>
      /\/(product|dp|item|p|pd)(\/|$)/i.test(ctx.url.pathname),
  },
  {
    name: "snapshot:price-pattern",
    weight: 4,
    test: (ctx) => ctx.snapshot.priceCount >= 1,
  },
  {
    name: "snapshot:add-to-cart",
    weight: 4,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.buttons,
        /\b(add\s*to\s*cart|buy\s*now|add\s*to\s*bag)\b/i,
      ),
  },
  {
    name: "snapshot:quantity-input",
    weight: 2,
    test: (ctx) =>
      anyNameMatches(
        [...ctx.snapshot.textboxes, ...ctx.snapshot.comboboxes],
        /\bquantity|qty\b/i,
      ),
  },
  {
    name: "snapshot:rating-review",
    weight: 2,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\d+(\.\d+)?\s*(star|★|\/\s*5)|reviews?\b/i),
  },
];

const PRODUCT_LIST_SIGNALS: SignalDef[] = [
  {
    name: "url:category-path",
    weight: 3,
    test: (ctx) =>
      /\/(category|collection|shop|c|browse)(\/|$)/i.test(ctx.url.pathname),
  },
  {
    name: "meta:jsonld-collection",
    weight: 5,
    test: (ctx) =>
      ctx.meta.jsonLdType === "CollectionPage" ||
      ctx.meta.jsonLdType === "ItemList",
  },
  {
    name: "snapshot:many-prices",
    weight: 4,
    test: (ctx) => ctx.snapshot.priceCount >= 4,
  },
  {
    name: "snapshot:filter-sort",
    weight: 3,
    test: (ctx) => {
      const all = [
        ...ctx.snapshot.buttons,
        ...ctx.snapshot.comboboxes,
        ...ctx.snapshot.links,
      ];
      return anyNameMatches(all, /\b(filter|sort\s*by|show\s*\d+\s*per|refine)\b/i);
    },
  },
  {
    name: "snapshot:pagination",
    weight: 2,
    test: (ctx) =>
      anyNameMatches(ctx.snapshot.links, /\b(next|prev(ious)?|page\s*\d+)\b/i),
  },
  {
    name: "url:pagination-path",
    weight: 2,
    test: (ctx) =>
      /\/page\/\d+/i.test(ctx.url.pathname) ||
      ctx.url.searchParams.has("page") ||
      ctx.url.searchParams.has("p"),
  },
];

const CHECKOUT_SIGNALS: SignalDef[] = [
  {
    name: "url:checkout-path",
    weight: 4,
    test: (ctx) =>
      /\/(cart|checkout|payment|order|basket)(\/|$|\?)/i.test(ctx.url.pathname),
  },
  {
    name: "snapshot:credit-card-fields",
    weight: 5,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.textboxes,
        /\b(card\s*number|cvv|cvc|expir|security\s*code|credit\s*card)\b/i,
      ),
  },
  {
    name: "snapshot:place-order-button",
    weight: 4,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.buttons,
        /\b(place\s*order|complete\s*purchase|pay\s*now|confirm\s*order|submit\s*order)\b/i,
      ),
  },
  {
    name: "snapshot:shipping-fields",
    weight: 3,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.textboxes,
        /\b(street|address|city|zip|postal|state|shipping)\b/i,
      ),
  },
  {
    name: "snapshot:order-summary",
    weight: 3,
    test: (ctx) =>
      snapshotContains(
        ctx.snapshot,
        /\b(order\s*summary|subtotal|total|order\s*total)\b/i,
      ),
  },
  {
    name: "snapshot:payment-methods",
    weight: 3,
    test: (ctx) => {
      const all = [
        ...ctx.snapshot.buttons,
        ...ctx.snapshot.links,
        ...ctx.snapshot.images,
      ];
      return anyNameMatches(
        all,
        /\b(visa|mastercard|paypal|apple\s*pay|google\s*pay|amex)\b/i,
      );
    },
  },
];

const ARTICLE_SIGNALS: SignalDef[] = [
  {
    name: "meta:jsonld-article",
    weight: 6,
    test: (ctx) =>
      /^(Article|NewsArticle|BlogPosting|BlogPost)$/i.test(
        ctx.meta.jsonLdType ?? "",
      ),
  },
  {
    name: "meta:og-article",
    weight: 4,
    test: (ctx) => ctx.meta.ogType === "article",
  },
  {
    name: "url:article-path",
    weight: 3,
    test: (ctx) =>
      /\/(blog|post|article|news|wiki)(\/|$)/i.test(ctx.url.pathname) ||
      /\/20\d{2}\//.test(ctx.url.pathname),
  },
  {
    name: "snapshot:single-h1",
    weight: 2,
    test: (ctx) => {
      const h1s = ctx.snapshot.headings.filter((h) => h.level === 1);
      return h1s.length === 1;
    },
  },
  {
    name: "snapshot:author-date",
    weight: 3,
    test: (ctx) =>
      snapshotContains(
        ctx.snapshot,
        /\b(by\s+[A-Z]|author|published|date|byline|written\s+by)\b/i,
      ),
  },
  {
    name: "snapshot:article-landmark",
    weight: 3,
    test: (ctx) =>
      ctx.snapshot.elements.some((e) => e.role === "article"),
  },
  {
    name: "snapshot:high-text-ratio",
    weight: 3,
    test: (ctx) => {
      if (ctx.snapshot.totalCount === 0) return false;
      const ratio = ctx.snapshot.interactiveCount / ctx.snapshot.totalCount;
      // Low interactive ratio = mostly text content
      return ratio < 0.4 && ctx.snapshot.totalCount > 5;
    },
  },
  {
    name: "snapshot:table-of-contents",
    weight: 5,
    test: (ctx) => {
      // Navigation element with hierarchical links, or elements with TOC-like id/class
      const hasTocNav = ctx.snapshot.elements.some(
        (e) =>
          (e.role === "navigation" &&
            /\b(toc|contents|table.of.contents)\b/i.test(e.name)) ||
          /\b(toc|table.of.contents|contents)\b/i.test(e.name),
      );
      // Also detect numbered section links (e.g. "1 Introduction", "2.1 History")
      const numberedLinks = ctx.snapshot.links.filter((l) =>
        /^\d+(\.\d+)*\s+\w/.test(l.name),
      );
      return hasTocNav || numberedLinks.length >= 4;
    },
  },
  {
    name: "snapshot:heading-hierarchy-depth",
    weight: 5,
    test: (ctx) => {
      // At least 3 distinct heading levels present (e.g. h2, h3, h4)
      const levels = new Set(
        ctx.snapshot.headings.map((h) => h.level).filter((l) => l !== undefined),
      );
      return levels.size >= 3;
    },
  },
  {
    name: "snapshot:references-section",
    weight: 5,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.headings,
        /\b(references|citations|bibliography|further\s+reading|see\s+also|works\s+cited|sources|notes\s+and\s+references)\b/i,
      ),
  },
  {
    name: "snapshot:inline-citations",
    weight: 4,
    test: (ctx) => {
      // Bracketed numbers [1][2][3] or many <cite>/<sup> elements
      const bracketCitations = ctx.snapshot.rawText.match(/\[\d+\]/g);
      const citeElements = ctx.snapshot.elements.filter(
        (e) => e.role === "superscript" || /\bcite\b/i.test(e.role),
      );
      return (bracketCitations !== null && bracketCitations.length >= 5) ||
        citeElements.length >= 5;
    },
  },
  {
    name: "snapshot:many-headings",
    weight: 4,
    test: (ctx) => {
      // Long-form content with many section headings (15+)
      return ctx.snapshot.headings.length >= 15;
    },
  },
  {
    name: "snapshot:high-element-count-low-interactive",
    weight: 3,
    test: (ctx) => {
      // Large page (200+ elements) with low interactive ratio = long-form text
      if (ctx.snapshot.totalCount < 200) return false;
      const ratio = ctx.snapshot.interactiveCount / ctx.snapshot.totalCount;
      return ratio < 0.5;
    },
  },
];

const DASHBOARD_SIGNALS: SignalDef[] = [
  {
    name: "url:dashboard-path",
    weight: 4,
    test: (ctx) =>
      /\/(dashboard|admin|analytics|app|console)(\/|$|\?)/i.test(
        ctx.url.pathname,
      ),
  },
  {
    name: "snapshot:nav-sidebar",
    weight: 3,
    test: (ctx) => {
      // Look for navigation element followed by many links
      const navs = ctx.snapshot.elements.filter(
        (e) => e.role === "navigation",
      );
      // Heuristic: 8+ links total suggests sidebar nav
      return navs.length > 0 && ctx.snapshot.links.length >= 8;
    },
  },
  {
    name: "snapshot:data-tables",
    weight: 3,
    test: (ctx) =>
      ctx.snapshot.elements.some(
        (e) => e.role === "table" || e.role === "grid" || e.role === "treegrid",
      ),
  },
  {
    name: "snapshot:charts-widgets",
    weight: 2,
    test: (ctx) =>
      ctx.snapshot.images.length >= 2 ||
      ctx.snapshot.elements.some((e) => e.role === "figure"),
  },
  {
    name: "snapshot:high-interactive-density",
    weight: 3,
    test: (ctx) => {
      if (ctx.snapshot.totalCount === 0) return false;
      const ratio = ctx.snapshot.interactiveCount / ctx.snapshot.totalCount;
      return ratio > 0.7 && ctx.snapshot.interactiveCount > 10;
    },
  },
  {
    name: "snapshot:logout-settings",
    weight: 2,
    test: (ctx) => {
      const all = [...ctx.snapshot.links, ...ctx.snapshot.buttons];
      return anyNameMatches(all, /\b(log\s*out|sign\s*out|settings)\b/i);
    },
  },
  {
    name: "meta:noindex",
    weight: 2,
    test: (ctx) => /noindex/i.test(ctx.meta.robots ?? ""),
  },
];

const FORM_SIGNALS: SignalDef[] = [
  {
    name: "url:form-path",
    weight: 3,
    test: (ctx) =>
      /\/(contact|apply|feedback|survey|form)(\/|$|\?)/i.test(
        ctx.url.pathname,
      ),
  },
  {
    name: "snapshot:many-text-inputs",
    weight: 3,
    test: (ctx) => ctx.snapshot.textboxes.length >= 4,
  },
  {
    name: "snapshot:submit-button",
    weight: 3,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.buttons,
        /\b(submit|send|send\s*message|request|apply)\b/i,
      ) &&
      !anyNameMatches(
        ctx.snapshot.buttons,
        /\b(log\s*in|sign\s*in|pay|place\s*order)\b/i,
      ),
  },
  {
    name: "snapshot:has-textarea",
    weight: 3,
    test: (ctx) =>
      ctx.snapshot.elements.some((e) => e.role === "textbox" && /message|comment|note|description/i.test(e.name)),
  },
  {
    name: "snapshot:form-labels",
    weight: 3,
    test: (ctx) =>
      countNameMatches(
        ctx.snapshot.textboxes,
        /\b(name|email|phone|company|subject)\b/i,
      ) >= 2,
  },
  {
    name: "snapshot:no-password",
    weight: 2,
    test: (ctx) => !ctx.snapshot.hasPasswordField,
  },
];

const ERROR_SIGNALS: SignalDef[] = [
  {
    name: "http:error-status",
    weight: 8,
    test: (ctx) => (ctx.status ?? 0) >= 400,
  },
  {
    name: "snapshot:error-heading",
    weight: 5,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.headings,
        /\b(404|not\s*found|error|403|500|503|forbidden|server\s*error)\b/i,
      ),
  },
  {
    name: "snapshot:few-interactive",
    weight: 2,
    test: (ctx) => ctx.snapshot.interactiveCount < 5,
  },
  {
    name: "snapshot:go-back-link",
    weight: 2,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.links,
        /\b(go\s*back|go\s*home|home|return|back\s*to)\b/i,
      ),
  },
  {
    name: "snapshot:error-body-text",
    weight: 3,
    test: (ctx) =>
      snapshotContains(
        ctx.snapshot,
        /\b(page\s*not\s*found|access\s*denied|server\s*error|something\s*went\s*wrong)\b/i,
      ),
  },
];

const CHALLENGE_SIGNALS: SignalDef[] = [
  {
    name: "snapshot:verification-text",
    weight: 6,
    test: (ctx) =>
      snapshotContains(
        ctx.snapshot,
        /\b(verify\s+(you\s+are|that\s+you('re|\s+are))\s+human|are\s+you\s+a\s+robot|i'?m\s+not\s+a\s+robot|prove\s+you('re|\s+are)\s+human|captcha|security\s+check|bot\s+detection|unusual\s+traffic|automated\s+queries)\b/i,
      ),
  },
  {
    name: "snapshot:challenge-action",
    weight: 5,
    test: (ctx) => {
      const all = [...ctx.snapshot.buttons, ...ctx.snapshot.links];
      return anyNameMatches(
        all,
        /\b(click\s+to\s+continue|press\s+(&|and)\s+hold|i'?m\s+not\s+a\s+robot|verify|continue\s+shopping)\b/i,
      );
    },
  },
  {
    name: "snapshot:access-denied-text",
    weight: 5,
    test: (ctx) =>
      snapshotContains(
        ctx.snapshot,
        /\b(access\s+denied|blocked|sorry.*can'?t\s+(access|process)|request\s+blocked|connection\s+has\s+been\s+blocked)\b/i,
      ),
  },
  {
    name: "snapshot:challenge-title",
    weight: 4,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.headings,
        /\b(access\s+denied|security\s+check|just\s+a\s+moment|please\s+wait|attention\s+required|one\s+more\s+step|verify|before\s+you\s+continue)\b/i,
      ),
  },
  {
    name: "snapshot:cloudflare-signals",
    weight: 5,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\bray\s*id\b/i) ||
      (snapshotContains(ctx.snapshot, /\bcloudflare\b/i) &&
        ctx.snapshot.totalCount < 30),
  },
  {
    name: "snapshot:sparse-page",
    weight: 3,
    test: (ctx) => ctx.snapshot.interactiveCount < 10 && ctx.snapshot.totalCount < 30,
  },
  {
    name: "snapshot:checkbox-verify",
    weight: 4,
    test: (ctx) => {
      const hasCheckbox = ctx.snapshot.elements.some(
        (e) => e.role === "checkbox",
      );
      const hasVerifyText = snapshotContains(
        ctx.snapshot,
        /\b(not\s+a\s+robot|human|verify|confirm)\b/i,
      );
      return hasCheckbox && hasVerifyText;
    },
  },
  {
    name: "snapshot:single-action-sparse",
    weight: 3,
    test: (ctx) => {
      // Single primary button on an otherwise empty page
      return ctx.snapshot.buttons.length <= 2 &&
        ctx.snapshot.textboxes.length === 0 &&
        ctx.snapshot.totalCount < 25;
    },
  },
];

const LANDING_SIGNALS: SignalDef[] = [
  {
    name: "url:root-path",
    weight: 3,
    test: (ctx) => {
      const p = ctx.url.pathname;
      return p === "/" || p === "/home" || p === "/home/" || p === "";
    },
  },
  {
    name: "url:marketing-path",
    weight: 3,
    test: (ctx) =>
      /\/(pricing|features|about|plans)(\/|$|\?)/i.test(ctx.url.pathname),
  },
  {
    name: "snapshot:cta-buttons",
    weight: 4,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.buttons,
        /\b(get\s*started|try\s*free|sign\s*up|learn\s*more|start\s*free|request\s*demo)\b/i,
      ),
  },
  {
    name: "snapshot:hero-heading",
    weight: 2,
    test: (ctx) => {
      const h1s = ctx.snapshot.headings.filter((h) => h.level === 1);
      return h1s.length === 1;
    },
  },
  {
    name: "meta:og-website",
    weight: 2,
    test: (ctx) => ctx.meta.ogType === "website",
  },
  {
    name: "snapshot:varied-sections",
    weight: 2,
    test: (ctx) => {
      // Multiple headings at different levels suggest sections
      const levels = new Set(ctx.snapshot.headings.map((h) => h.level));
      return levels.size >= 2 && ctx.snapshot.headings.length >= 3;
    },
  },
  {
    name: "meta:no-noindex",
    weight: 2,
    test: (ctx) => !/noindex/i.test(ctx.meta.robots ?? ""),
  },
];

const DOCUMENTATION_SIGNALS: SignalDef[] = [
  {
    name: "url:docs-path",
    weight: 4,
    test: (ctx) =>
      /\/(docs|documentation|api|reference|wiki|guide)(\/|$|\?)/i.test(
        ctx.url.pathname,
      ),
  },
  {
    name: "snapshot:sidebar-nav",
    weight: 3,
    test: (ctx) => {
      const navs = ctx.snapshot.elements.filter(
        (e) => e.role === "navigation",
      );
      return navs.length > 0 && ctx.snapshot.links.length >= 10;
    },
  },
  {
    name: "snapshot:code-blocks",
    weight: 3,
    test: (ctx) =>
      ctx.snapshot.elements.some(
        (e) => e.role === "code" || e.role === "pre",
      ) || snapshotContains(ctx.snapshot, /\bcode\b/i),
  },
  {
    name: "snapshot:breadcrumbs",
    weight: 2,
    test: (ctx) =>
      ctx.snapshot.elements.some(
        (e) =>
          e.role === "navigation" &&
          /breadcrumb/i.test(e.name),
      ),
  },
  {
    name: "snapshot:tech-headings",
    weight: 3,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.headings,
        /\b(version|api|method|parameter|endpoint|syntax|usage|install|config|reference)\b/i,
      ),
  },
  {
    name: "meta:jsonld-tech-article",
    weight: 5,
    test: (ctx) =>
      ctx.meta.jsonLdType === "TechArticle" ||
      ctx.meta.jsonLdType === "APIReference",
  },
];

const PROFILE_SIGNALS: SignalDef[] = [
  {
    name: "url:profile-path",
    weight: 4,
    test: (ctx) =>
      /\/(profile|account|settings|user|me|preferences)(\/|$|\?)/i.test(
        ctx.url.pathname,
      ),
  },
  {
    name: "snapshot:avatar-image",
    weight: 2,
    test: (ctx) =>
      anyNameMatches(ctx.snapshot.images, /\b(avatar|profile|photo|picture)\b/i),
  },
  {
    name: "snapshot:edit-profile-button",
    weight: 3,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.buttons,
        /\b(edit|update|save|change\s*password|edit\s*profile)\b/i,
      ),
  },
  {
    name: "snapshot:personal-info-fields",
    weight: 3,
    test: (ctx) =>
      countNameMatches(
        ctx.snapshot.textboxes,
        /\b(name|email|bio|phone|username|display\s*name)\b/i,
      ) >= 2,
  },
  {
    name: "snapshot:account-links",
    weight: 2,
    test: (ctx) =>
      anyNameMatches(
        ctx.snapshot.links,
        /\b(account|security|privacy|notification|billing|subscription)\b/i,
      ),
  },
  {
    name: "snapshot:single-user-name",
    weight: 2,
    test: (ctx) => {
      // A single h1 with a person-like name (not a page title pattern)
      const h1s = ctx.snapshot.headings.filter((h) => h.level === 1);
      return (
        h1s.length === 1 &&
        anyNameMatches(ctx.snapshot.elements, /\b(avatar|profile)\b/i)
      );
    },
  },
];

const MEDIA_SIGNALS: SignalDef[] = [
  {
    name: "url:media-path",
    weight: 4,
    test: (ctx) =>
      /\/(watch|video|play|gallery|album|episode|listen)(\/|$|\?)/i.test(
        ctx.url.pathname,
      ),
  },
  {
    name: "snapshot:video-audio-elements",
    weight: 5,
    test: (ctx) =>
      ctx.snapshot.elements.some(
        (e) =>
          e.role === "video" ||
          e.role === "audio" ||
          /\b(video\s*player|audio\s*player)\b/i.test(e.name),
      ),
  },
  {
    name: "snapshot:playback-controls",
    weight: 3,
    test: (ctx) =>
      anyNameMatches(
        [...ctx.snapshot.buttons, ...ctx.snapshot.elements],
        /\b(play|pause|mute|unmute|fullscreen|volume|rewind|forward)\b/i,
      ),
  },
  {
    name: "snapshot:timestamp-duration",
    weight: 2,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\b\d{1,2}:\d{2}(:\d{2})?\b/),
  },
  {
    name: "snapshot:related-content",
    weight: 3,
    test: (ctx) =>
      anyNameMatches(
        [...ctx.snapshot.headings, ...ctx.snapshot.elements],
        /\b(related|recommended|up\s*next|more\s*videos|you\s*may\s*also)\b/i,
      ),
  },
];

// P0-5: Feed page signals (Reddit, HackerNews, social feeds)
const FEED_SIGNALS: SignalDef[] = [
  {
    name: "url:feed-host",
    weight: 5,
    test: (ctx) =>
      /\b(reddit\.com|news\.ycombinator\.com|lobste\.rs|hackernews|slashdot\.org)\b/i.test(ctx.url.hostname),
  },
  {
    name: "url:feed-path",
    weight: 3,
    test: (ctx) =>
      /\/(feed|timeline|hot|new|top|rising|popular|trending)(\/|$|\?)/i.test(ctx.url.pathname),
  },
  {
    name: "url:feed-host-root",
    weight: 3,
    test: (ctx) => {
      // Known feed hosts at root path — feeds like HN serve the feed at "/", not "/feed"
      const isRoot = ctx.url.pathname === "/" || ctx.url.pathname === "";
      const isFeedHost = /\b(reddit\.com|news\.ycombinator\.com|lobste\.rs|hackernews|slashdot\.org)\b/i.test(ctx.url.hostname);
      return isRoot && isFeedHost;
    },
  },
  {
    name: "snapshot:repeated-item-links",
    weight: 4,
    test: (ctx) => {
      // P0-5: Repeated sibling detection — 5+ links with similar structure suggests feed items
      return ctx.snapshot.links.length >= 10;
    },
  },
  {
    name: "snapshot:link-dense-minimal-dom",
    weight: 3,
    test: (ctx) => {
      // Minimal DOMs where links dominate — high link:element ratio suggests a link feed
      // e.g. HN has few total elements but most are links to stories
      if (ctx.snapshot.totalCount < 5) return false;
      const linkRatio = ctx.snapshot.links.length / ctx.snapshot.totalCount;
      return linkRatio > 0.5 && ctx.snapshot.links.length >= 5;
    },
  },
  {
    name: "snapshot:table-feed-structure",
    weight: 3,
    test: (ctx) => {
      // Table-based feeds (HN-style): raw text contains repeated table-row feed markers
      // Detects athing/subtext (HN), or repeated row-like patterns in minimal DOMs
      return snapshotContains(ctx.snapshot, /\b(athing|subtext|titleline|storylink|comhead)\b/i) ||
        // Generic: repeated numbered items like "1.", "2.", ... in raw text (HN-style ranking)
        (ctx.snapshot.rawText.match(/^\s*\d+\.\s/gm) ?? []).length >= 5;
    },
  },
  {
    name: "snapshot:vote-score-elements",
    weight: 4,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\b(upvote|downvote|points?|score|karma|▲|▼)\b/i) ||
      countNameMatches(ctx.snapshot.buttons, /\b(upvote|downvote|vote)\b/i) >= 2,
  },
  {
    name: "snapshot:timestamps",
    weight: 3,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\b(\d+\s+(hours?|minutes?|days?|weeks?|months?)\s+ago|submitted|posted)\b/i),
  },
  {
    name: "snapshot:comment-counts",
    weight: 3,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\b\d+\s*comments?\b/i),
  },
];

// P0-5: Q&A page signals (StackOverflow, Q&A sites)
const QA_SIGNALS: SignalDef[] = [
  {
    name: "url:qa-host",
    weight: 5,
    test: (ctx) =>
      /\b(stackoverflow\.com|stackexchange\.com|superuser\.com|askubuntu\.com|serverfault\.com|quora\.com)\b/i.test(ctx.url.hostname),
  },
  {
    name: "url:qa-path",
    weight: 3,
    test: (ctx) =>
      /\/(questions?|answers?|ask)(\/|$|\?)/i.test(ctx.url.pathname),
  },
  {
    name: "snapshot:question-answer-structure",
    weight: 4,
    test: (ctx) =>
      anyNameMatches(ctx.snapshot.headings, /\b(question|answer|asked|solution)\b/i) ||
      snapshotContains(ctx.snapshot, /\b(asked|answered|modified)\b/i),
  },
  {
    name: "snapshot:vote-counts",
    weight: 4,
    test: (ctx) =>
      countNameMatches(ctx.snapshot.buttons, /\b(up\s*vote|down\s*vote|vote)\b/i) >= 2,
  },
  {
    name: "snapshot:accepted-answer",
    weight: 5,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\b(accepted\s*answer|best\s*answer|✓|✔)\b/i) ||
      anyNameMatches(ctx.snapshot.elements, /\b(accepted|checkmark)\b/i),
  },
  {
    name: "snapshot:tags-badges",
    weight: 3,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\b(tagged|tags?:)\b/i) ||
      anyNameMatches(ctx.snapshot.links, /^(javascript|python|java|html|css|react|node|sql|c\+\+|php|ruby|swift|go|rust|typescript)\b/i),
  },
];

// P0-5: Ecommerce homepage signals (Amazon, eBay, marketplace)
const ECOMMERCE_SIGNALS: SignalDef[] = [
  {
    name: "url:ecommerce-host",
    weight: 5,
    test: (ctx) =>
      /\b(amazon\.|ebay\.|walmart\.|etsy\.|shopify\.|aliexpress\.|target\.com|bestbuy\.com)\b/i.test(ctx.url.hostname),
  },
  {
    name: "snapshot:cart-icon",
    weight: 4,
    test: (ctx) =>
      anyNameMatches(
        [...ctx.snapshot.buttons, ...ctx.snapshot.links],
        /\b(cart|basket|bag|shopping\s*cart)\b/i,
      ),
  },
  {
    name: "snapshot:product-grid-prices",
    weight: 4,
    test: (ctx) =>
      ctx.snapshot.priceCount >= 3 &&
      ctx.snapshot.images.length >= 3,
  },
  {
    name: "snapshot:prominent-search",
    weight: 3,
    test: (ctx) =>
      ctx.snapshot.elements.some((e) => e.role === "searchbox") ||
      anyNameMatches(ctx.snapshot.textboxes, /\b(search|find)\b/i),
  },
  {
    name: "snapshot:deals-categories",
    weight: 3,
    test: (ctx) =>
      snapshotContains(ctx.snapshot, /\b(deal|sale|discount|% off|save\s+\$|clearance|department|categories)\b/i),
  },
  {
    name: "snapshot:repeated-product-elements",
    weight: 3,
    test: (ctx) => {
      // P0-5: Repeated sibling detection — many images + prices = product grid
      return ctx.snapshot.images.length >= 5 && ctx.snapshot.priceCount >= 4;
    },
  },
];

// ─── Type profiles ────────────────────────────────────────────────────────

const TYPE_PROFILES: TypeProfile[] = [
  { type: "login", maxPossible: 21, signals: LOGIN_SIGNALS },
  { type: "search-results", maxPossible: 21, signals: SEARCH_RESULTS_SIGNALS },
  { type: "product", maxPossible: 25, signals: PRODUCT_SIGNALS },
  { type: "product-list", maxPossible: 19, signals: PRODUCT_LIST_SIGNALS },
  { type: "checkout", maxPossible: 22, signals: CHECKOUT_SIGNALS },
  { type: "article", maxPossible: 30, signals: ARTICLE_SIGNALS },
  { type: "dashboard", maxPossible: 19, signals: DASHBOARD_SIGNALS },
  { type: "form", maxPossible: 17, signals: FORM_SIGNALS },
  { type: "error", maxPossible: 20, signals: ERROR_SIGNALS },
  { type: "challenge", maxPossible: 35, signals: CHALLENGE_SIGNALS },
  { type: "landing", maxPossible: 18, signals: LANDING_SIGNALS },
  { type: "documentation", maxPossible: 20, signals: DOCUMENTATION_SIGNALS },
  { type: "profile", maxPossible: 16, signals: PROFILE_SIGNALS },
  { type: "media", maxPossible: 17, signals: MEDIA_SIGNALS },
  { type: "feed", maxPossible: 31, signals: FEED_SIGNALS },          // P0-5
  { type: "qa", maxPossible: 24, signals: QA_SIGNALS },              // P0-5
  { type: "ecommerce", maxPossible: 22, signals: ECOMMERCE_SIGNALS }, // P0-5
];

// ─── Scoring engine ───────────────────────────────────────────────────────

interface ScoreResult {
  score: number;
  confidence: number;
  firedSignals: string[];
}

function scoreType(profile: TypeProfile, ctx: ClassifyContext): ScoreResult {
  let score = 0;
  const firedSignals: string[] = [];

  for (const signal of profile.signals) {
    if (signal.test(ctx)) {
      score += signal.weight;
      firedSignals.push(signal.name);
    }
  }

  return {
    score,
    confidence: profile.maxPossible > 0 ? score / profile.maxPossible : 0,
    firedSignals,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.3;

const ALL_PAGE_TYPES: PageType[] = [
  "login",
  "search-results",
  "product",
  "product-list",
  "checkout",
  "article",
  "dashboard",
  "form",
  "error",
  "challenge",
  "landing",
  "documentation",
  "profile",
  "media",
  "feed",       // P0-5
  "qa",         // P0-5
  "ecommerce",  // P0-5
  "unknown",
];

function emptyScores(): Record<PageType, number> {
  const scores = {} as Record<PageType, number>;
  for (const t of ALL_PAGE_TYPES) {
    scores[t] = 0;
  }
  return scores;
}

export class PageClassifier {
  /** Classify a page based on URL, snapshot, and optional meta */
  static classify(input: ClassificationInput): ClassificationResult {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      url = new URL("https://unknown.invalid");
    }

    const snapshot = parseSnapshotText(input.snapshotText);

    const ctx: ClassifyContext = {
      url,
      status: input.status,
      snapshot,
      meta: {
        ogType: input.meta?.ogType,
        jsonLdType: input.meta?.jsonLdType,
        robots: input.meta?.robots,
        description: input.meta?.description,
      },
    };

    const allScores = emptyScores();
    let bestType: PageType = "unknown";
    let bestConfidence = 0;
    let bestSignals: string[] = [];

    for (const profile of TYPE_PROFILES) {
      const result = scoreType(profile, ctx);
      allScores[profile.type] = result.score;

      if (result.confidence > bestConfidence) {
        bestConfidence = result.confidence;
        bestType = profile.type;
        bestSignals = result.firedSignals;
      }
    }

    // Apply confidence threshold
    if (bestConfidence < CONFIDENCE_THRESHOLD) {
      bestType = "unknown";
      bestSignals = [];
      bestConfidence = 0;
    }

    return {
      type: bestType,
      confidence: Math.round(bestConfidence * 100) / 100,
      signals: bestSignals,
      allScores,
      metadata: {
        formFields: snapshot.textboxes.length,
        interactiveElements: snapshot.interactiveCount,
        hasPassword: snapshot.hasPasswordField,
        hasPrice: snapshot.priceCount > 0,
        jsonLdType: input.meta?.jsonLdType,
        ogType: input.meta?.ogType,
      },
    };
  }

  /** Quick classify from URL only (Layer 1 only, lower confidence) */
  static classifyUrl(url: string): ClassificationResult {
    return PageClassifier.classify({
      url,
      snapshotText: "",
    });
  }
}

export default PageClassifier;
