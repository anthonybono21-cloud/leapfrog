# Leapfrog v0.6.1 Social Copy — Self-Improving Intelligence

**Voice:** Don Draper
**Companion to:** SOCIAL-COPY-v2.md (v0.5.2 multi-session launch)
**Rule:** Self-improving intelligence is ALWAYS the v0.6.1 lead. Multi-session isolation is the foundation — present but not headline. Token savings is proof the self-improvement works, not the story.
**Version:** v0.6.1 | Self-improving per-domain intelligence | Auto window tiling | Click ripple + scroll-to-target | Intervention top bar | Sidecar API | Session recording

---

## 1. X/TWITTER — v0.6.1 ANNOUNCEMENT THREAD

**Account:** @Leapfrog_MCP
**Format:** 1 main tweet + 6 self-replies, all published simultaneously via Typefully.
**NO links in main tweet. Links in Reply 5 only.**

### Main Tweet (must work alone — this IS the v0.6.1 pitch)

```
The first time Leapfrog visits a site, it does everything from scratch.

Full page scan. Default stealth. Cookie dismissal. ~1,550 tokens.

The 50th time? It already knows the wait strategy, the API endpoints, the right stealth tier.

~487 tokens. No configuration. It learned.

v0.6.1 is live.

[hero video — side-by-side Visit 1 vs Visit 50]
```

### Reply 1 — What "Self-Improving" Actually Means

```
Here's what happens under the hood:

Visit 1: Leapfrog treats every site like a stranger. Full scan, default everything.

Visit 10: It knows the cookie consent pattern. Dismisses it instantly.

Visit 25: It's found the API endpoints. Skips the DOM entirely when it can.

Visit 50: Optimal stealth tier. Known wait strategy. Fastest possible path.

Every visit makes the next one faster, cheaper, and more reliable.

That's not a setting you configure. It's a flywheel.
```

### Reply 2 — How It Works Technically

```
Per-domain knowledge stored at ~/.leapfrog/domains/

Each domain gets its own learned profile:
→ Wait strategy (did networkidle work? Did we need a selector?)
→ Stealth tier (does this site even check? How aggressively?)
→ API endpoints discovered via network intercept
→ Cookie consent patterns and dismissal scripts

It's not a cache. It's institutional memory.

Your agent visits Hacker News 50 times this week? Visit 51 is instant.

New site? Clean slate. Learns from zero. Same cycle starts again.
```

### Reply 3 — The Other v0.6.1 Features (the visual stuff)

```
Self-improving intelligence is the headline. But v0.6.1 also ships:

→ Auto window tiling — sessions arrange themselves on screen
→ Click ripple + scroll-to-target — see exactly what your agent is doing
→ Red top bar intervention alert — the frog tells you when it needs a human
→ Smart session names — "github-pr-review" not "session_3"
→ Pinned sessions that survive cleanup
→ Session recording and tracing
→ Sound notifications when tasks complete

Your agents have a workspace now. Not just a browser.
```

### Reply 4 — Multi-Session Foundation (for new followers)

```
If you're new here:

Two agents. One browser. They're fighting.

That's why Leapfrog exists. 15 isolated browser sessions from one MCP server. Each with its own cookies, storage, and fingerprint. They never touch each other.

v0.5.2 solved the isolation problem.

v0.6.1 means those 15 sessions get smarter every time they run.

Same foundation. New intelligence layer on top.
```

### Reply 5 — Links + Install Config

```
Works with Claude Code, Cursor, Windsurf — anything that speaks MCP.

npx leapfrog --doctor

MCP config:
{
  "leapfrog": {
    "command": "npx",
    "args": ["-y", "leapfrog"]
  }
}

GitHub: github.com/anthropics/leapfrog
npm: npmjs.com/package/leapfrog
MIT licensed. Zero cloud. Zero API keys.

Upgrade from v0.5.2: your domains/ folder starts empty. It fills itself.
```

### Reply 6 — The "It Learns" Closer

```
The best tools disappear into the work.

You don't configure Leapfrog's per-domain knowledge. You don't maintain it. You don't even think about it.

You just notice that the thing that took 4 seconds last week takes 1 second this week.

And the context window your agent used to burn on page scans? It's thinking now.

@..@
```

---

