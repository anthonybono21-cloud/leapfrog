# Session 8 Prompt — Deep Stealth & Self-Improvement Test

## Context

Session 7 shipped:
- **Multi-terminal tiling** — 3 bugs fixed (sidecar port conflict, reflowAll used local count, fs.watch broke on atomic rename). File-based coordination via tiles.json, directory watcher, auto-activates with LEAP_TILE.
- **Zoom-to-target** — viewport zooms 1.15x + green outline before every click. Uses Playwright locator boundingBox + elementFromPoint (not querySelector, since refMap stores Playwright selectors not CSS selectors). Zoom resets on navigate to prevent stuck zoom.
- **All 6 docs updated** — README, WHATS-NEW, SOCIAL-COPY, V060-MESSAGING-HIERARCHY, GTM-ADDENDUM, LAUNCH. Stripped HUD refs, 778 tests/31 suites, 34 tools, closed self-improvement loop.
- **200-site stealth blitz** — 93% pass rate (186/200) at tier 0. 4 blocked (H&M, Bath & Body Works, Kroger, Expedia). 3 timeouts. 7 redirect errors.

Key finding: `execute` tool bypasses the navigate handler, so the 200-site blitz did NOT feed the self-improvement loop. Domain knowledge only accumulates via the `navigate` MCP tool.

## Step 1: Deep Stealth & Self-Improvement Test (30 sites)

The goal: prove the self-improvement loop works by visiting 30 tough sites **via the navigate tool** (not execute), with real interactions — clicking, filling, searching — multiple times each. Track:

1. **Wait strategy learning** — does the system learn optimal wait methods per domain?
2. **Stealth tier escalation** — do blocked sites trigger tier escalation on revisit?
3. **Consent selector caching** — do cookie banners get auto-dismissed faster on revisit?
4. **Navigation timing trends** — does avg nav time decrease as the system learns?

### Test Protocol

1. Clear domain knowledge (`rm -rf ~/.leapfrog/domains/`)
2. Create 4 headed sessions (tiled)
3. **Round 1 (baseline):** Navigate to each site, take snapshot, check domain_knowledge
4. **Round 2 (interact):** Click links, fill search boxes, navigate subpages
5. **Round 3+ (revisit):** Same sites again — check if learned strategies kick in
6. After 3+ rounds, dump domain knowledge JSON and compare against Round 1

### Target Sites (30 — mix of tough and easy)

**Anti-bot aggressive (expect blocks):**
1. zillow.com — blocked session 7, fresh session got through
2. hm.com — "Access Denied" in blitz
3. kroger.com — "Access Denied" in blitz
4. bathbodyworks.com — "Access to this page has been denied"
5. expedia.com — "Bot or Not?" detection page

**Heavy SPAs / dynamic content:**
6. airbnb.com — redirect-heavy, SPA
7. booking.com — complex JS, consent banners
8. doordash.com — SPA, location detection
9. instacart.com — SPA, location
10. uber.com — SPA

**Consent banner heavy (EU-style or US opt-out):**
11. cnn.com — consent + DRM notice
12. bbc.com — cookie banner (UK)
13. theguardian.com — GDPR consent
14. lemonde.fr — French GDPR
15. spiegel.de — German GDPR

**Stealth-relevant (fingerprint checking):**
16. ticketmaster.com — Distil Networks bot detection
17. nike.com — Akamai bot detection
18. linkedin.com — bot detection on deep pages
19. walmart.com — PerimeterX
20. target.com — bot detection on product pages

**Fast baseline (should always pass):**
21. wikipedia.org
22. github.com
23. news.ycombinator.com
24. docs.anthropic.com
25. stackoverflow.com

**Search engines (different detection):**
26. google.com — reCAPTCHA risk
27. bing.com
28. duckduckgo.com
29. yahoo.com
30. brave.com

### Publishable Output

- Table: site x visit# with pass/fail, stealth tier, wait strategy, timing
- Domain knowledge JSON diffs (before/after)
- Chart data for token/timing curves
- Narrative: "Visit #1 was raw. Visit #5 was surgical."

## Step 2: Remaining Publish Checklist

- [ ] `npm publish --access public` (v0.6.1)
- [ ] `npx leapfrog --doctor` from clean terminal
- [ ] Glama submission (required for awesome-mcp-servers PR)
- [ ] Re-open awesome-mcp-servers PR (closed by punkpeye for inactivity)
- [ ] Registry submissions: Smithery.ai, PulseMCP, MCP.so, MCPServers.org, LobeHub
- [ ] Fix CI tests (stealth-enhanced.test.ts platform check, cdp-connector.test.ts Chrome check)

## Step 3: Auto-Research Improvements

From Session 7 analysis (5 proposals ranked by impact):

1. **YAML frontmatter** on research files — tags, confidence, staleness, related files
2. **Research-to-hypothesis pipeline** — extract testable hypotheses from research findings
3. **Research clustering + synthesis** — merge 3+ overlapping files into synthesis docs
4. **Confidence decay** — stale_after field + health check flags outdated research
5. **Domain-aware pre-loading** — surface relevant research when working on a domain

## Critical Rules
- Self-improving intelligence is ALWAYS the lead
- Multi-session is foundation
- Visit counter narrative (Visit 1 -> Visit 50) is core proof point
- HUD stripped to ripples + zoom-to-target only
- Self-improvement loop is CLOSED (functional, not "foundation")
- Token savings is proof the learning works, not the story
- Origin story: "Two agents, one browser, fighting"
- NEVER mix Zebra and LCL content

## Session 7 Stats
- 4 commits pushed
- 778 tests passing, 31 suites
- 34 tools
- 200-site stealth test: 93% pass rate
- Multi-terminal tiling: working (2 terminals x 3 sessions = 6-window unified grid)
- Zoom-to-target: working (1.15x zoom + scroll + green outline)
- 6 marketing docs updated
- 3 video recordings captured
