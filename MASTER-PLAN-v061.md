# Leapfrog Master Plan — v0.6.1+

**Single source of truth. Supersedes MASTER-PLAN.md (v0.3.0 era).**
**Last updated:** 2026-04-05
**Current version:** v0.6.1 (pushed to GitHub, not yet published to npm)

---

## Where We Are

| Metric | Value |
|--------|-------|
| Version | 0.6.1 (package.json already bumped) |
| MCP tools | 34 |
| Tests | 778 passing, 31 suites |
| Source modules | 34 |
| GitHub | pushed, 21 commits ahead of last npm publish |
| npm | last published version is 0.5.2 |
| Stars | TBD (not yet launched publicly) |
| Stealth pass rate | 93% across 200 sites (Session 7 blitz test) |

### What's Built & Working
- 15 parallel isolated browser sessions
- Compact accessibility snapshots (3-10x fewer tokens than Playwright MCP)
- 14 anti-detection stealth patches + humanization
- Network intelligence (capture, filter, mock, intercept, API discovery)
- Auth profiles with persistent Chrome profiles
- SSRF hardening (hex IP, octal, CGNAT, redirect chains)
- Cookie consent auto-dismiss (10 frameworks + text fallback + modal scope)
- Human intervention detection (CAPTCHA, login, OAuth, Cloudflare)
- Red "NEEDS HUMAN" top bar + tab title prefix (visible at any tile size)
- Click ripple animation (HUD stripped to essentials)
- Scroll-to-target before clicks ("follow the agent's eyes")
- Per-domain self-improvement (wait strategies, stealth tiers, consent selectors, API endpoints)
- Self-improvement loop CLOSED — learned data feeds into navigation decisions
- Domain normalization (www. stripping)
- Auto window tiling with maximize-based screen detection
- Z-order management (raiseAllWindows)
- Multi-terminal tiling coordinator (auto-activates with LEAP_TILE, no separate env var)
- Zoom-to-target before clicks (1.15x zoom + green outline, uses Playwright locator not querySelector)
- Sidecar HTTP server (sessions, screenshots, grid control)
- Session recording/tracing (Playwright trace export)
- Sound notifications + macOS alerts
- Smart session naming by domain
- Pinned sessions

### What's NOT Built Yet
- `LEAP_RECORD` (screencast) — env var wired but no CDP implementation
- HTML dashboard for sidecar
- EU consent testing (need EU proxy)
- npm publish of v0.6.x (still at 0.5.2 on registry)
- Deep self-improvement validation (30-site repeated interaction test — Session 8 Step 1)
- Block detection for "Access Denied" pages (Zillow pattern — 200 status, denial content)

---

## 1. Immediate: Pre-Publish Checklist

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Bump package.json to 0.6.1 | DONE | Session 7 |
| 2 | Update README + all docs | DONE | Session 7 — 6 files updated (README, WHATS-NEW, SOCIAL-COPY, V060-MESSAGING-HIERARCHY, GTM-ADDENDUM, LAUNCH) |
| 3 | Manual headed smoke test | DONE | Session 7 — 6-window tiling, scroll-to-target, zoom-to-target, multi-terminal, 200-site stealth blitz |
| 4 | Test multi-terminal tiling | DONE | Session 7 — 2 terminals x 3 sessions, live reflow, crash recovery. 3 bugs fixed (sidecar port, reflowAll local count, fs.watch inode) |
| 5 | Deep self-improvement test (30 sites) | NOT DONE | Session 8 Step 1. Must use navigate tool (execute bypasses learning loop) |
| 6 | npm publish | NOT DONE | `npm publish --access public` |
| 7 | Verify clean install | NOT DONE | `npx leapfrog --doctor` from clean terminal |
| 8 | Fix CI tests (platform-specific) | NOT DONE | stealth-enhanced.test.ts hardcodes MacIntel, cdp-connector.test.ts needs Chrome |

---

## 2. Marketing Copy Updates Needed

The v0.6.0 marketing docs were written BEFORE the QA session that changed several features. These need updating:

### Files that need revision:
| File | Issue |
|------|-------|
| `SOCIAL-COPY-v060.md` | References "HUD overlay with color-coded session borders", "Agent cursor + click ripple", status bars. HUD was stripped — only ripples remain. Intervention redesigned with red top bar + tab title. |
| `WHATS-NEW-v060.md` | Section 3 "HUD Overlay & Color Borders" describes removed features. Section 5 "Click Ripple & Agent Cursor" — cursor removed, only ripple remains. Section 11 "Self-Improving Intelligence" needs update: loop is now CLOSED, not just "foundation". |
| `V060-MESSAGING-HIERARCHY.md` | Level 3 "Command Center" mentions HUD borders, agent cursor. Section 6 "Expanding Brain" creative brief references HUD features. Video beats reference cursor/border visuals. |
| `GTM-V060-ADDENDUM.md` | Likely references old HUD features |
| `VIDEO-PRODUCTION-PLAN.md` | May reference HUD/cursor visuals that no longer exist |