## 2. REDDIT — r/ClaudeAI, r/ClaudeCode, r/mcp

**Title:**
```
Leapfrog v0.6.1: your browser MCP now learns every site it visits. Here's what that means.
```

**Body:**
```
Some of you have been using Leapfrog since v0.5.2 — the multi-session browser MCP
that runs 15 isolated sessions in parallel. That foundation hasn't changed. Still 15
sessions. Still fully isolated. Still local.

v0.6.1 adds a layer on top: **self-improving per-domain intelligence.**

**What that actually means (no hype):**

The first time Leapfrog visits a site, it does everything from scratch:
- Full page scan with default settings
- Default stealth configuration
- Standard wait strategy
- Cookie consent handling via generic patterns
- Result: ~1,550 tokens per page

By the 50th visit to that same domain, Leapfrog has learned:
- The optimal wait strategy (networkidle vs selector vs timeout)
- Whether the site checks for bots, and how aggressively
- API endpoints discovered via network intercept
- The exact cookie consent pattern and how to dismiss it instantly
- Result: ~487 tokens per page

That's a 68% token reduction with zero configuration. The knowledge lives at
`~/.leapfrog/domains/` — one profile per domain, updated automatically.

**What "self-improving" does NOT mean:**

This is not AGI. It's not reasoning about your intent. It's per-domain configuration
learning. Leapfrog remembers what worked for each site and applies it next time.
Think of it as muscle memory, not intelligence. But "muscle memory" doesn't fit
in a tweet.

**The flywheel:**

Every visit teaches Leapfrog something. Wait strategy that timed out? It tries a
different one next time. Stealth tier that was overkill? It drops a level. API
endpoint that returns the data faster than DOM scraping? It goes straight there.

Over time, your most-visited sites become nearly instant. New sites start from
scratch and learn at the same pace.

**Other v0.6.1 features (UX polish):**

- Auto window tiling — sessions tile themselves across your screen
- Click ripple + scroll-to-target — watch what your agent does in real time
- Red top bar intervention alert — tells you when a human is needed
- Smart session names, pinned sessions, session recording
- Sidecar control API for external tooling
- Auto-dismiss cookie consent (part of the learning system)
- Sound notifications

**The honest take:**

v0.5.2 solved the "two agents, one browser" problem. v0.6.1 makes sure those
sessions don't repeat the same work. If your agents visit the same 20 sites
every day, this update pays for itself in the first hour.

**Quick start / upgrade:**

```json
{
  "leapfrog": {
    "command": "npx",
    "args": ["-y", "leapfrog"]
  }
}
```

If you're upgrading from v0.5.2, the `~/.leapfrog/domains/` folder starts empty.
It populates itself. There's nothing to configure.

GitHub: [link]
npm: [link]
MIT licensed.

Happy to answer questions about the learning system internals.
```

---

## 3. HACKER NEWS — "Show HN" Update Post

**Title:**
```
Leapfrog v0.6.1 – Browser MCP server that learns per-domain optimal paths
```

