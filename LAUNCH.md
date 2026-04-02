# Leapfrog: Multi-Session Browser MCP for AI Agents

## The Problem Nobody Talks About

Every AI agent that touches a browser today is flying blind and burning tokens.

Playwright MCP dumps 3,800-50,000 tokens per page snapshot into your context window. That's your agent reading the entire phone book to find one number. Over a ten-step workflow, you'll burn 114,000 tokens just on browser overhead -- before your agent does any actual thinking.

It gets worse. One browser instance means your agents fight over tabs. Need to log into two accounts simultaneously? Too bad. Need to compare two pages side-by-side? Open a new process. Sites detect your headless browser and block you at the door. A stray `alert()` dialog freezes your session permanently. And when the browser crashes -- not if, when -- it takes every session down with it. No recovery, no warning.

I got tired of watching Playwright eat my context window. So I built Leapfrog.

**Token efficiency**: 3-10x fewer tokens than Playwright MCP, depending on page complexity. Content-heavy pages (news, wikis) save up to 10x. Dense forms still save 2-3x. Median across real-world sites: ~4-5x.
**Parallel sessions**: 15 isolated browser sessions running simultaneously, each with its own cookies and state.
**Network intelligence**: See every HTTP request, response body, and timing. Mock APIs. Block ads. No other browser MCP does this.
**Stealth mode**: Patches navigator.webdriver, fakes Chrome plugins, randomizes canvas fingerprints. Sites think you're a real user.
**Multi-tab**: Popups, OAuth flows, and `target="_blank"` links are auto-tracked and switchable.
**Crash recovery**: Browser disconnects are caught and reported. Sessions are cleared cleanly, not left dangling.

One npm install. 19 tools. Zero cloud dependencies.

---

## Leapfrog vs. Everything Else

Before building this, I spent weeks testing every browser automation tool that claims to work with AI agents. Here's the honest assessment before you look at the table: agent-browser wins on raw token count (~200-400 tokens) because it returns extremely minimal snapshots. browser-use has 81K GitHub stars and the best benchmark scores (89.1% WebVoyager). Stagehand has the slickest developer experience with natural language actions. Computer Use sees the actual screen, which handles edge cases nothing else can.

Where Leapfrog pulls ahead: the combination of compact snapshots + parallel isolated sessions + network intelligence + stealth, running locally with zero cloud dependencies. Nobody else ships all of that in one package.

| | **Leapfrog** | **Playwright MCP** | **agent-browser** | **Stagehand** | **browser-use** | **Computer Use** |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **Tokens per page** | ~1,200 | 3,800-50K | ~200-400 | ~2,000+ (varies by LLM call) | ~1,500+ (LLM-dependent) | ~1,229 (screenshot) |
| **Parallel sessions** | 15 (isolated) | 1 | 1 | Yes (cloud, paid) | 1 (default) | 1 |
| **Session isolation** | Full (separate BrowserContexts) | No | No | Yes (cloud) | No | No |
| **Network intelligence** | Capture + filter + intercept + mock | No | No | No | No | No |
| **Stealth / anti-bot** | Yes (12 patches) | No | No | Yes (cloud proxy) | Partial | N/A |
| **Multi-tab / popups** | Auto-track + switch | No | No | Yes (auto-active) | No | No |
| **Smart wait** | 5 types (element, text, network, nav, JS) | Basic | No | Basic | No | No |
| **Console capture** | Yes (ring buffer, filtered) | Yes | No | No | No | No |
| **Crash recovery** | Yes (auto-detect, clean state) | No | No | Cloud-managed | No | No |
| **Auth/cookie persistence** | Save + restore profiles | No | No | Cloud-managed | No | No |
| **SSRF protection** | Yes (DNS resolution check) | No | No | Cloud-managed | No | No |
| **Local-first** | Yes (no cloud dependency) | Yes | Yes | No (Browserbase cloud) | Yes | Yes |
| **Language** | TypeScript | TypeScript | Rust CLI | TypeScript | Python | Python |
| **MCP native** | Yes | Yes | CLI (MCP wrapper exists) | Yes | No (SDK) | No (API) |
| **Open source** | MIT | Apache 2.0 | MIT | MIT | MIT | Proprietary |
| **Install complexity** | `npx leapfrog` | `npx @playwright/mcp` | `npm i -g agent-browser` | npm + Browserbase API key | `pip install browser-use` + API key | API access required |
| **Price** | Free | Free | Free | Free tier, then paid cloud | Free (+ LLM costs) | API token costs |

---

## How It Works

### Snapshot Engine

The core of Leapfrog's token efficiency is the snapshot engine. Instead of serializing the raw DOM (thousands of div tags, inline styles, script blocks), Leapfrog calls Playwright's `ariaSnapshot()` to get the accessibility tree -- a structured representation of what's actually on the page from a user's perspective.

That YAML output gets parsed into a tree of nodes, then filtered. Interactive elements (buttons, links, textboxes, checkboxes) always survive. Headings survive for structure. Images with alt text survive. Everything else -- decorative divs, hidden elements, presentation-only markup -- gets dropped.

Each surviving node gets a compact `@eN` reference (e.g., `@e1`, `@e2`) that maps back to a Playwright locator internally. Your agent sees `@e3 button "Submit"` and passes `@e3` to the `act` tool. No CSS selectors, no XPaths, no guessing. The ref map resets on each snapshot but the counter increments across the session for consistency.

