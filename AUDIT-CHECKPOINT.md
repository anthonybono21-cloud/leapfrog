# Leapfrog 5-Agent Audit — Checkpoint

**Date:** April 1, 2026
**Session:** Leapfrog Build
**Context:** Full audit complete, fixes not yet started

---

## Audit Results Summary

| Agent | Tests | Result |
|-------|-------|--------|
| Smoke Test (all 11 tools) | 16/16 | **PASS** — first live MCP transport test |
| Parallel Stress (3 concurrent sessions) | 8/8 | **PASS** — zero race conditions |
| Token Benchmark (7 sites + scoped) | Complete | **4-55x savings confirmed (median 5-8x)** |
| Edge Case Breaker (12 adversarial tests) | 8/12 | **2 security findings, 2 bugs** |
| Architecture Critic (full code review) | 17 issues | **3 CRITICAL, 7 HIGH** |

---

## What Works Great

- All 11 MCP tools functional via live transport
- Parallel session isolation is rock solid (separate BrowserContexts, independent refs)
- Token efficiency is real: avg ~1,200 tokens/page vs Playwright's 10-25K
- Scoped snapshots deliver 94-98% savings on targeted regions
- Action responses are ultra-lean (10-40 tokens for fill/click/press)
- Memory is tight: ~19MB RSS per session, 36MB heap for 5 sessions
- Navigation auto-detection in `act` is a major DX win
- Error messages are generally clean and actionable

## What's Broken (Must Fix Before Open Source)

### CRITICAL

1. **`file://` URLs expose local filesystem** — navigate to `file:///etc/passwd`, extract with type="text" returns full contents. Can read `~/.ssh/id_rsa`, `~/.aws/credentials`, etc.
2. **Arbitrary JS execution** — `extract(type="js")` runs anything in page context. Cookie theft, localStorage exfil, CSRF via fetch. No opt-in, no blocklist.
3. **Zero automated tests** — all eval was one-time manual. Total regression risk.
4. **Browser crash kills ALL sessions** — single Chromium process, no crash handler, silent session deletion.

### HIGH

5. **Path traversal in `session_save_profile`** — `name="../../.ssh/evil"` writes outside profiles dir.
6. **`profilePath` reads arbitrary files** — `session_create(profilePath="/etc/passwd")` reads any file.
7. **JS `undefined` crash** — `extract(type="js", js="undefined")` crashes with unhandled error.
8. **Infinite loop kills session** — `while(true){}` silently destroys session, no timeout.
9. **Plaintext credential storage** — profiles saved with default permissions (755).
10. **Undocumented `ariaSnapshot({ mode: "ai" })` dependency** — could break on any Playwright update.
11. **No logging** — zero forensic capability.
12. **No CI/CD pipeline** — no automated builds/tests.

### MEDIUM

13. **`maxChars` ignored for JS results** — 10MB text possible, could blow MCP transport.
14. **Dialog hangs** — `alert()`/`confirm()` freeze the session permanently.
15. **No multi-tab support** — OAuth popups, `target="_blank"` links lost.
16. **YAML parser edge cases** — quotes in aria labels, Unicode, odd indentation.
17. **Cleanup timer race condition** — could destroy session mid-operation.
18. **`interactiveOnly` drops article text** — LLMs can't "read the page", only see buttons/links.
19. **Double destroy returns success** — should error on second attempt.

### LOW

20. Screenshot directory grows unbounded.
21. `parseInt` without validation on env vars.
22. CSS selector timeout is 30s, not configurable.

---

## Fix Plan (Prioritized)

### Sprint 1: "Don't Get Roasted on HN" (~3 hours)

| # | Fix | Effort |
|---|-----|--------|
| 1 | Block `file://`/`data:`/`javascript:` URL schemes in navigate | 30 min |
| 2 | Sanitize profile name + validate resolved path | 30 min |
| 3 | Validate `profilePath` is within profiles dir | 15 min |
| 4 | Fix JS `undefined` crash (null-check) | 5 min |
| 5 | Add JS eval timeout (prevent infinite loops) | 30 min |
| 6 | Enforce `maxChars` on JS results | 15 min |
| 7 | Add `LEAP_ALLOW_JS=false` env default | 30 min |
| 8 | Dialog auto-dismiss (`page.on('dialog')`) | 15 min |

### Sprint 2: "Ship With Confidence" (~1-2 days)

| # | Fix | Effort |
|---|-----|--------|
| 9 | Pin Playwright version (`~1.48.0` not `^1.48.0`) | 5 min |
| 10 | Browser crash handler (`browser.on('disconnected')`) | 2 hrs |
| 11 | Profile file permissions (0o700 dir, 0o600 files) | 15 min |
| 12 | Structured logging (pino) | 2 hrs |
| 13 | Automated test suite (vitest) | 1 day |
| 14 | CI/CD pipeline (GitHub Actions) | 1 hr |

### Sprint 3: "Differentiate" (post-launch)

- Multi-tab/popup support
- Snapshot `mode="full"` for scraping workflows
- Network interception
- Session ownership/auth for SSE transport
- File download handling
- Independent snapshot engine (remove ariaSnapshot dependency)

---

## Token Benchmark Reference

| Site | Elements | Est. Tokens |
|------|----------|-------------|
| example.com | 2 | ~33 |
| news.ycombinator.com | 221 | ~1,441 |
| Wikipedia (AI) | 380 | ~2,500 (capped) |
| GitHub (claude-code) | 164 | ~1,255 |
| httpbin.org/forms | 15 | ~101 |
| BBC News | 96 | ~2,500 (capped) |
| DuckDuckGo | 168 | ~1,626 |
| **Average** | | **~1,200 tokens** |

Scoped snapshot: Wikipedia TOC = 196 tokens (98.4% savings vs full page)
Search workflow (4 tool calls): ~2,000 tokens total
Memory: ~19MB RSS per session

---

## Competitive Context

- **Honest efficiency claim:** 4-55x savings (median 5-8x), not 10-55x
- **Star projection reality:** 50-200 month 1 (not 500-2K)
- **Key risks:** Playwright could add native multi-session; agent-browser could add MCP
- **Moat:** Multi-session isolation + profile management + compact snapshots. Ship fast.

---

## Key Files

| What | Where |
|------|-------|
| Source | `~/Projects/leapfrog/src/` (4 files, ~1,250 lines) |
| Built output | `~/Projects/leapfrog/dist/` |
| MCP registration | `~/.mcp.json` → `"leapfrog"` |
| Profiles | `~/.leapfrog/profiles/` |
| Screenshots | `~/Documents/leapfrog-screenshots/` |
| Research | `~/Documents/AI-BROWSER-LANDSCAPE-RESEARCH.md` |
| Build handoff | `~/whats-next.md` |
| This audit | `~/Projects/leapfrog/AUDIT-CHECKPOINT.md` |
| Memory | `~/.claude/projects/-Users-ted/memory/project_leapfrog.md` |