**Body:**
```
Leapfrog is an MCP server for browser automation with AI coding agents (Claude Code,
Cursor, Windsurf). v0.5.2 shipped multi-session isolation — 15 parallel BrowserContexts
in one Chromium process. v0.6.1 adds per-domain knowledge accumulation.

The problem it solves: on first visit to any site, the agent has to do a full page
snapshot, use default wait strategies, apply generic stealth settings, and handle
cookie consent generically. This costs ~1,550 tokens and takes the longest possible
path. By the Nth visit, optimal settings are known — but without persistence, the
agent pays the first-visit cost every time.

Architecture of the learning system:

1. Per-domain knowledge storage at ~/.leapfrog/domains/{domain}.json

2. What it learns per domain:
   - Wait strategy: networkidle vs specific selector vs fixed timeout, with
     success/failure tracking. If networkidle times out 3x, it switches to
     selector-based waits and records which selector works.
   - Stealth tier: Sites that don't check for bots get minimal stealth (faster
     launch). Sites running Cloudflare or DataDome get full patches. The tier
     is learned by observing detection events and adjusting.
   - API endpoint persistence: When network intercept discovers REST/GraphQL
     endpoints that return the data the agent needs, those endpoints are stored.
     Subsequent visits can skip DOM scraping entirely and hit the API.
   - Cookie consent patterns: The specific selector + action that dismisses the
     consent dialog, stored after first successful dismissal.

3. Learning mechanics:
   - Observations accumulate per visit (wait strategy result, stealth outcome,
     discovered endpoints, consent handling)
   - After N visits (configurable, default 5), the profile "stabilizes" — settings
     are applied automatically without re-testing
   - Profiles are human-readable JSON. You can inspect, edit, or delete them.
   - New domains start clean. No cross-domain inference (intentional — domains
     behave too differently)

4. Token impact:
   - Visit 1 (default everything): ~1,550 tokens
   - Visit 50 (optimized): ~487 tokens
   - The reduction comes from: skipping unnecessary stealth setup, using known
     wait strategies (no retry loops), hitting APIs directly, instant cookie
     dismissal

What it does NOT learn:
- Page content or user data (no scraping memory)
- Authentication credentials (auth profiles are a separate, explicit feature)
- Cross-domain patterns (each domain is independent)
- Anything that requires reasoning (it's pattern matching, not inference)

Other v0.6.1 changes: auto window tiling, click ripple + scroll-to-target,
@..@ human intervention alerts, click visualization, sidecar control API,
session recording/tracing.

Still: 15 parallel isolated sessions, 34 tools, SSRF hardened, 3 runtime deps
(Playwright, MCP SDK, Zod). TypeScript. MIT.

npx leapfrog --doctor

GitHub: [link]
```

---

## 4. DISCORD (Claude + Cursor + MCP)

```
**Leapfrog v0.6.1** — your browser MCP now learns every site it visits.

Visit 1: full scan, default everything, ~1,550 tokens.
Visit 50: known endpoints, instant cookie dismissal, optimal stealth, ~487 tokens.

Per-domain knowledge stored at ~/.leapfrog/domains/. No configuration. It fills itself.

Also ships: auto window tiling, click ripple + scroll-to-target, intervention alerts, session recording.

Still 15 parallel isolated sessions. Still local. Still MIT.

```json
{
  "leapfrog": {
    "command": "npx",
    "args": ["-y", "leapfrog"]
  }
}
```

`npx leapfrog --doctor` to verify.

GitHub: [link] | npm: [link]
```

---

## 5. DEV.TO ARTICLE OUTLINE

**Title:**
```
Your Browser MCP Just Got a Memory: How Leapfrog v0.6.1 Learns Your Sites
```

**Outline:**

### Section 1: The Repeated Work Problem
- Every time an AI agent visits a site, it starts from zero
- Same cookie consent. Same wait strategy. Same stealth settings. Same token cost.
- Over a week of development, your agents visit the same 15-20 sites hundreds of times
- Each visit pays the full first-visit tax
- Concrete example: GitHub PR review workflow — 50 visits/day, each one doing discovery from scratch

### Section 2: What If Your Browser Remembered?
- Introduce the v0.6.1 self-improving concept
- The visit counter narrative: Visit 1 vs Visit 10 vs Visit 25 vs Visit 50
- Token cost progression: ~1,550 → ~1,100 → ~700 → ~487
- The flywheel mental model: every visit teaches the next one

### Section 3: How Per-Domain Knowledge Works
- ~/.leapfrog/domains/ directory structure
- Per-domain JSON profiles (show example structure)
- Four learning dimensions:
  - Wait strategy learning (networkidle vs selector vs timeout)
  - Stealth tier adaptation (minimal vs standard vs full)
  - API endpoint persistence (skip DOM, hit the API directly)
  - Cookie consent patterns (one-shot dismissal after learning)
- Stabilization threshold: after N visits, the profile locks in
- Human-readable, editable, deletable

### Section 4: The Architecture
- How observations are collected per visit
- The decision tree: when to apply learned settings vs re-test
- Why no cross-domain learning (intentional isolation)
- What it does NOT learn (content, credentials, user intent)
- Storage format and file permissions

### Section 5: What This Means for Token Budgets
- Real numbers from internal testing
- Side-by-side: first visit vs optimized visit on 5 common sites
- Compound savings over a week of development
- The broader point: tokens saved on page scans are tokens available for reasoning