The result: Hacker News renders in ~1,400 tokens (vs ~14,000 in Playwright — 10.3x savings). A GitHub repo page in ~1,255. Wikipedia-scale pages save ~5.6x. Even worst-case dense forms still deliver ~1.6x compression. Scoped snapshots (pass a CSS selector to snapshot just a form or a sidebar) deliver 94-98% savings on top of that.

### Session Architecture

One Chromium process, multiple `BrowserContext` instances. Each context is a complete isolation boundary -- separate cookies, separate localStorage, separate cache. Session A logged into Gmail and Session B logged into GitHub will never leak state.

The session pool caps at 15 concurrent sessions (configurable via `LEAP_MAX_SESSIONS`). An idle sweep runs every 30 seconds and destroys sessions that haven't been touched in 5 minutes (`LEAP_IDLE_TIMEOUT`). When the browser process crashes, a `disconnected` event handler fires, clears all session state, and the next `createSession` call spins up a fresh Chromium automatically. No zombie sessions, no orphaned contexts.

Auth profiles serialize to disk as Playwright `storageState` JSON files (cookies + localStorage) with `0o600` permissions. Create a session, log in manually, call `session_save_profile`, and every future session can mount that profile instantly.

### Network Intelligence

Every session gets automatic HTTP traffic capture via Playwright's `response` event listener. Requests flow into a 200-entry ring buffer (old entries evict first). Each entry captures method, URL, status, content-type, response size, timing, and optionally the response body for JSON/text responses under 10KB.

The `network_log` tool exposes this with regex filtering by URL pattern, method, status code range, and content-type. Want to see only failed API calls? `statusMin: 400`. Only JSON responses? `contentType: "json"`.

Network interception goes further. `network_intercept` uses Playwright's `page.route()` to block requests (kill ads and trackers), mock API responses (return custom JSON with any status code), or log specific traffic patterns. Rules are added and removed by ID, so agents can dynamically adjust interception during a workflow. This is the feature nobody else ships at the MCP layer.

### Stealth Mode

Headless Chromium has a dozen tells that bot-detection scripts look for. Leapfrog patches them via `addInitScript()` before any page loads: `navigator.webdriver` returns `undefined` instead of `true`. A full `window.chrome` object gets faked with `runtime`, `loadTimes()`, and `csi()`. Navigator plugins report 5 realistic Chrome plugins instead of an empty array. Canvas fingerprinting gets subtle per-pixel noise (+/- 1 in random color channels) to break fingerprint matching without visible artifacts. Hardware concurrency, device memory, languages, platform, and notification permissions all report realistic Chrome-on-macOS values.

Launch args include `--disable-blink-features=AutomationControlled` to suppress the automation banner. It works against most commercial bot detection. What it can't do: solve CAPTCHAs or bypass Cloudflare Turnstile. Those require human intervention or specialized services.

### Multi-Tab

The `TabManager` listens for `context.on('page')` events -- fires whenever a popup opens, `window.open()` is called, or a link with `target="_blank"` is clicked. New tabs auto-become the active page (the right default for OAuth flows where you need to interact with the popup immediately). Agents can list all tabs, switch by index (`-1` for most recent), and close tabs. Closed pages are auto-pruned from the tracking array.

### Security

SSRF protection resolves hostnames via DNS before navigation and blocks internal IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, link-local, IPv6 loopback). URL scheme validation blocks `file://`, `data:`, and `javascript:` URIs. Profile paths are validated to stay within `~/.leapfrog/profiles/` -- path traversal attempts are rejected. JS evaluation is gated behind `LEAP_ALLOW_JS` (on by default, disable for untrusted workflows). Profile names are sanitized to alphanumeric, dash, and underscore characters. These weren't nice-to-haves -- they came from a 5-agent security audit that found 3 critical vulnerabilities before launch. All fixed.

---

## The Numbers

- **74 tests** across 5 suites (session management, snapshot engine, network intelligence, tab management, security)
- **15 sessions, 50+ tabs each** -- 52MB peak heap under stress
- **~19MB RSS per session** in steady state
- **0.3ms tab switch** speed
- **2-10x token savings** vs Playwright MCP (median ~4-5x, verified across 8 page types: HN 10.3x, Wikipedia 5.6x, GitHub 5.2x, navigation 4.7x, dashboard 3.7x, simple 3.6x, form 2.6x, dense form 1.6x)
- **Scoped snapshot**: Wikipedia table of contents = 196 tokens (98.4% savings vs full page)
- **Action responses**: 10-40 tokens for click/fill/press (vs full re-snapshot in other tools)
- **3 dependencies**: Playwright, MCP SDK, Zod. That's it.
- **CVE current**: Playwright ^1.59.0

---

## Getting Started

**1. Add to your MCP config** (`~/.mcp.json` for Claude Code):

```json
{
  "leapfrog": {
    "command": "npx",
    "args": ["-y", "leapfrog"],
    "env": {
      "LEAP_MAX_SESSIONS": "15"
    }
  }
}
```

**2. Verify the setup:**

```bash
npx leapfrog --doctor
```

**3. Your agent now has 19 browser tools.** Create a session, navigate, and take a snapshot:

```
session_create -> s_k3m7x1
navigate(sessionId: "s_k3m7x1", url: "https://news.ycombinator.com")
-> [s_k3m7x1] Hacker News | 221 elements | ~1,400 tokens
```

**4. Interact using @eN refs from the snapshot.** Click `@e5`, fill `@e12`, extract text. No CSS selectors needed.