### Key messaging changes:
1. **HUD story is now simpler:** "Click ripples show you what the agent clicked. A red bar appears when it needs you. That's it." No borders, no status dots, no cursor.
2. **Self-improvement is now REAL, not "foundation":** The loop is closed. Learned wait strategies are used. This upgrades the marketing claim from "it records" to "it actually learns and acts on what it learned."
3. **Intervention redesign:** "NEEDS HUMAN" red top bar visible at any tile size + tab title prefix. Not just `@..@` fullscreen overlay.
4. **Scroll-to-target** is a new demo-able feature: "The viewport follows the agent's actions so you can see what it's doing."
5. **Multi-terminal tiling** is a teaser/coming-soon: file-based coordination, ready but gated.
6. **Numbers update:** 34 tools, 778 tests, 27+ suites.

---

## 3. v0.6.2 Roadmap (Next Sprint)

| Priority | Item | Complexity | Notes |
|----------|------|-----------|-------|
| HIGH | Adaptive viewport (IDEA-001) | Medium | Set viewport = tile dimensions. Combine with scroll-to-target: at tile sizes use follow-mode, at full window show whole page. |
| HIGH | Battle-test multi-terminal tiling | Medium | Test LEAP_MULTI_TILE=true with 2+ terminals. Fix edge cases. Promote from gated to default-on when LEAP_TILE=true and another instance detected. |
| HIGH | Multi-monitor awareness | Medium | Each instance detects its own monitor via maximize. Coordinator stores per-monitor layouts in tiles.json. |
| MEDIUM | Wire stealth tier into domain knowledge | Low | Currently records stealthTier but navigate doesn't start at the learned tier. Add to getNavigationHints(). |
| MEDIUM | Cache new consent selectors to domain knowledge | Low | Auto-dismiss discovers a selector → store it via recordConsent(). Currently records but doesn't discover+store new ones. |
| MEDIUM | Sidecar HTML dashboard | Medium | Click-to-focus thumbnails, live session status grid. Served from sidecar on :9222. |
| LOW | LEAP_RECORD screencast | Medium | CDP-based screen recording per session. Needs `page.screencast` or CDP `Page.startScreencast`. |
| LOW | Sourcepoint + Piano consent frameworks | Low | Used by Guardian, BBC, WaPo. Add to selector database. |
| LOW | LRU eviction testing | Low | Only 17 domains in current knowledge. Need synthetic test for 500+ cap behavior. |

---

## 4. v0.7.0 Vision: Multi-Agent Orchestration

**The killer feature:** Two Claude Code terminals, 8+ browsers tiled across your screen(s), coordinated automatically. One agent researching competitors while another tests your app.

### Already built (in v0.6.1):
- File-based tiles-coordinator.ts with claimSlot/releaseSlot/reapDeadSlots
- Dead PID detection for crash recovery
- fs.watch for cross-instance notifications
- Atomic file writes (tmp + rename)
- Gated behind LEAP_MULTI_TILE