### Section 6: The Rest of v0.6.1
- Auto window tiling and smart session names
- Click ripple + scroll-to-target
- Red top bar intervention alert (when the frog needs a human)
- Session recording and tracing
- Sidecar control API

### Section 7: Getting Started
- Install config (JSON snippet)
- npx leapfrog --doctor
- Upgrading from v0.5.2 (domains/ starts empty, populates automatically)
- Inspecting your domain profiles after a few days of use

### Closing: Tools Should Disappear Into the Work
- The best infrastructure is invisible
- You notice the improvement, not the mechanism
- Your agents get faster without you doing anything
- Link to GitHub, npm, MIT license

---

## 6. PRODUCT HUNT

**Tagline:**
```
Your browser MCP gets smarter every time it visits a site.
```

**Description:**
```
Leapfrog is an open-source MCP server that gives AI coding agents browser automation.
15 isolated sessions in parallel. Now with self-improving per-domain intelligence.

The first time Leapfrog visits a site: full scan, default settings, ~1,550 tokens.
By the 50th visit: known API endpoints, instant cookie dismissal, optimal stealth
tier, right wait strategy — ~487 tokens. No configuration required.

What's new in v0.6.1:

• Self-improving per-domain intelligence — learns wait strategies, stealth tiers,
  API endpoints, and cookie consent patterns for every domain
• Per-domain knowledge stored at ~/.leapfrog/domains/ — human-readable JSON
• Auto window tiling — sessions arrange themselves on screen
• Click ripple + scroll-to-target — see what your agent does in real time
• Red top bar intervention alerts — the frog tells you when it needs a human
• Smart session names — "github-pr-review" not "session_3"
• Session recording and tracing
• Sidecar control API for external tooling
• Sound notifications

Still ships:

• 15 parallel isolated browser sessions
• Network intelligence (capture, filter, mock, block HTTP)
• 14 anti-detection patches
• Auth profiles that persist across sessions
• Crash recovery with auto-cleanup
• Up to 10x fewer tokens than Playwright MCP
• 34 tools, 778 tests across 31 suites, MIT license
• Zero cloud dependencies — entirely local

Built because two AI agents fighting over one browser is not a workflow. It's a queue.
And agents that forget everything between visits aren't learning. They're looping.

One install: npx leapfrog
```

---

## 7. CONTENT CALENDAR — "v0.6.1 Launch" Cycle

**Insert as Cycle 0 — before the Matrix cycle (Cycle 1).**
**Duration:** 2 weeks. Pure v0.6.1 feature showcase.

### Week 1: The Intelligence Story

| Day | Platform | Content | Type | Link? |
|-----|----------|---------|------|-------|
| **Day 1** | X (thread) | Full v0.6.1 announcement thread (Section 1 above) | Product launch | Reply 5 only |
| **Day 1** | Reddit | r/ClaudeAI + r/ClaudeCode + r/mcp posts (Section 2 above) | Product launch | In post |
| **Day 1** | Discord | Brief announcement (Section 4 above) | Product launch | In post |
| **Day 1** | HN | Show HN post (Section 3 above) | Product launch | In post |
| **Day 2** | X | Visit counter GIF: animated counter showing Visit 1 → Visit 50 with token cost dropping. Caption: `Visit 1: 1,550 tokens. Visit 50: 487. Same site. It learned.` | Demo | No |
| **Day 3** | X | Screenshot of `~/.leapfrog/domains/` folder with 10+ domain profiles. Caption: `Your browser's memory. One file per domain. It fills itself.` | Technical proof | No |
| **Day 4** | X | Expanding Brain frog meme (Section 8 below) | Meme | No |
| **Day 5** | X | Side-by-side screen recording: left = Visit 1 (slow, full scan), right = Visit 50 (fast, direct). Caption: `Same page. Different visit count. That's the whole pitch.` | Demo | Self-reply link |
| **Day 6** | Dev.to | Publish full article (Section 5 outline) | Long-form | In article |
| **Day 7** | X | "What it learns" infographic: four boxes (wait strategy, stealth tier, API endpoints, cookie consent) with before/after states. Caption: `Four things. Every domain. Automatic.` | Infographic | No |

### Week 2: The UX Reveal + Bridge to Matrix

