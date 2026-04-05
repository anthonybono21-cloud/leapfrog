# Leapfrog GTM Plan — v0.6.0 Addendum

**Addendum to:** GTM-PLAN.md (v0.5.2 base plan)
**Date:** April 4, 2026
**Status:** Pre-launch strategy update

This document does NOT replace the existing GTM plan. It updates messaging, timing, targets, and launch materials for v0.6.0 features — specifically the self-improving intelligence system and the full "command center" UX package.

---

## 1. Release Strategy

### The Strategic Question: Ship v0.5.2 or Skip to v0.6.0?

**Recommendation: Skip v0.5.2 as a public launch. Ship v0.6.0 as the launch version.**

Reasoning:

1. **v0.5.2 was never npm-published.** There are zero external users. No one is expecting a v0.5.2 release. There is no upgrade path to manage, no breaking-change communication, no changelog migration. The version number is internal bookkeeping.

2. **v0.6.0 has a dramatically stronger story.** The v0.5.2 pitch is "multi-session browser MCP with fewer tokens." That's a features-and-numbers sell. The v0.6.0 pitch is "a browser MCP that gets smarter every time you use it." That's a narrative. Narratives spread. Feature lists don't.

3. **Self-improving intelligence is a moat.** Multi-session isolation and token efficiency are engineering advantages — someone else can build them. Per-domain learning that accumulates over weeks of real use creates switching costs. Once your `~/.leapfrog/domains/` directory has 50 trained domains, you're not uninstalling Leapfrog.

4. **The command center UX (tiling, HUD, intervention alerts, click ripple) makes for visual demos.** v0.5.2 was headless-first — hard to screenshot, hard to GIF, hard to demo. v0.6.0 has a 6-window tiled grid with click ripples and scroll-to-target showing agent actions. That's a GIF that sells itself.

5. **Competitive timing is still fine.** Nobody else has shipped the combination of multi-session + self-improving + command center UX. The window that was "open but closing" in the v0.5.2 plan is still open. No need to rush a weaker version out the door.

**What this means operationally:**

- Publish to npm as version `0.6.0` (not 0.5.2 or 1.0.0)
- All social copy, registry listings, and README reference v0.6.0
- The CHANGELOG ships with the full history (0.2.0 through 0.6.0) — shows depth of work, not a first attempt
- Keep v0.5.2 as the internal milestone it already is — the SSRF hardening and 778 tests become "security foundation" talking points

### Event Level: New Launch

This is NOT a "major update" — it's the public debut. Treat it with full launch energy: same Phase 1 sequence from GTM-PLAN.md (registries, awesome lists, Reddit, HN, X, Discord), but with stronger ammunition.

### Timing

The original GTM plan's 4-day prep sprint still applies. Once v0.6.0 code is committed and all tests pass:

- **Day 1:** Copy/asset updates (apply this addendum to all materials)
- **Day 2:** Visual assets (the tiled-grid GIF is now the hero asset, not the terminal GIF)
- **Day 3:** GitHub repo prep (unchanged from GTM-PLAN.md)
- **Day 4:** Launch day (same sequence, updated copy)

---

## 2. Updated Messaging by Audience

The structural rule from SOCIAL-COPY-v2.md still holds: **multi-session isolation leads.** But now it has a second act: **self-improving intelligence follows.** Token savings remains supporting evidence (position 4-5 in any pitch).

The new message stack for every audience:

```
1. Multi-session isolation  → "15 parallel browser sessions, fully isolated"
2. Self-improving intel     → "It learns. Visit #50 is faster than visit #1"
3. Command center UX        → "Tiled windows, colored HUD, intervention alerts"
4. Token efficiency          → "3-10x fewer tokens than Playwright MCP"
5. Everything else           → stealth, network intel, crash recovery, auth profiles
```

### Category 1: MCP Builders / Maintainers

**Updated pitch angle:**

> "Leapfrog learns per-domain intelligence over time. Visit #1 to github.com: default everything, full page scan, ~1,550 tokens. Visit #50: optimal wait strategy, known API endpoints, instant cookie dismissal, ~487 tokens. The knowledge persists at `~/.leapfrog/domains/` — it's the first MCP server that gets better with use, not just gets used."

**Why this works for them:** MCP builders think in systems. Self-improving intelligence is an architectural pattern they haven't seen in an MCP server. It's novel enough to examine, discuss, and potentially adopt in their own work.

**Updated outreach for Tier 1 targets:**

| # | Name | Updated Angle |
|---|------|---------------|
| 1 | Serkan Ozal | "Your DevTools MCP benchmarks proved token savings matter. We took it further — Leapfrog now learns per-domain optimal settings. Visit #50 to a site uses a fraction of the tokens visit #1 did. The knowledge accumulates at `~/.leapfrog/domains/`." |
| 2 | Mert Koseoglu | "Context Mode proved context overhead is the real problem. Leapfrog now attacks it with per-domain intelligence — the server learns which wait strategies, stealth tiers, and API endpoints work for each site. The savings compound over time." |
| 3 | TickTockBent | "Charlotte nailed compression. Leapfrog nailed persistence — and now it learns. Same site visited 50 times gets progressively faster, cheaper, and more reliable. Different evolutionary paths, same species." |