### Still needed:
- Battle testing with real multi-terminal usage
- Per-monitor grid calculation (different instances on different screens)
- Sidecar port conflict resolution (currently crashes on EADDRINUSE — need per-instance port or skip sidecar when coordinator active)
- Shared domain knowledge? (currently per-instance — should knowledge persist across all instances since it's already at ~/.leapfrog/domains/)
- Dashboard showing all instances + all sessions

---

## 5. Launch Strategy

### Phase 1: Publish (NOW)
- Bump version, verify README, publish to npm
- `npx leapfrog --doctor` on clean machine
- GitHub repo already public

### Phase 2: Social Blitz (Day 0)
- Update SOCIAL-COPY-v060.md with v0.6.1 corrections first
- X thread (self-improving intelligence lead, visit counter narrative)
- Reddit posts (r/ClaudeAI, r/ClaudeCode, r/mcp)
- HN Show HN
- Discord (Claude, Cursor)
- Product Hunt

### Phase 3: Registry Submissions (Day 0)
- Smithery.ai, Glama.ai, PulseMCP, MCP.so, MCPServers.org, LobeHub

### Phase 4: Awesome Lists (Day 0-1)
- punkpeye/awesome-mcp-servers, appcypher/awesome-mcp-servers, ccplugins/awesome-claude-code-plugins

### Phase 5: Content Cycle (Days 1-14)
- SOCIAL-COPY-v060.md has a full 2-week content calendar
- Dev.to article
- Expanding Brain frog meme
- Demo videos (tiling, intervention, self-improvement flywheel)

### Phase 6: Video (Days 7-14)
- 30-60s demo clip showing tiling + intervention + self-improvement
- Kling clips for social
- Remotion composition for polished version

---

## 6. Competitive Landscape (Current)

| Competitor | Stars | Differentiator | Leapfrog Advantage |
|-----------|-------|---------------|-------------------|
| Playwright MCP | ~15K | Official, well-known | 3-10x fewer tokens, multi-session, stealth, learning |
| browser-use | ~81K | Highest stars | Multi-session isolation, network intel, learning |
| agent-browser | ~2K | Raw token efficiency | Multi-session, stealth, learning, MCP-native |
| Dev-Browser | ~5K | Code-first execution | MCP-native (works with Cursor/Windsurf, not just Claude Code), multi-session, stealth |
| stagehand | ~12K | AI-powered selectors | Deterministic snapshots, multi-session, lighter |

**Leapfrog's unique quadrant:** Multi-session + self-improving + MCP-native + stealth + local. No competitor ships all five.

---

## 7. Architecture Reference

### Source files (key modules)
```
src/index.ts              — MCP server, tool handlers, integration wiring (2600+ lines)
src/session-hud.ts        — Click ripple only (stripped from 225→135 lines)
src/intervention.ts       — CAPTCHA/login detection, red top bar, tab title prefix
src/tile-manager.ts       — Screen detection (maximize approach), grid calc, z-order
src/tiles-coordinator.ts  — File-based multi-terminal coordination (NEW in v0.6.1)
src/domain-knowledge.ts   — Per-domain learning, getNavigationHints, normalizeDomain
src/consent-dismiss.ts    — 10 frameworks + text fallback + modal scope
src/sidecar.ts            — HTTP control server
src/notify.ts             — Sound + macOS notifications
src/adaptive-wait.ts      — Wait strategy escalation
src/stealth.ts            — 14 anti-detection patches
src/humanize-*.ts         — Mouse, typing, scroll humanization
```

### Key env vars
```
LEAP_HEADLESS=false       — Headed mode
LEAP_TILE=true            — Auto-tile windows
LEAP_MULTI_TILE=true      — Multi-terminal tiling (v0.6.1, gated)
LEAP_HUD=true             — HUD (now just ripples)
LEAP_SOUND=true           — Marimba chime on intervention
LEAP_AUTO_CONSENT=true    — Cookie consent auto-dismiss
LEAP_TRACE=true           — Playwright tracing
LEAP_CHANNEL=chrome       — Use system Chrome
```

---

## 8. Known Issues

### From QA (v0.6.1)
- Tiling still slightly overlaps on some Retina displays — maximize detection helps but may need fine-tuning
- Multi-terminal coordinator not battle-tested with real usage
- Consent untestable from US IP (need EU proxy for GDPR banners)
- 1 pre-existing flaky test (humanize-scroll ramp-up assertion)

### Deferred from earlier versions
- 7 P2 bugs from v0.5.1 (non-critical, documented in project_leapfrog_v51_bugs.md)
- LEAP_RECORD screencast unimplemented
- Sidecar /zoom/:id just does bringToFront, no actual maximize

---

## Decision Log

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-04-05 | Strip HUD to ripples only | User confirmed borders/status bar/cursor completely invisible at tile sizes. "I don't think we need the HUD either" — kept only ripples. |
| 2026-04-05 | File-based multi-terminal over shared sidecar | Sidecar = SPOF, race conditions, port drama, leader election complexity. File lock = autonomous instances, crash recovery via dead PID detection, zero network. |
| 2026-04-05 | Maximize-on-first-window for screen detection | User's idea. One maximized window IS the ground truth for usable screen area. No platform hacks needed. |
| 2026-04-05 | Scroll-to-target before every click | "Follow the agent's eyes" — user sees what the agent is about to click at full readable size, solving the tiny-tile-sliver problem without scaling the whole page. |
| 2026-04-05 | Self-improvement loop must be CLOSED, not just recording | QA found domainRecord was a dead variable. Fixed: getNavigationHints feeds learned wait strategy into adaptiveNavigate. |