| Day | Platform | Content | Type | Link? |
|-----|----------|---------|------|-------|
| **Day 8** | X | Auto window tiling demo video: 6 sessions arranging themselves on screen. Caption: `Your agents have a workspace now.` | UX reveal | No |
| **Day 9** | X | @..@ intervention alert screenshot: frog eyes staring from the HUD. Caption: `When the frog stares at you, it needs a human. You'll know.` | UX reveal | No |
| **Day 10** | X | Click ripple + scroll-to-target demo: watch the agent navigate a page. The page scrolls to each target, then a green ripple on click. Caption: `Now you can see what your agent sees.` | UX reveal | No |
| **Day 11** | X | Intervention top bar demo: agent hits a CAPTCHA, red 32px bar appears at top, tab title changes. Caption: `When the frog needs you, you'll know.` | UX reveal | Self-reply link |
| **Day 12** | X | Benchmark update post: v0.5.2 vs v0.6.1 token comparison on same sites (first visit vs optimized visit). Caption: `Same tool. Same sites. 68% fewer tokens after a week of use.` | Benchmark | Self-reply link |
| **Day 13** | X | Session recording teaser: a 15-second replay of an agent completing a task. Caption: `Every session. Recorded. Replayable. Debug anything.` | UX reveal | No |
| **Day 14** | X | Bridge post to Matrix cycle: frog in the Construct (white room). Caption: `It's learning. And next week, it enters the Matrix.` + link to Cycle 1 Day 1 | Brand / Bridge | No |

### Posting Rules for Cycle 0

1. **Days 1-5 are intelligence-focused.** Self-improving is the only story.
2. **Days 8-13 are UX-focused.** Visual features that make the intelligence tangible.
3. **Day 7 and Day 12 are benchmark days.** Numbers ground the narrative.
4. **Day 4 is meme day.** The Expanding Brain frog breaks up the product posts.
5. **Day 14 bridges to Cycle 1 (Matrix).** The frog has learned enough to enter the Matrix.
6. **No links in brand/meme posts.** Links only in self-replies on demo and benchmark posts.
7. **Product Hunt submission on Day 1 or Day 6** (coordinate with Dev.to article for maximum coverage).

---

## 8. THE "EXPANDING BRAIN" MEME POST

**Platform:** X, Reddit (r/ProgrammerHumor crosspost potential)
**Format:** Expanding brain meme — 5 levels. Frog appears at Level 5.

### Level 1 — Small Brain
```
Opening Chrome DevTools to check if
your selector works
```

### Level 2 — Medium Brain
```
Writing a Puppeteer script that breaks
every time the site updates
```

### Level 3 — Glowing Brain
```
Using Playwright MCP and burning 14,000
tokens per page to read a table
```

### Level 4 — Galaxy Brain
```
Running 15 isolated browser sessions in
parallel from one MCP server
```

### Level 5 — Cosmic Frog (@..@ eyes, transcendent)
```
Your browser MCP remembers every site it's
ever visited and gets faster on its own
```

**Alt caption for X post:**
```
The five stages of browser automation grief.

We're at stage 5 now.

@..@
```

**Alt caption for Reddit crosspost:**
```
The five stages of browser automation [OC]
```

---

## COPY RULES (for all v0.6.1 content)

1. **Self-improving intelligence is always the first thing mentioned.** Before UX, before tiling, before tokens.
2. **Multi-session isolation is the foundation** — present in every channel, but as context, not headline.
3. **The visit counter narrative (Visit 1 → Visit 50) is the core proof point.** Use it everywhere.
4. **Token reduction is evidence** that self-improvement works. It's not the pitch.
5. **"Per-domain knowledge" is the technical term.** Use it for HN and Dev.to. Use "it learns" for X and Discord.
6. **Honest about scope:** this is configuration learning, not reasoning. Say it plainly in Reddit and HN.
7. **Origin story still appears** for new audiences: "Two agents. One browser. They're fighting."
8. **~/.leapfrog/domains/ is the proof.** It's a real folder. Show it. Screenshot it. It's tangible.
9. **No links in X main tweet or brand posts.** Links in Reply 5 and self-replies only.
10. **Banned words:** revolutionary, game-changing, magic, seamless, leverage, synergy, AI-powered, robust, scalable, next-gen.
11. **v0.6.1 copy is a companion to v0.5.2 copy** — same voice, new story layer. Don't replace, extend.