### Category 2: Browser Automation Complainers

**Updated pitch angle:**

> "The thing about Playwright MCP burning 14K tokens per page? Leapfrog already cut that to ~1,400. But here's what's new: it learns. Every site you visit, Leapfrog remembers what worked — wait strategies, cookie dismissals, API endpoints. Visit #50 is automatic. You configure nothing. It configures itself."

**Why this works for them:** These people are in pain. They don't want to think about configuration, optimization, or token budgets. "It configures itself" is the dream sentence for someone who's been hand-tuning Playwright timeouts.

**Updated outreach for Tier 1 targets:**

| # | Name | Updated Angle |
|---|------|---------------|
| 8 | Kieran Klaassen | "You asked about ditching the 12K token overhead. Done — and now it learns. Leapfrog remembers what works for each site. Your compound engineering system gets a browser that improves itself." |
| 9 | J.D. Hodges | "Your MCP token cost breakdown documented the problem. Leapfrog solves it — and v0.6.0 goes further: per-domain learning means the token cost drops with every visit. The numbers in your blog post become a 'before' snapshot." |
| 10 | Mario Giancini | "Your blog argued custom scripts beat MCPs on overhead. What if the MCP learned to be as lean as a custom script? Leapfrog v0.6.0 learns per-domain optimal settings. Visit #50 runs like a hand-tuned script." |

### Category 3: AI Dev Tool Influencers

**Updated pitch angle:**

> "Leapfrog is an open-source browser MCP that gets smarter every time you use it. Visit #1 to any site: full defaults, ~1,550 tokens. Visit #50: optimal settings, known endpoints, ~487 tokens. It also runs 15 parallel sessions with auto-tiling, colored HUD, and intervention alerts when it needs a human. The 'self-improving MCP server' angle is new in the space."

**Why this works for them:** Influencers need a narrative, not a feature list. "Self-improving" is a story. It implies a future. It generates questions ("How does it learn? What does it remember? How much does it improve?"). Questions generate content.

**Updated outreach for Tier 1 targets:**

| # | Name | Updated Angle |
|---|------|---------------|
| 17 | Gergely Orosz | "The #1 complaint about browser MCPs is overhead. Leapfrog solves it — and now learns per-domain intelligence so the overhead drops over time. Your Claude Code audience would find the 'self-improving MCP' architecture worth examining." |
| 18 | swyx + Alessio | "Self-improving infrastructure is the next wave for AI tooling. Leapfrog's per-domain intelligence — where a browser MCP learns optimal settings for each site it visits — is a concrete example. Fits the 'compound AI systems' thesis." |
| 19 | Lenny Rachitsky | "The browser MCP problem Boris Cherny's team hears about constantly just got a new answer. Leapfrog learns what works for each site. Visit #50 runs automatically — optimal settings, no configuration, fewer tokens." |

### Category 4: Claude Code / Cursor Community Leaders

**Updated pitch angle:**

> "Leapfrog v0.6.0 turns your AI agent's browser into a command center. 15 sessions auto-tile on screen. Click ripples and scroll-to-target show what the agent is doing. When a session hits a captcha, a red top bar appears with a chime -- handle it, agent resumes. And it all gets smarter: per-domain learning means every site visit improves the next one."

**Why this works for them:** These are practitioners. They want to see it, feel it, use it. The command center UX (tiling, HUD, intervention) is visceral — it's something they can show in a video. Self-improving intelligence is the "why I'm still using this in 3 months" answer.

**Updated outreach for Tier 1 targets:**

| # | Name | Updated Angle |
|---|------|---------------|
| 23 | Matt Pocock | "Your Claude Code skills repo shows you think about the agent experience. Leapfrog v0.6.0 adds a command center UX -- auto-tiled windows, click ripple + scroll-to-target showing agent actions in real-time -- plus self-improving per-domain intelligence. It's the browser MCP that learns your workflow." |
| 24 | Steve Yegge | "Browser automation is the weakest link in agent orchestration. Leapfrog just shipped self-improving intelligence: the MCP server learns optimal settings for each domain. Combined with 15 parallel sessions and a tiled command center, it's infrastructure that improves with use." |
| 25 | Simon Scrapes | "Leapfrog v0.6.0 demo material: auto-tiling 6 browser windows, click ripple + scroll-to-target on agent actions, red top bar captcha alerts, and per-domain learning that drops tokens by 40% over 50 visits. Your audience would want to see this." |

### Category 5: Playwright MCP / browser-use / Stagehand Users

**Updated pitch angle:**

> "Leapfrog started where Playwright MCP leaves off — multi-session, stealth, fewer tokens. v0.6.0 goes somewhere nobody else is going: self-improving per-domain intelligence. The MCP server learns wait strategies, stealth requirements, API endpoints, and cookie dismissals for each site. Visit #50 is automatic. No other browser tool does this."

**Why this works for them:** These users already know the landscape. They've tried Playwright MCP, maybe browser-use, maybe Stagehand. "Self-improving" is a genuinely new capability claim. It differentiates Leapfrog from everything in the space — not on a metric (tokens, speed) but on a trajectory (gets better over time).

