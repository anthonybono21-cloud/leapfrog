# Leapfrog Roadmap

**Generated:** April 1, 2026
**Source:** 5-agent parallel brainstorm (enterprise, features, AI-native, security, DX)
**Current:** v0.2 — 19 tools, 9 modules, 52 tests, stealth + crash recovery + network intel

---

## Sprint 3: Security + Enterprise Foundation (This Week)

### P0 — Must Ship
- [x] Fix `wait_for` JS bypass of `ALLOW_JS` gate
- [x] Remove site isolation weakening from stealth args
- [x] SSRF protection (internal IPs, cloud metadata, DNS rebinding)
- [ ] Upgrade Playwright to >=1.55.1 (SSL cert verification CVE)
- [ ] Per-tool latency tracking (wrap handlers with timing, expose P50/P95/P99 in pool_status)
- [ ] CPU watchdog (auto-kill hung pages after 5s health check)
- [ ] Security event logging (`logger.security()` for URL blocks, JS gate, screenshots, profile ops)

### P1 — Production Ready
- [ ] Session state serialization (survive restarts via `context.storageState()` + URL to disk)
- [ ] YAML config file (`~/.leapfrog/config.yaml` with Zod validation)
- [ ] HTTP health endpoint (`/_health` on configurable port)
- [ ] Graceful drain mode (SIGTERM → stop accepting new sessions, wait for idle)
- [ ] Screenshot directory garbage collection (24h TTL, 500MB cap)
- [ ] WebRTC IP leak prevention (`--enforce-webrtc-ip-permission-check`)
- [ ] Service Worker blocking (`serviceWorkers: 'block'` on context creation)

---

## Sprint 4: Advanced Browser Features (Next Week)

### High Impact
- [ ] **Cookie import from real Chrome** — decrypt Chrome SQLite cookies, inject into session. `better-sqlite3` + `crypto` for AES-128-CBC decryption with Keychain key. THE biggest capability unlock.
- [ ] **File download interception** — `page.on('download')`, save to `~/Documents/leapfrog-downloads/`, `download_list` + `download_wait` tools
- [ ] **PDF generation** — `page.pdf()` with format/margin/scale options, headless-only
- [ ] **Form auto-fill** — `form_detect` (discover fields) + `form_fill` (fill by name/label, handles input types). Saves 10-50 tool calls per form.
- [ ] **Page diff** — store previous snapshot on session, return only added/removed/changed elements

### Medium Impact
- [ ] **iframe support** — enumerate `page.frames()`, snapshot each, prefix with `[frame:X]`, resolve in `act`
- [ ] **Clipboard R/W** — grant permissions, `navigator.clipboard.readText/writeText`
- [ ] **Geolocation spoofing** — optional params on `session_create`, `set_geolocation` tool
- [ ] **HAR capture/replay** — `browserContext.recordHAR()` / `routeFromHAR()`
- [ ] **Session recording to video** — `recordVideo` option on context, return path on destroy

---

## Sprint 5: AI-Native Intelligence Layer

### Build Order: 1 → 2 → 3 → 5 → 4 → 6 → 7

1. **Session Memory + Loop Detection** (150 lines) — `actionHistory` ring buffer on session, fingerprint-based loop detection, `session_memory` tool
2. **Page Classification** (250 lines) — heuristic classifiers on accessibility tree: login_form, search_results, product_listing, checkout, error_page, captcha, cookie_consent, etc.
3. **Action Suggestions** (200 lines) — template-based suggestions per page type, with @eN refs mapped. Optional `includeIntelligence` flag on navigate/snapshot.
4. **Smart Element Targeting** (350 lines) — natural language element finding via fuzzy match + synonym dictionary + role/name scoring. "the login button" → @e7. No LLM needed.
5. **Structured Data Extraction** (400 lines) — agent provides JSON schema, Leapfrog populates from accessibility tree + DOM heuristics (table/list/key-value detection, type coercion)
6. **API Auto-Discovery** (300 lines) — analyze `networkLog` to find REST/GraphQL endpoints, infer schemas from captured response bodies, detect auth patterns
7. **Composite Actions** (500 lines) — `login()`, `search()`, `paginate()`, `accept_cookies()`, `fill_form()`. Orchestrate existing tools internally.

### Deferred
8. Visual Anchors — track elements across page loads by structural fingerprint matching

---

## Sprint 6: Enterprise Scaling

- [ ] Multi-process browser pool (worker_threads, N Chromium instances)
- [ ] Remote browser backends (`playwright.connect(wsEndpoint)`)
- [ ] OpenTelemetry tracing (optional, `LEAP_OTEL_ENDPOINT`)
- [ ] Prometheus metrics endpoint (`/metrics` on configurable port)
- [ ] Session journal (append-only NDJSON audit trail)
- [ ] Per-session memory limits + resource governor
- [ ] Profile encryption at rest (AES-256-GCM, machine-derived or user-supplied key)
- [ ] Rate limiting (session creation, navigation, global tool calls)

---

## Sprint 7: Multi-Tenant + HA

- [ ] API key authentication (for SSE/HTTP transport)
- [ ] Per-tenant session limits and usage metering
- [ ] Coordinator pattern for multi-instance load balancing
- [ ] Auto-restart on browser crash with session restore
- [ ] Data retention policies + `purge_session_data` tool (GDPR Art. 17)

---

## Open Source Launch Checklist

### Name Decision
Top candidates (all available on npm):
- **chromagent** — AI-first positioning, Chrome + Agent
- **browsepool** — SEO winner, describes exactly what it does
- **browsemux** — like tmux for browsers
- **agenthead** — AI agents + headless

### Pre-Launch
- [ ] Pick name
- [ ] README (one-liner, token savings table, feature matrix, quick start, tool reference)
- [ ] `postinstall` script for Playwright browser auto-install
- [ ] `--doctor` diagnostic command
- [ ] `--config` MCP config generator (Claude Code, Cursor, Windsurf)
- [ ] LICENSE (MIT)
- [ ] CONTRIBUTING.md
- [ ] SECURITY.md (data handling, stored data locations, retention)
- [ ] GitHub issue/PR templates
- [ ] CI/CD (GitHub Actions: build + test + npm audit)
- [ ] npm publish with `files`, `keywords`, `repository` fields

### Post-Launch
- [ ] Demo video: side-by-side token comparison vs Playwright MCP
- [ ] 5-7 recipe docs (login, scrape table, block ads, OAuth popup, monitor page)
- [ ] Blog post: "Why We Built Our Own Browser MCP"
- [ ] Docker image on GHCR
- [ ] Plugin system for custom tools
- [ ] "Cloud coming soon" waitlist

---

## Tool Count Projection

| Version | Tools | Category |
|---------|-------|----------|
| v0.1 | 11 | Core browser automation |
| **v0.2 (now)** | **19** | + Network intel, tabs, smart wait, health |
| v0.3 | ~28 | + Cookie import, PDF, downloads, forms, diff, iframe, clipboard |
| v0.4 | ~35 | + Session memory, classification, suggestions, extraction, API discovery, composites |
| v1.0 | ~40 | + Enterprise (config, metrics, health endpoint, plugins) |

---

## Competitive Position

> "The market is splitting into Camp A (Playwright wrappers) and Camp B (AI-native browsers). The winner will be Camp C — raw browser intelligence alongside efficient interaction primitives. Leapfrog's multi-session architecture is the right foundation."

No other tool combines: local-first + multi-session isolation + token efficiency + network intelligence + stealth + AI-native page understanding. That's the moat.
