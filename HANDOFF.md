# Leapfrog — Session Handoff

**Date:** April 1, 2026
**Codename:** Leapfrog 🐸
**Session:** HydraChrome v0.2 build + rename + launch prep
**Context usage:** ~95% — time to hand off

---

## What Happened This Session

Built HydraChrome from v0.1 (11 tools) to Leapfrog v0.2 (19 tools), renamed everything, prepped for npm launch. 26 Opus sub-agents deployed across build, brainstorm, council review, naming, marketing, and distribution.

### Commits (10)
```
57e5f3c Brand package: ASCII frogs, color palette, naming guide
455b12b Launch doc: why/compare/how/numbers/start
0999b84 Rename to Leapfrog — leapfrog → leapfrog across entire codebase
ef5517a Launch prep: README, LICENSE, CLI flags, stress tests, council verdict
aa46c67 Upgrade Playwright to 1.59.0 — CVE patched, ariaSnapshot now typed
99061fc Add comprehensive roadmap from 5-agent brainstorm
c322e8e Security hardening: SSRF protection, JS eval bypass fix, site isolation
0e3d794 v0.2: Network intelligence, multi-tab, stealth, crash recovery, test suite
f341593 Add audit checkpoint and session handoff docs
b9f94a6 Security hardening: block file:// URLs, path traversal, JS eval guards
```

### What Was Built
- **5 new modules:** network-intelligence, tab-manager, stealth, crash-recovery, logger
- **8 new MCP tools:** network_log, console_log, network_intercept, wait_for, tabs_list, tab_switch, tab_close, session_health
- **Security:** SSRF protection, JS eval bypass fix, site isolation restored, Playwright CVE patched (1.48→1.59)
- **Tests:** 74 passing across 5 suites (snapshot engine, session manager, security, integration smoke, stress)
- **Stress tested:** 15 sessions, 50+ tabs, 0.3ms switches, 52MB peak heap
- **CLI flags:** --doctor, --config, --version
- **README:** Token bar chart, feature matrix, ecosystem glossary, 19-tool reference
- **LICENSE:** MIT, Anthony Bono 2026
- **BRAND.md:** 3 ASCII frog sizes, color palette, ecosystem naming guide
- **LAUNCH.md:** 5-section marketing/technical doc (why, comparison table, architecture, numbers, getting started)

### Council Verdict
Kill Sprints 4-7. Ship what exists. Let users write the next roadmap. See `council-20260401-roadmap-review.md`.

---

## What's Next — Apply Don's Fixes Then Publish

### Don Draper's Required Fixes (do these first)

**1. Number consistency — pick canonical numbers and use everywhere:**
- Playwright MCP: "~14,000 tokens" for content-heavy pages (Hacker News benchmark)
- Leapfrog: "~1,400 tokens" for the same page
- Savings: "up to 10x" (benchmark-corrected — median is ~4-5x, best case 10.3x on content-heavy pages)
- Tool count: 19 (verify and fix the "18" in BRAND.md)
- Range qualifier (use in LAUNCH.md): "2-10x savings, median ~4-5x across 8 page types"

**2. README.md fixes:**
- Replace README frog ASCII with BRAND.md's `@..@` design (large version)
- DONE: "12x fewer tokens" → "up to 10x fewer tokens" with range context
- Change "Splash" → "Surface" in ecosystem table ("what you see on the surface of the pond")

**3. LAUNCH.md fixes:**
- Move the "honest take" paragraph ABOVE the comparison table
- Cut "The frog does the rest." from the closing line (too cute for technical doc)

**4. Social copy fixes (stored in conversation, not files):**
- Reddit title: "I built a browser MCP that cuts page snapshots from 15,000 tokens to 1,200. Here's how it works." (drop product name from title)
- Reddit body: Lead with use case ("I run 15 sessions simultaneously"), put MCP config snippet last
- X thread: Cut from 5 tweets to 4 (kill the frog ecosystem tweet), make tweet 1 standalone
- HN title: "Show HN: Leapfrog – Multi-session browser MCP (1.2K tokens/page vs. Playwright's 15K)"
- HN body: Lead with architecture, zero frog metaphors, preempt agent-browser comparison
- ALL social: Need one visual asset (token comparison bar chart image or 10-second GIF)

### npm Publish Checklist

1. Apply Don's fixes above
2. Update `~/.mcp.json` to use `leapfrog` key + `LEAP_` env var prefix
3. Verify `npx leapfrog --doctor` works after rebuild
4. Verify `npx leapfrog --config` outputs correct JSON
5. Run `npm run build && npm test` — all 74 tests must pass
6. `npm publish` (or `npm publish --access public` if scoped)
7. Test: `npx leapfrog --version` from a clean environment

### Distribution — Week 1 Launch Channels

**Registries (do on publish day):**
1. Official MCP Registry — `mcp-publisher publish`
2. Smithery.ai — `smithery mcp publish`
3. Glama.ai — "Add Server" button
4. PulseMCP — submit form at pulsemcp.com/submit
5. MCP.so — GitHub issue
6. MCPServers.org — submit form

**Awesome lists (PRs on publish day):**
7. appcypher/awesome-mcp-servers (5,352 stars) — PR
8. ccplugins/awesome-claude-code-plugins (663 stars) — PR

**Social (publish day or day after):**
9. r/ClaudeAI (612K), r/ClaudeCode (96K), r/mcp (89K), r/cursor (77K)
10. Hacker News — Show HN
11. X/Twitter — 4-tweet thread
12. Claude Discord — MCP channel

**Week 2:**
13. Cursor Marketplace + cursor.directory
14. Windsurf / windsurf.run
15. Product Hunt
16. DEV.to technical post
17. LobeHub MCP Marketplace

---

## Key Files

| What | Where |
|------|-------|
| Source | `~/Projects/leapfrog/src/` (9 files) |
| Tests | `~/Projects/leapfrog/src/__tests__/` (5 files, 74 tests) |
| README | `~/Projects/leapfrog/README.md` |
| Brand guide | `~/Projects/leapfrog/BRAND.md` |
| Launch doc | `~/Projects/leapfrog/LAUNCH.md` |
| Roadmap | `~/Projects/leapfrog/ROADMAP.md` |
| Council verdict | `~/Projects/leapfrog/council-20260401-roadmap-review.md` |
| MCP config | `~/.mcp.json` → needs rename to `"leapfrog"` + LEAP_ env vars |
| Memory | `~/.claude/projects/-Users-ted/memory/project_leapfrog.md` |

## Env Vars (New Prefix)
- `LEAP_MAX_SESSIONS` (default 15)
- `LEAP_IDLE_TIMEOUT` (default 300000)
- `LEAP_HEADLESS` (default true)
- `LEAP_ALLOW_JS` (default true)
- `LEAP_STEALTH` (default true)
- `LEAP_LOG_LEVEL` (default info)

## Post-Launch Features (Community-Requested Only)
- Cookie import from real Chrome (macOS Keychain decryption) — #1 requested
- File download interception
- PDF generation
- Form auto-fill
- Session memory + loop detection
- Page classification
- API auto-discovery

## Session Stats
- 26 Opus 4.6 sub-agents deployed
- 10 commits
- 11 → 19 MCP tools
- 0 → 74 automated tests
- ~600 → ~3,000 lines TypeScript
- Playwright 1.48 → 1.59 (CVE patched)
- Named: Leapfrog 🐸