**Updated outreach for Tier 1 targets:**

| # | Name | Updated Angle |
|---|------|---------------|
| 29 | Debbie O'Brien | "Leapfrog builds on Playwright's foundation and adds something new: per-domain learning. The MCP server remembers what worked for each site — wait strategies, stealth tiers, API endpoints. Visit #50 is fully automatic. Would love to show you the architecture." |
| 30 | Paul Klein IV (Browserbase) | "Browserbase is cloud-native. Leapfrog is local-first. Different niches, same mission. But v0.6.0 adds something neither approach has done: self-improving intelligence that learns per-domain optimal settings over time. Interesting convergent problem." |
| 31 | Ankit Shankar | "Your insight about browser MCP 'UX for the model' was exactly right. Leapfrog v0.6.0 takes it further: the MCP server learns what UX each domain needs. Visit #50 to github.com skips the defaults and applies learned-optimal settings automatically." |

---

## 3. New Outreach Targets for v0.6.0

The self-improving intelligence angle opens doors to communities that wouldn't have cared about "faster browser MCP." These are people interested in adaptive systems, agent memory, and learning infrastructure.

### New Individual Targets

| # | Name | Platform | Handle/URL | Why They'd Care | Outreach Angle |
|---|------|----------|------------|-----------------|----------------|
| 38 | **Lilian Weng** | Blog, X | [@lilianweng](https://x.com/lilianweng) / [lilianweng.github.io](https://lilianweng.github.io/) | Head of Safety Systems at OpenAI. Wrote the most-cited blog post on LLM-powered autonomous agents, including the memory/tool-use section. Her "agent = LLM + memory + planning + tool use" framework is canonical. | "Your autonomous agents blog defined the architecture: LLM + memory + tools. Leapfrog is a concrete implementation of the 'tool that builds its own memory' pattern — per-domain learning that accumulates over use. Thought you might find the design interesting." |
| 39 | **Harrison Chase** | X, GitHub | [@hwchase17](https://x.com/hwchase17) / LangChain | CEO of LangChain. Deeply invested in agent memory, tool use, and the infrastructure layer. LangGraph already has persistence. | "LangGraph nailed agent memory at the orchestration layer. Leapfrog adds it at the tool layer — the browser MCP itself learns per-domain intelligence. Visit #50 to a site uses learned-optimal settings. Might be an interesting integration story." |
| 40 | **Jim Fan** | X | [@DrJimFan](https://x.com/DrJimFan) | Senior Research Scientist at NVIDIA. Works on foundation agents, embodied AI, Voyager (the Minecraft agent that accumulates skills). His whole thesis is "agents that learn from experience." | "Voyager accumulates skills in Minecraft. Leapfrog accumulates domain knowledge for browser automation. Same pattern, different substrate — the tool learns wait strategies, stealth requirements, and API endpoints for each site it visits. Thought this might resonate." |
| 41 | **Andrej Karpathy** | X, YouTube | [@karpathy](https://x.com/karpathy) | Builds in public, deep audience of AI engineers. Recently focused on local-first AI tools. His "Software 2.0" thesis maps directly to self-improving infrastructure. | "Leapfrog is an open-source browser MCP that learns per-domain intelligence. Visit #1 is defaults. Visit #50 is optimal. The knowledge lives at `~/.leapfrog/domains/` — local-first, no cloud. Fits the 'software that writes itself' thesis." |
| 42 | **Simon Willison** | Blog, X | [@simonw](https://x.com/simonw) / [simonwillison.net](https://simonwillison.net/) | Prolific blogger on AI tools, LLMs, and developer experience. Covers every interesting tool in the space. His audience trusts his reviews. Has written about MCP. | "Leapfrog v0.6.0 adds per-domain learning — the MCP server remembers what worked for each website (wait strategies, stealth tiers, API endpoints). The knowledge accumulates locally at `~/.leapfrog/domains/`. Might be worth a look for your AI tools coverage." |
| 43 | **Matt Shumer** | X | [@MattShumer_](https://x.com/MattShumer_) | CEO of HyperWrite / OthelloGP. Building autonomous browser agents (Agent-E, WebAgent). Deep in the "agents that learn" space. | "HyperWrite's agents learn at the model level. Leapfrog learns at the infrastructure level — per-domain wait strategies, stealth tiers, API endpoints. The tool itself adapts. Different layer, complementary approach." |
| 44 | **Divam Gupta** | X, GitHub | [@divaboridea](https://x.com/divaboridea) | Built browser-use MCP connector. Active in the browser-agent intersection. His users would benefit from self-improving infrastructure under their agents. | "browser-use has the best autonomous browsing benchmarks. Leapfrog adds self-improving infrastructure underneath — per-domain learning that any browser agent can benefit from. Complementary layers." |
| 45 | **r/MachineLearning commenters** | Reddit | Active threads on agent memory | Regular threads on "how do you give agents persistent memory" and "why do agents forget everything." Self-improving intelligence is a direct answer. | Post: "We built a browser MCP server that learns. Per-domain intelligence accumulates at `~/.leapfrog/domains/` — wait strategies, stealth requirements, API endpoints. Visit #50 is automatic." |

### New Communities

| # | Community | Platform | Members | Why v0.6.0 Matters Here |
|---|-----------|----------|---------|------------------------|
| 1 | **r/MachineLearning** | Reddit | 3M+ | The self-improving intelligence pattern is a real ML system in production. They appreciate systems that learn from data, not just run inference. |
| 2 | **r/LangChain** | Reddit | Active | Agent memory/persistence is a core topic. Leapfrog's per-domain learning is tool-level memory — novel angle for this community. |
| 3 | **AI Engineer Discord** (Latent Space) | Discord | Growing | swyx's community focuses on AI infrastructure. Self-improving tools are the next layer of the stack. |
| 4 | **Hacker News "Ask HN: How do you handle agent memory?"** | HN | Periodic threads | Self-improving intelligence is a concrete, working answer to this recurring question. |
| 5 | **r/ExperiencedDevs** | Reddit | Large | Senior engineers who care about tools that earn their place over time. "It gets better with use" resonates with the long-term-thinking crowd. |

---

## 4. v0.6.0 Release Communications

### GitHub Release Note

```markdown
# Leapfrog v0.6.0 — Self-Improving Intelligence

Leapfrog now learns from every site it visits.

**Visit #1 to github.com:** Default everything. Full stealth. Full page scan. ~1,550 tokens.
**Visit #50 to github.com:** Optimal wait strategy. Known API endpoints. Instant cookie dismissal. ~487 tokens.

Per-domain knowledge accumulates at `~/.leapfrog/domains/`. Wait strategies, stealth tier requirements, API endpoint maps, and cookie consent patterns — all learned automatically, all persisted locally.

## Command Center UX

This release also transforms Leapfrog from a headless tool into a visual command center for AI browser agents:

- **Auto Window Tiling** — Multiple headed sessions arrange themselves in a clean grid. Add or remove sessions, the grid reflows automatically. Grid and master-stack layouts.
- **Click Ripple + Scroll-to-Target** — Green ripple on agent clicks, scrollIntoView before each click so you see what the agent is about to interact with.
- **Smart Session Names** — Sessions auto-name from their first URL: `[github]`, `[hackernews]`, `[gmail]`. Reference sessions by name instead of cryptic IDs.
- **Human Intervention Alert** — When a session hits a captcha or login challenge, a red persistent top bar (32px) appears with reason text, the tab title changes to "NEEDS HUMAN", and a chime plays. Handle it, agent resumes.
- **Sidecar Control API** — HTTP endpoints to focus sessions, zoom in/out, restore the grid, take screenshots, or emergency-stop. Works with keyboard shortcuts, Alfred/Raycast, shell scripts.

## Additional Features

- **Pinned Sessions** — Mark sessions as pinned to prevent idle timeout. Stay logged into Gmail all day.
- **Auto Cookie Consent Dismiss** — OneTrust, CookieBot, TrustArc, and common frameworks handled automatically.
- **Session Recording + Tracing** — Full Playwright traces (DOM snapshots, screenshots, network) and video screencasts with annotated clicks. Time-travel debugging for browser sessions.
- **Sound + Notifications** — Warm marimba chime on intervention events. macOS notifications. One sound for the one thing that matters.

## Foundation

Built on v0.5.2's security hardening: SSRF protection (IPv4-mapped IPv6, redirect chains, `.internal` TLD), Gaussian click offsets, stale ref detection, 537+ tests across 20 suites.

## Install / Upgrade

```bash
npx leapfrog --doctor
```

```json
{
  "leapfrog": {
    "command": "npx",
    "args": ["-y", "leapfrog"]
  }
}
```

MIT licensed. Works with Claude Code, Cursor, Windsurf — anything that speaks MCP.
```

### npm Description Update (package.json one-liner)

```
"description": "Self-improving browser MCP for AI agents — learns per-domain intelligence, 15 parallel sessions, auto-tiling command center, stealth, persistent auth"
```

### CHANGELOG Entry for v0.6.0

```markdown
## [0.6.0] - 2026-04-XX

### Self-Improving Intelligence

- **Per-domain knowledge** — Leapfrog learns optimal settings for each website: wait strategies, stealth tier requirements, API endpoint maps, cookie consent patterns. Knowledge persists at `~/.leapfrog/domains/`.
- **Visit-over-visit improvement** — Visit #1: ~1,550 tokens (defaults). Visit #50: ~487 tokens (learned-optimal). Settings converge automatically.
- **Wait strategy learning** — Records which wait approach (network idle, DOM stable, element visible) works best for each domain and applies it on future visits.
- **Stealth tier learning** — Tracks which anti-detection patches are necessary per domain. Sites that don't check stealth get lighter treatment, reducing overhead.
- **API endpoint persistence** — Discovered API endpoints (from network intelligence) are stored and reused. Agents can hit APIs directly instead of scraping rendered pages.

### Command Center UX

- **Auto window tiling** — Headed sessions auto-arrange in grid or master-stack layout. Add/remove sessions, grid reflows. `LEAP_TILE=true`
- **Click ripple + scroll-to-target** — Green ripple on agent clicks, scrollIntoView before each click. `LEAP_HUD=true`
- **Smart session names** — Auto-name from first URL: `[github]`, `[hackernews]`. Reference by name in natural language.
- **Human intervention alert** — Red persistent top bar (32px, #ef4444) with reason text, tab title "NEEDS HUMAN", chime, and resume when captcha/login/challenge handled.
- **Sidecar control API** — HTTP server for session focus, zoom, grid restore, screenshots, emergency stop. `LEAP_SIDECAR_PORT=9222`

### New Features

- **Pinned sessions** — `pinned: true` on `session_create` prevents idle timeout. Session persists until explicit destroy.
- **Auto cookie consent dismiss** — OneTrust, CookieBot, TrustArc auto-accepted. `LEAP_AUTO_CONSENT=true`
- **Session recording** — Playwright trace export (DOM, screenshots, network timeline). `LEAP_TRACE=true`
- **Session screencast** — Video recording with auto-annotated agent clicks. `LEAP_RECORD=true`
- **Sound + notifications** — Warm marimba chime on intervention events. macOS notification center integration. `LEAP_SOUND=true`

### Testing

- 778 tests across 31 suites (up from 537/20 in v0.5.2)
```

### README Updates

The following sections need changes. Exact new copy provided.

**1. Header tagline (line 6)**

Current:
```
<p align="center"><strong>Multi-session browser MCP for AI agents.</strong><br/>31 tools. 15 parallel sessions. Stealth. Humanization. Up to 10x fewer tokens.</p>
```

Updated:
```
<p align="center"><strong>Self-improving browser MCP for AI agents.</strong><br/>Learns per-domain intelligence. 15 parallel sessions. Auto-tiling command center. Up to 10x fewer tokens.</p>
```

**2. "The Problem" section — add second paragraph after the existing content**

Add after the token comparison block:
```
## The Bigger Problem

Token savings help on visit #1. But what about visit #50?

Every other browser MCP starts from scratch every time. Same defaults. Same timeouts. Same full page scan. Whether it's the first visit or the thousandth.

Leapfrog learns. Each domain gets its own knowledge file at `~/.leapfrog/domains/`. Wait strategies, stealth requirements, API endpoints, cookie consent patterns — all recorded, all reused.

Visit #1 to github.com: ~1,550 tokens. Full defaults.
Visit #50 to github.com: ~487 tokens. Learned-optimal everything.

The tool improves itself. You configure nothing.
```

**3. Feature Matrix — add new rows**

Add after the existing table:
```
| Self-improving intelligence | Yes | No | No |
| Auto window tiling | Yes | No | No |
| HUD status overlay | Yes | No | No |
| Human intervention alerts | Yes | No | No |
| Click ripple visualization | Yes | No | No |
| Sidecar control API | Yes | No | No |
| Auto cookie consent dismiss | Yes | No | No |
```

**4. New section — add after Feature Matrix**

```
## Self-Improving Intelligence

Leapfrog remembers what works for each website.

```
~/.leapfrog/domains/
├── github.com.json        # wait: networkidle, stealth: minimal, apis: 3
├── hackernews.com.json     # wait: domstable, stealth: none, apis: 1
├── gmail.com.json          # wait: element, stealth: full, consent: auto
└── ...
```

| What It Learns | How | When Applied |
|---------------|-----|-------------|
| Wait strategy | Records which wait approach succeeds on each domain | Next visit uses the proven strategy |
| Stealth tier | Tracks which anti-detection patches are needed | Unnecessary patches skipped, reducing overhead |
| API endpoints | Stores discovered API routes from network intelligence | Agent can hit APIs directly instead of scraping |
| Cookie consent | Remembers the consent framework for each site | Instant dismissal without re-detection |
| Page structure | Caches selector patterns for common elements | Faster extraction on return visits |

Every visit makes the next visit faster, cheaper, and more reliable. Zero configuration. Zero maintenance.
```

**5. New section — add after Self-Improving Intelligence**

```
## Command Center

Run headed sessions with `LEAP_HEADLESS=false` and Leapfrog becomes a visual command center.

- **Auto-tiling** — Sessions arrange in a grid. Add or remove, the layout reflows.
- **Click ripple** — Green ripple on agent clicks. Scroll-to-target before each action.
- **Smart names** — `[github]` not `s_k3m7x1`. Sessions name themselves.
- **Intervention alerts** — Captcha? Login? A red top bar appears with the reason, tab title changes, chime plays. Handle it, back to the grid.
- **Sidecar API** — `curl localhost:9222/focus/github` from anywhere.
```

---

## 5. Launch Sequence Update

The Phase 1 sequence from GTM-PLAN.md is updated below. Changes from the original are marked with `[NEW]` or `[CHANGED]`.

### Day 4: Launch Day

**Hour 1: Publish (unchanged)**

```
npm publish --access public
npx leapfrog --version
npx leapfrog --doctor
```

**Hour 2: GitHub Public + Registries (unchanged process, updated listings)**

Same 6 registries, same awesome lists. But update all descriptions to lead with "Self-improving browser MCP" instead of "Multi-session browser MCP."

Registry one-liner:
> "Self-improving browser MCP for AI agents. Learns per-domain intelligence. 15 parallel sessions. Auto-tiling command center. Stealth. Up to 10x fewer tokens."

**Hour 3: Social Posts — Updated Stagger**

```
[CHANGED] 2:30 PM ET — Upload hero GIF (tiled command center) to Imgur/GitHub for embedding
[CHANGED] 3:00 PM ET — Reddit (5 subs instead of 4):
    1. r/ClaudeAI
    2. r/ClaudeCode
    3. r/mcp
    4. r/cursor
    5. r/LocalLLaMA  [NEW — self-improving + local-first is their sweet spot]

3:30 PM ET — Hacker News (unchanged timing)

4:00 PM ET — X/Twitter thread (unchanged timing, updated copy per Section 2)

[CHANGED] 4:15 PM ET — Post to r/MachineLearning [NEW — self-improving angle]

4:30 PM ET — Discord:
    1. MCP Discord
    2. Claude Discord
    3. Cursor Discord
    4. AI Engineer Discord (Latent Space)  [NEW]
```

**Hour 4: Monitor + Engage (unchanged)**

**[NEW] Hour 5: Targeted DMs (launch day Tier 1 only)**

After all public posts are live and accumulating early engagement:

1. DM the 13 Tier 1 individual targets from the existing list (updated pitch angles from Section 2)
2. DM the 4 new Tier 1 targets: Lilian Weng, Harrison Chase, Jim Fan, Andrej Karpathy
3. Every DM links to the Reddit post with early upvotes (social proof) — not just the GitHub repo

### Week 1 Follow-Up Additions

| Day | New Activity |
|-----|-------------|
| Day 5 | [NEW] Post "before/after" self-improving demo as a follow-up comment on the Reddit threads that got traction. Show the visit counter and token reduction. |
| Day 6 | [NEW] Reply to r/MachineLearning and r/LangChain threads about agent memory with the Leapfrog self-improving angle. Not a sales pitch — a genuine "here's one approach to tool-level memory." |
| Day 7 | [NEW] If any post gained significant traction, write a short X thread: "72 hours since launch. Here's what Leapfrog learned about 47 domains so far" with a screenshot of the `~/.leapfrog/domains/` directory listing. Real data, not hypothetical. |

### Week 2 Additions

Everything from GTM-PLAN.md Phase 3 still applies. Add:

| Activity | Why |
|----------|-----|
| Dev.to post: "How I Built a Self-Improving MCP Server" | The architecture is novel enough for a standalone technical post. Different angle from the "15 parallel sessions" post — targets the ML-curious dev audience. |
| Submit to Latent Space podcast pitch queue | swyx's audience is exactly the "AI infrastructure" crowd that cares about self-improving tools. |
| r/ExperiencedDevs post | "Tools that get better with use" resonates with senior engineers. Lower volume, higher quality audience. |

---

## 6. "Self-Improving" Demo Strategy

### The Core Problem

Self-improving intelligence is an invisible feature. You can't see "learning" in a screenshot. The improvement happens across visits over time. Every other feature in v0.6.0 — tiling, HUD, click ripple — is instantly visual. Self-improving is the most important feature and the hardest to show.

### Demo Option 1: Split-Screen Visit Counter (RECOMMENDED — Hero GIF)

**Format:** 15-30 second GIF or short video
**Structure:**

Left half: "Visit #1 to github.com"
- Full page scan animation
- Token counter: 1,550 tokens
- Wait time: 2.3s
- Config: "defaults"

Right half: "Visit #50 to github.com"
- Instant load, skip known patterns
- Token counter: 487 tokens
- Wait time: 0.8s
- Config: "learned-optimal"

Bottom text: "Same page. Same MCP server. 50 visits later."

**Why this works:** The split-screen makes the invisible visible. Numbers on both sides. The contrast is immediate. No narration needed.

**How to produce it:** Run two Leapfrog sessions side-by-side with headed browsers. One with a fresh `~/.leapfrog/domains/` directory (visit #1 behavior). One with a pre-trained domains directory (visit #50 behavior). Record both simultaneously with screen recording. The token counts and timing differences are real — no need to fabricate.

### Demo Option 2: Domains Directory Timelapse

**Format:** 10-second GIF
**Structure:**

Terminal showing `ls ~/.leapfrog/domains/` with a watch loop:
```
Visit 1:   (empty)
Visit 5:   github.com.json  hackernews.com.json
Visit 10:  + gmail.com.json  stackoverflow.com.json
Visit 25:  + npmjs.com.json  docs.python.org.json  reddit.com.json
Visit 50:  12 domains learned. Avg token reduction: 38%.
```

**Why this works:** Shows the knowledge accumulating as real files on disk. Developers understand local files. It's tangible — not a black box.

### Demo Option 3: Command Center Showcase (Supporting GIF — UX features)

**Format:** 20-30 second GIF
**Structure:**

1. Empty screen. Run `npx leapfrog` with headed mode.
2. 6 windows tile automatically. Each gets a colored border and name tag.
3. Agent clicks through pages. Scroll-to-target + ripple animations on each click.
4. One window hits a captcha. Red top bar appears. Tab title changes. Chime.
5. User clicks "Accept." Window shrinks back to grid.
6. All windows turn purple (complete).

**Why this works:** This is the visceral, emotional demo. Self-improving is the brain. The command center is the face. People share GIFs of things that look cool.

### Demo Option 4: Before/After Screenshot (Static — for social cards)

**Format:** PNG, 1200x630 (social card dimensions)
**Structure:**

```
┌──────────────────────────────────────────────┐
│  github.com — Before Leapfrog Learns         │
│  Wait: networkidle (2.3s)                    │
│  Stealth: full (14 patches)                  │
│  Tokens: 1,550                               │
│  API endpoints: unknown                      │
├──────────────────────────────────────────────┤
│  github.com — After 50 Visits                │
│  Wait: domstable (0.8s)  ← learned           │
│  Stealth: minimal (3 patches)  ← learned     │
│  Tokens: 487  ← 69% reduction                │
│  API endpoints: 3 cached  ← learned          │
└──────────────────────────────────────────────┘
```

**Why this works:** Static, scannable, shareable. Works as an X image, Reddit inline image, or README screenshot.

### Recommended Asset Priority for Launch

| Asset | Format | Where It Goes | Priority |
|-------|--------|---------------|----------|
| Split-screen visit counter | GIF (15-30s) | X main tweet, Reddit inline, README, registry listings | P0 — THE hero asset |
| Command center showcase | GIF (20-30s) | X Reply 2, Reddit body, GitHub README, Product Hunt | P0 — the visual hook |
| Before/after screenshot | PNG | Social card, OG image, static fallback for all channels | P1 |
| Domains directory timelapse | GIF (10s) | Dev.to post, HN comment reply, GitHub release page | P2 |

---

## 7. Risk Assessment

### Risk 1: "Self-Improving" Claim Backlash

**Likelihood:** Medium
**Impact:** Medium — could undermine credibility on HN and r/MachineLearning

**The risk:** "Self-improving" triggers skepticism. On HN and ML communities, people associate it with AGI hype, LLM fine-tuning, or vaporware claims. Someone will reply: "What's actually 'self-improving' about this? It's just caching."

**Mitigation:**

1. **Never use "self-improving" without immediately explaining the mechanism.** Don't say "self-improving AI." Say "per-domain learning — it records which wait strategy, stealth tier, and API endpoints work for each site and reuses them." Mechanism kills skepticism.

2. **Acknowledge the simplicity.** In HN and technical contexts, proactively say: "The self-improvement is straightforward: per-domain JSON files that record what works. No ML, no fine-tuning, no neural anything. Just structured observation and replay. The power is in the accumulation over time." This is honest and disarms the "overhyped" objection.

3. **Show the data format.** When someone asks "how does it learn?" — show the actual JSON from `~/.leapfrog/domains/github.com.json`. Transparency = credibility.

4. **Use "self-improving" in casual channels (X, Reddit, Discord). Use "per-domain learning" or "adaptive intelligence" in technical channels (HN, r/MachineLearning, Dev.to).** Match the language to the audience's tolerance for marketing-speak.

### Risk 2: Feature Scope vs. Launch Timing

**Likelihood:** Medium-high
**Impact:** High — v0.6.0 has 11 new feature areas. Shipping all of them bug-free is ambitious.

**The risk:** v0.6.0 is a much larger release than v0.5.2. Auto-tiling, HUD, intervention system, sidecar API, sounds, cookie consent, tracing, recording, self-improving intelligence — that's a lot of surface area for bugs. A launch-day bug in the tiling system or the intervention overlay could overshadow the self-improving story.

**Mitigation:**

1. **Define "shippable" vs. "polished."** Not every feature needs to be perfect. Auto-tiling, HUD, and self-improving intelligence are the three that MUST work flawlessly — they're in the demo. Sidecar API, recording, and sounds can be "works but rough edges." Cookie consent can miss some frameworks.

2. **Gate features behind env vars.** Everything in v0.6.0 is already opt-in (`LEAP_HUD=true`, `LEAP_TILE=true`, etc.). This means a bug in the HUD doesn't affect headless users. The default experience is still the v0.5.2 core (multi-session, stealth, tokens) which is battle-tested with 778 tests.

3. **If launch timing slips, don't wait for perfection.** The self-improving intelligence and one visual feature (tiling or HUD) is enough for a differentiated launch. Ship the rest as v0.6.1/v0.6.2 fast-follow.

4. **Pre-launch: test the demo sequence end-to-end.** Run the exact 7-step demo from WHATS-NEW-v060.md on a clean machine. If it works, ship. If any step breaks, fix that one thing.

### Risk 3: Competitive Responses in the "Learning Browser" Space

**Likelihood:** Low-medium (6-12 months)
**Impact:** Medium

**The risk:** Once Leapfrog ships per-domain learning publicly, the idea is visible. Playwright MCP, browser-use, or Stagehand could add similar functionality. browser-use with 81K stars adding "domain memory" would overshadow Leapfrog's version.

**Mitigation:**

1. **First-mover advantage in implementation, not just idea.** The idea of "browser tools that learn" is obvious in retrospect. The advantage is in the accumulated domain data from real users. If someone installs Leapfrog today and builds 50 domain profiles, they're not switching when a competitor ships v1 of the same feature.

2. **The knowledge format is the moat, not the learning mechanism.** Design the `~/.leapfrog/domains/` JSON format to be portable, inspectable, and shareable. If users can export/import domain profiles, a community library of pre-trained domains becomes possible. That's a network effect competitors can't bootstrap overnight.

3. **Keep shipping.** The self-improving loop is now closed -- learned data feeds into navigation decisions. The next tier -- cross-domain pattern transfer, community-shared domain profiles, anomaly detection -- creates compounding advantages.

### Risk 4: "It's Just Caching" Dismissal

**Likelihood:** High on HN, medium elsewhere
**Impact:** Low-medium — it's a valid criticism that needs a good answer

**The risk:** Technical audiences will correctly identify that per-domain learning is, at its core, caching. "You store what works and replay it. That's a cache, not intelligence." This is accurate and dismissive at the same time.

**Mitigation:**

The prepared response (use in HN comments, technical discussions):

> "Fair point. The mechanism is simple: observe what works, store it, replay it. You could call it caching. The difference from a traditional cache is that it learns across multiple dimensions simultaneously (wait strategy, stealth tier, API endpoints, consent patterns) and the optimal configuration isn't known in advance — it's discovered through use. A cache stores the answer. This stores the approach. But I take the point — we're not claiming ML here. It's structured observation with automatic replay."

This answer is honest, specific, and turns the criticism into a feature ("we're not claiming ML" is a trust signal).

### Risk 5: Privacy Concerns About Domain Tracking

**Likelihood:** Low-medium
**Impact:** Medium — could become a blocker for enterprise/privacy-conscious users

**The risk:** `~/.leapfrog/domains/` stores a list of every website the user has visited through Leapfrog, along with behavioral data about those visits. Someone will raise privacy concerns: "It's tracking my browsing history."

**Mitigation:**

1. **All data is local.** No telemetry, no cloud sync, no phone-home. The domain files live on the user's machine, readable with `cat`. This is in the README and SECURITY.md.

2. **Opt-out is trivial.** `LEAP_LEARN=false` disables per-domain learning entirely. Or just delete `~/.leapfrog/domains/`. The data is plain JSON — inspectable, deletable, no hidden state.

3. **Preempt in the README.** Add a short note: "Domain knowledge is stored locally at `~/.leapfrog/domains/`. No data leaves your machine. Delete the directory at any time to reset. Set `LEAP_LEARN=false` to disable learning entirely."

### Risk 6: npm Name Squatting (unchanged from v0.5.2 plan)

Same risk and mitigation. Verify `leapfrog` is still available before publish day.

---

## Appendix: Updated Competitive Landscape

| Tool | Stars | Weekly DLs | Self-Improving? | Parallel Sessions | Command Center UX |
|------|-------|------------|-----------------|-------------------|-------------------|
| **Leapfrog** | (new) | (new) | Yes — per-domain learning | 15 isolated | Auto-tile, HUD, intervention, sidecar |
| **Playwright MCP** | ~15K | ~50K | No | 1 | No |
| **agent-browser** | ~2K | ~8K | No | 1 | No |
| **browser-use** | ~81K | ~100K | No | Limited | No |
| **Stagehand** | ~12K | ~20K | No | Cloud-managed | Browserbase dashboard |
| **Computer Use** | N/A | N/A | No | N/A | No |

**Updated moat statement:** Leapfrog is the only browser MCP that gets smarter with use. Per-domain learning, 15 isolated parallel sessions, and a tiled command center with intervention alerts — shipped together, open source, local-first.

---

## Appendix: Quick Reference — What Changed from GTM-PLAN.md

| Element | v0.5.2 Plan | v0.6.0 Addendum |
|---------|-------------|-----------------|
| Launch version | v0.5.2 | v0.6.0 (skip 0.5.2 public release) |
| Lead message | Multi-session isolation | Multi-session + self-improving intelligence |
| Hero asset | Terminal GIF (token comparison) | Split-screen visit counter GIF + command center GIF |
| Reddit subs (Day 1) | 4 (ClaudeAI, ClaudeCode, mcp, cursor) | 5 (+ r/LocalLLaMA) |
| Discord (Day 1) | 3 servers | 4 servers (+ AI Engineer) |
| New outreach targets | 37 total | 45 total (+8 in self-improving/adaptive systems space) |
| Tier 1 DM targets | 13 | 17 (+4 self-improving angle) |
| npm description | "Multi-session browser MCP..." | "Self-improving browser MCP..." |
| Registry one-liner | Multi-session, tokens, stealth | Self-improving, multi-session, command center |
| Technical blog angle | "Up to 10x fewer tokens" | "How I Built a Self-Improving MCP Server" |
| Risk profile | +1 new risk (scope), +1 new risk (claim backlash), +1 new risk (privacy) |
