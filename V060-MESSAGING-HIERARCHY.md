# Leapfrog v0.6.0 — Messaging Hierarchy & Positioning

**Status:** Locked. Source of truth for all v0.6.0 marketing.
**Date:** April 4, 2026
**Author:** Strategy & Messaging Agent (Don voice)
**Supersedes:** DON-COPY-PACKAGE.md (v0.5.x copy), GTM-PLAN.md Section 3 social copy

---

## 1. Positioning Statement

Leapfrog v0.6.0 is the first browser MCP server that gets smarter every time your agent uses it. It remembers which wait strategy works on each site, which stealth level each domain requires, which API endpoints return the data your agent actually needs -- and it applies that knowledge automatically on the next visit. Visit one costs ~1,550 tokens. Visit fifty costs ~487. No ML infrastructure. No cloud. Just a local Node.js process that learns from its own experience, while running 15 isolated browser sessions in parallel with full network intelligence and stealth. Open source. MIT. One `npx` install.

---

## 2. Message Hierarchy

### Level 1: The Hook -- Self-Improving Intelligence

This is the v0.6.0 headline. Every piece of content opens here.

**The core claim:** Leapfrog learns from every visit. Per-domain knowledge accumulates at `~/.leapfrog/domains/` -- wait strategies, stealth tiers, API endpoints, cookie dismissal patterns. Visit #1 is default everything. Visit #50 is optimized everything. 40% fewer tokens on revisited sites, automatic cookie consent dismissal, zero configuration.

**The emotional pitch:** Your browser automation tool should be at least as smart as your browser's autocomplete. Leapfrog is.

**Key stats for this level:**
- ~1,550 tokens (visit #1) to ~487 tokens (visit #50) -- 40% reduction through learning alone
- Per-domain knowledge stored locally at `~/.leapfrog/domains/`
- Wait strategy learning (knows github.com loads fast, dashboard.stripe.com needs networkidle)
- Stealth tier learning (remembers which sites need full stealth, which need basic patches)
- API endpoint persistence (discovered routes survive across sessions)
- Auto-dismiss cookie consent (OneTrust, CookieBot, TrustArc -- learns new patterns)

**Why this leads:** "Self-improving" is the term Claude Code power users understand and want. Every AI-adjacent developer has thought about agents that learn. Most "self-improving" claims are vapor. Leapfrog's is a JSON file you can open and read. The mechanism is legible. The improvement is measurable. That combination -- buzzy term, concrete delivery -- is rare and powerful.

---

### Level 2: The Foundation -- Multi-Session Isolation

This carried from v0.5.2 and remains the structural differentiator. No other browser MCP ships this.

**The core claim:** 15 parallel isolated browser sessions. Separate cookies, storage, fingerprints. One agent logs into Gmail while another scrapes pricing while a third monitors a deploy. They never leak into each other.

**The origin story:** "Two agents. One browser. They're fighting. Someone has to wait." This is why Leapfrog exists. This emotional hook still opens cold outreach, origin-story content, and any context where the audience doesn't already know the product.

**Key stats for this level:**
- 15 parallel BrowserContext instances, one Chromium process
- Full cookie/localStorage/cache isolation per session
- 19MB RSS per session, 52MB peak heap under stress
- 0.3ms tab switches
- Crash recovery with auto-cleanup (no zombie sessions)
- Auth profile persistence (login once, reuse forever)

**Hierarchy note:** In v0.5.2 copy, multi-session was Level 1. In v0.6.0, it drops to Level 2 -- still the foundation, but the *new news* is self-improvement. Multi-session is now the "and it does all this across 15 parallel sessions" reinforcement.

---

### Level 3: The Proof -- The Command Center

The UX features prove Leapfrog is a serious tool, not a weekend hack. They're not the headline. They're the moment the reader thinks "oh, this person thought of everything."

**Features in this tier (show, don't lead with):**
- **Auto window tiling** -- mission control grid, every session visible at once
- **Smart session names** -- auto-named from domain, not `s_k3m7x1`
- **Click ripple + scroll-to-target** -- see exactly what the agent is doing in real time; page scrolls to target before each click
- **Human intervention alert** -- red persistent top bar (32px, #ef4444) with reason text, tab title "NEEDS HUMAN", warm marimba chime when the agent needs you (CAPTCHA, login, verification)
- **Sidecar control API** -- remote control for windows via localhost HTTP
- **Pinned sessions** -- stay alive across idle timeouts
- **Session recording & tracing** -- flight recorder for debugging and replay

**How to use this tier:** Screenshots. GIFs. Short video clips. These features are visual -- they sell on sight, not in bullet points. The tiling grid with click ripples and scroll-to-target across 6 simultaneous sessions is the "stop the scroll" asset.

---

### Level 4: The Closer -- Open Source, Zero Cloud, MIT

This is the trust layer. It answers the unspoken questions: "What's the catch? Where's the cloud bill? Who owns my data?"

**Key points:**
- MIT license. Fork it, modify it, sell it, whatever.
- Zero cloud dependencies. Everything runs on your machine.
- Zero telemetry. No phone-home, no analytics, no tracking.
- All learned knowledge stored locally at `~/.leapfrog/`. You can inspect, export, or delete it.
- 778 tests across 31 suites. SSRF hardened. Security audited.
- 3 runtime dependencies (Playwright, MCP SDK, Zod). That's it.

**When to deploy this level:** End of any pitch. End of any thread. The last thing the reader sees before deciding to install. "Oh, and it's MIT with zero cloud. What's stopping you?"

---

## 3. The v0.6.0 Story Arc

### v0.5.2 Story (where we've been):
"AI agents can't share a browser. Leapfrog gives each one its own -- 15 isolated sessions, up to 10x fewer tokens, full stealth and network intelligence. The multi-session browser MCP that nobody else ships."

### The Bridge Sentence:
**"v0.5.2 gave your agents their own browsers. v0.6.0 teaches those browsers to remember."**

### v0.6.0 Story (where we're going):
"Leapfrog doesn't just run browsers for your agents -- it learns from every visit. Per-domain intelligence accumulates automatically: optimal wait strategies, stealth requirements, API endpoints, cookie dismissal patterns. Visit #1 is raw. Visit #50 is surgical. And while your agents are getting smarter, they're working inside a command center with auto-tiling, click ripple, scroll-to-target, and a warm chime when something needs your attention. All local. All open source. All learning."

### The Narrative Flow:
1. **Cold open:** The origin story ("two agents, one browser, fighting") -- establishes the problem
2. **v0.5.2 resolution:** Multi-session isolation solved it -- 15 browsers, token efficiency, stealth
3. **The bridge:** "But we kept watching the agents work. And we noticed something."
4. **The insight:** They visit the same sites over and over. They learn nothing between visits. Every github.com is treated like the first github.com.
5. **v0.6.0 resolution:** Now it learns. Per-domain knowledge. The flywheel. Visit #1 to visit #50.
6. **The proof:** Show the command center -- tiling, HUD, cursors, intervention alerts
7. **The close:** Open source, zero cloud, MIT. `npx leapfrog`

---

## 4. Tagline Candidates

All center on self-improvement/learning. Ranked by strength.

1. **"Your browser learns. Your agent benefits."**
   Use: Hero tagline, social headers, OG images.

2. **"Visit #1 is default. Visit #50 is optimal."**
   Use: Technical contexts, README subhead, anywhere the flywheel needs explaining in one line.

3. **"The browser MCP that remembers."**
   Use: Short-form. Discord, tweet hooks, registry one-liners.

4. **"Every visit makes the next one faster, cheaper, and smarter."**
   Use: Product Hunt, broader audiences, anyone who needs the flywheel spelled out.

5. **"15 browsers. Self-improving. Zero cloud."**
   Use: Spec-forward contexts. npm description. GitHub repo description. HN title supplements.

6. **"It watches. It learns. It adapts."**
   Use: Video intros, dramatic/cinematic contexts, Kling clip overlays.

7. **"Self-improving browser intelligence for AI agents."**
   Use: Formal/press contexts. LinkedIn. Partnership outreach. Registry descriptions.

8. **"Your agents keep visiting the same sites. Shouldn't the browser notice?"**
   Use: Blog post openings, longer-form hooks where you have room for a question.

---

## 5. Headline/Hook Variants by Platform

### X/Twitter

**Thread opener (must work standalone):**
```
Two months ago: "Two agents, one browser, they're fighting."

Today: Leapfrog v0.6.0.

15 isolated browser sessions.
Self-improving per-domain intelligence.
Visit #1: ~1,550 tokens. Visit #50: ~487 tokens.

It remembers which sites need stealth.
It remembers which APIs return the data.
It remembers how to dismiss the cookie banner.

Your browser learns. Your agent benefits.

Open source. Zero cloud. MIT.

npm i leapfrog
```

**Thread tweet 2:**
```
How the self-improvement works:

~/.leapfrog/domains/github.com/

Wait strategy: domcontentloaded (learned after 5 visits)
Stealth tier: basic (learned after 2 visits)
API routes: 3 discovered (persisted from network traffic)
Cookie consent: auto-dismiss OneTrust (learned pattern)

No ML. No cloud. Just a JSON file that gets smarter.
```

**Thread tweet 3:**
```
And the command center is new:

- Auto window tiling (mission control grid)
- Click ripple + scroll-to-target (see what it's doing)
- Red top bar + marimba chime when it needs you
- Session recording for replay and debugging

This isn't a headless scraper. It's a cockpit.

[screenshot/GIF of tiled sessions with HUD]
```

**Thread tweet 4:**
```
The honest numbers:

34 tools. 778 tests. 15 parallel sessions.
Up to 10x fewer tokens than Playwright MCP.
40% additional savings on revisited sites through learning.
3 dependencies. MIT license.

Works with Claude Code, Cursor, Windsurf.

npx leapfrog --doctor

GitHub: [link]
```

---

### Reddit (r/ClaudeAI, r/ClaudeCode, r/mcp)

**Title:**
```
Leapfrog v0.6.0: my browser MCP now learns from every visit. Visit #1 costs ~1,550 tokens. Visit #50 costs ~487.
```

**Body:**
```
Six weeks ago I posted Leapfrog -- a multi-session browser MCP that runs 15 isolated browsers with up to 10x fewer tokens than Playwright MCP. The origin story: I had two Claude Code agents fighting over the same browser and thought "this is insane."

v0.6.0 adds something I haven't seen in any other browser automation tool: self-improving per-domain intelligence.

**What that means in practice:**

Every time your agent visits a site, Leapfrog stores what it learned at ~/.leapfrog/domains/{domain}/. After a few visits:

- It knows github.com loads fast (uses domcontentloaded, not networkidle)
- It knows which stealth level each site requires (basic for GitHub, full for LinkedIn)
- It persists discovered API endpoints from network traffic across sessions
- It auto-dismisses cookie consent banners it's seen before (OneTrust, CookieBot, TrustArc)
- It learns wait strategies that actually work for each domain

Visit #1: default everything. Full stealth. Full page scan. ~1,550 tokens.
Visit #50: optimal settings. Known API endpoints. Instant cookie dismissal. ~487 tokens.

No ML infrastructure. No cloud. Just JSON files on your machine.

**The rest of v0.6.0 is UX polish that makes multi-session headed mode actually usable:**

- Auto window tiling -- every session in a grid, mission control style
- Smart session names from domains, not random hashes
- Click ripple + scroll-to-target showing agent actions
- Red top bar (32px) + tab title "NEEDS HUMAN" + marimba chime when it needs human input (CAPTCHA, login)
- Click ripple + scroll-to-target so you can see what the agent is doing
- Session recording and tracing (flight recorder for debugging)
- Sidecar HTTP API for remote control

**Still the same core from v0.5.2:**

- 15 parallel isolated sessions (separate cookies, storage, fingerprints)
- Up to 10x fewer tokens than Playwright MCP (median 4-5x across 8 page types)
- Network intelligence (capture, filter, mock, intercept)
- Stealth mode (14 anti-detection patches)
- Crash recovery, auth profiles, 34 tools, 778 tests

MCP config:
    {
      "leapfrog": {
        "command": "npx",
        "args": ["-y", "leapfrog"]
      }
    }

MIT license. Zero cloud. Zero telemetry. All learned data stays on your machine.

GitHub: [link]
npm: [link]

Happy to answer questions about the self-improvement architecture. The per-domain learning system was the most interesting thing I've built in this project.
```

---

### Hacker News

**Title:**
```
Show HN: Leapfrog v0.6.0 -- Self-improving browser MCP with per-domain learning
```

**Body:**
```
Leapfrog is a Model Context Protocol server that gives AI coding agents browser automation through 34 tools. v0.6.0 adds per-domain intelligence: a local knowledge store that accumulates wait strategies, stealth requirements, API endpoint discoveries, and snapshot optimizations across sessions.

The learning system:
- Storage: flat JSON at ~/.leapfrog/domains/{domain}/. No database, no cloud.
- Wait strategies: tracks avg load time per domain, learns whether domcontentloaded or networkidle produces better results. After 5 visits, auto-selects the optimal strategy.
- Stealth tiers: records which anti-detection escalation level succeeded per domain. Starts at that level next time instead of escalating from scratch.
- API endpoint persistence: Leapfrog's network intelligence layer discovers JSON API endpoints during normal browsing. v0.6.0 persists those discoveries. If your agent extracted data via page snapshot last time, and an API route exists for the same data, Leapfrog suggests the API shortcut.
- Cookie consent auto-dismiss: rule-based patterns for the top 20 CMPs (OneTrust, CookieBot, TrustArc, UserCentrics). Also learns new patterns from agent behavior.

Result: first visit to a domain costs ~1,550 tokens (full snapshot, default stealth, default wait). After ~50 visits, the same operation costs ~487 tokens (optimized snapshot, learned wait, correct stealth tier). 40% fewer tokens from learning alone, on top of the existing 3-10x advantage over Playwright MCP.

Architecture recap (unchanged from v0.5.2):
- One Chromium process, up to 15 BrowserContext instances with full isolation
- Snapshot engine: Playwright ariaSnapshot filtered to interactive + structural elements, compact @eN refs
- Network intelligence: 200-entry ring buffer, regex filtering, route-based interception
- Stealth: 14 anti-detection patches (webdriver, chrome object, canvas noise, plugins, etc.)
- SSRF protection: DNS pre-resolution, internal IP blocking, URL scheme validation

v0.6.0 also adds headed-mode UX: auto window tiling, click ripple + scroll-to-target, human intervention detection (CAPTCHA/login/challenge) with red top bar and audio notification, session recording, and a sidecar HTTP control API.

Honest comparison note: The per-domain learning is simple -- JSON files and heuristics. It's not ML. It won't revolutionize how you think about automation. But it compounds. After a week of daily use across a dozen domains, the token savings and reliability improvements are measurable and real.

34 tools, 778 tests, 3 runtime deps. TypeScript. MIT.

GitHub: [link]
```

---

### Product Hunt

**Tagline:**
```
The browser MCP that gets smarter every time your AI agent uses it
```

**Description:**
```
Leapfrog gives AI coding agents (Claude Code, Cursor, Windsurf) 15 isolated browser sessions with a self-improving intelligence layer.

THE FLYWHEEL:
Visit #1 -- Default everything. Full stealth. Full page scan. ~1,550 tokens.
Visit #10 -- Learned wait strategy. Cookie banner auto-dismissed. ~1,100 tokens.
Visit #50 -- Optimal settings. Known API endpoints. ~487 tokens. 40% fewer tokens.

Every visit makes the next one faster, cheaper, and more reliable. Per-domain knowledge accumulates locally -- no cloud, no ML, no setup.

WHAT ELSE IT DOES:
- 15 parallel browser sessions (isolated cookies, state, fingerprints)
- Up to 10x fewer tokens than Playwright MCP
- Network intelligence (capture, filter, mock API responses)
- Stealth mode (14 anti-bot patches)
- Auto window tiling, click ripple + scroll-to-target
- Human intervention alerts (CAPTCHA detection + chime)
- Session recording and replay

Open source. MIT license. Zero cloud dependencies.
One install: npx leapfrog
```

---

### Discord (Claude + Cursor servers)

```
Leapfrog v0.6.0 -- now with self-improving per-domain intelligence.

Your browser learns which wait strategy works per site, which stealth level each domain needs, and which API endpoints return the data. Visit #1 costs ~1,550 tokens. Visit #50 costs ~487.

Also new: auto window tiling, click ripple + scroll-to-target, CAPTCHA detection with audio alerts, session recording.

Still: 15 isolated sessions, up to 10x fewer tokens than Playwright MCP, stealth, network intel. 34 tools, 778 tests, MIT.

Config:
{
  "leapfrog": {
    "command": "npx",
    "args": ["-y", "leapfrog"]
  }
}

GitHub: [link]
```

---

## 6. The "Expanding Brain" Creative Brief

### Concept
Five-level "expanding brain" meme using the Leapfrog frog ascending through stages of browser automation intelligence. Each level is a distinct evolutionary step, from primitive to transcendent. The frog evolves visually at each level -- from confused/basic to meditating/enlightened.

### Format
Vertical stack. Each level: LEFT = frog image (ascending sophistication), RIGHT = text label + one-line description. Final level is full-width with the meditating/transcendent frog as the hero.

Can be delivered as:
- Static image (social, README)
- Kling video (each level animates in sequence, frog transforms between levels)
- Remotion composition (animated text + frog images + particle effects)

---

### Level 1: Basic Browser Automation
**Text:** "Playwright MCP"
**Description:** "Send the entire DOM. 14,000 tokens per page. Hope for the best."
**Frog visual:** Small, confused frog sitting at a laptop. Overwhelmed expression. Screen shows a wall of HTML. Basic lighting, flat background.
**NanoBanana prompt:**
```
A small green tree frog sitting at a tiny laptop computer, looking confused and overwhelmed, screen showing dense code text, simple flat desk, soft overhead lighting, low angle, cartoon style with realistic textures, muted colors, slight fog
```

---

### Level 2: Multi-Session Isolation
**Text:** "Leapfrog v0.5.x"
**Description:** "15 isolated browsers. Separate cookies. Separate state. They don't fight anymore."
**Frog visual:** Confident frog standing upright, arms crossed, in front of a grid of 15 small browser windows. Each window glows a different color. The frog looks in control.
**NanoBanana prompt:**
```
A confident green tree frog standing upright with arms crossed, behind the frog a grid of 15 small glowing browser windows each with different colored borders, neon green glow on the frog, dark background with subtle matrix code rain, dramatic side lighting, heroic low angle, digital art style
```

---

### Level 3: Stealth + Network Intelligence
**Text:** "Invisible. Intercepting."
**Description:** "14 anti-detection patches. Network capture. Mock APIs. Sites think you're human."
**Frog visual:** Frog wearing a dark cloak or stealth suit, partially transparent/camouflaged, with glowing network lines radiating outward from it. Data packets visible in the air. Darker, more dramatic atmosphere.
**NanoBanana prompt:**
```
A green tree frog wearing a dark translucent cloak, partially camouflaged and blending into a dark digital environment, glowing cyan network lines radiating outward from the frog, floating data packets and HTTP request text in the air, noir atmosphere with deep shadows, fog, dramatic backlighting, cinematic wide shot
```

---

### Level 4: Self-Improving Per-Domain Learning
**Text:** "It learns."
**Description:** "Per-domain knowledge. Wait strategies. Stealth tiers. API endpoints. Every visit makes the next visit better."
**Frog visual:** Frog sitting in a meditative pose on a glowing platform. Around it, orbiting domain icons (github, google, amazon) with data streams flowing into the frog. A visible "knowledge aura" expanding outward. The frog's eyes are slightly glowing.
**NanoBanana prompt:**
```
A green tree frog sitting in a zen meditation pose on a glowing circular platform, orbiting holographic icons of website logos around it, streams of golden data flowing from the icons into the frog, a soft expanding aura of light around the frog, eyes slightly glowing bright green, dark space background with stars, ethereal atmosphere, volumetric lighting, cinematic composition
```

---

### Level 5: Transcendence
**Text:** "Visit #50."
**Description:** "Optimal wait strategy. Known API endpoints. Instant cookie dismissal. 487 tokens. It just knows."
**Frog visual:** The frog has ascended. Floating in lotus position above a planet/landscape of browser windows. Full enlightenment glow. The `@..@` eyes are prominent and radiant. Energy waves ripple outward. The atmosphere is cosmic -- this frog has seen everything.
**NanoBanana prompt:**
```
A majestic green tree frog floating in lotus meditation position high above a landscape of glowing browser windows, massive radiant aura of white and green light, energy waves rippling outward, the frog's eyes are two bright glowing dots like stars, cosmic dark background with nebula colors, particles of light ascending around the frog, transcendent and serene, volumetric god rays, ultra cinematic wide angle shot from below looking up, atmospheric fog
```

---

### Kling Video Direction (for animating the sequence)

**Clip 1 (Level 1 to 2):** Start frame = confused frog at laptop. Director prompt: "The frog stands up confidently as 15 browser windows materialize behind it in a grid formation, each glowing a different color. Camera slowly pushes in. Mood shifts from dim and chaotic to organized and powerful."

**Clip 2 (Level 2 to 3):** Start frame = confident frog with grid. Director prompt: "A dark cloak materializes around the frog as the browser windows fade to shadows. Glowing network lines begin radiating from the frog's hands. The atmosphere darkens. Camera orbits slowly. Subtle fog rolls in."

**Clip 3 (Level 3 to 4):** Start frame = cloaked stealth frog. Director prompt: "The frog removes the cloak and sits into a meditation pose. A glowing platform forms beneath it. Holographic website icons begin orbiting slowly. Data streams flow inward. The frog's eyes begin to glow. Camera pulls back to reveal the expanding aura."

**Clip 4 (Level 4 to 5):** Start frame = meditating frog with aura. Director prompt: "The frog rises slowly into the air, the platform dissolving into particles below. The aura expands dramatically. Browser windows appear far below like a landscape. Cosmic background reveals itself. Energy waves pulse outward in slow motion. Camera crane shot looking up at the ascending frog. Transcendent. Serene."

**Audio:** All clips use silence or ambient tone. NO native Kling audio. Sound design added in Remotion post-production (warm marimba chime at Level 5 ascension moment).

---

## 7. Banned Messaging

### Carried from v0.5.2 (still enforced):

- **"12x fewer tokens"** -- BANNED. The real number is "up to 10x" (10.3x best case, median 4-5x). Use "up to 10x" in headlines, the range "3-10x" when you have space.
- **"Splash" / "Pad" / "Leaping"** -- BANNED in tool names, CLI output, error messages. Frog terms are for marketing prose and README only, never in technical surfaces.
- **Token savings as the lead** -- BANNED as the Level 1 message. Token efficiency is supporting evidence (Level 2 stat), never the hook.
- **Trashing competitors** -- BANNED. "agent-browser is great if you need one session with minimal tokens. Leapfrog is for parallel sessions + network intel + learning." Always honest, always respectful, always positioning as different-not-better.
- **"The frog does the rest"** -- BANNED. Cut in Don's review. Too cute.
- **Frog terms on HN** -- BANNED. Zero ponds, zero lily pads, zero croaks on Hacker News. Lead with architecture and benchmarks. Let them discover the personality in the README.
- **Mixing Zebra and LCL** -- BANNED. Never reference Anthony's Zebra role in any Leapfrog/LCL context. Ever.

### New for v0.6.0:

- **"AI-powered" / "ML-driven" for the learning system** -- BANNED. Leapfrog's self-improvement is JSON files and heuristics, not machine learning. Saying "AI-powered learning" would be dishonest and would get called out immediately on HN. Say "per-domain intelligence" or "self-improving heuristics" or just "it learns."
- **"Autonomous" or "fully autonomous"** -- BANNED. Leapfrog still needs human intervention for CAPTCHAs, complex logins, and edge cases. The human intervention alert system exists precisely because it's NOT fully autonomous. Don't oversell.
- **"Replaces Playwright MCP"** -- BANNED. Leapfrog uses Playwright under the hood. It's a layer on top, not a replacement. Say "alternative to Playwright MCP" or "built on Playwright."
- **"Enterprise-grade" / "production-ready"** -- BANNED for now. It's a solo dev side project with 778 tests. It's solid, but "enterprise-grade" implies a support team, SLAs, and a sales department. Say "battle-tested" or "daily-driver reliable" instead.
- **Leading with UX features** -- BANNED as Level 1 or Level 2. Window tiling, HUD, and cursors are Level 3 proof points. They're visually impressive but they don't differentiate -- anyone can tile windows. Self-improving intelligence differentiates.
- **"Smart" without specifics** -- BANNED. Don't say "smart browser" or "intelligent automation" without immediately explaining the mechanism. "Smart" is the emptiest word in tech marketing. Follow it with what, how, and the number.
- **Implying data leaves the machine** -- BANNED. All messaging must be clear: zero telemetry, zero cloud, all knowledge stored locally. Any ambiguity on this kills trust with the HN/privacy-conscious audience.

---

## 8. Bridge from v0.5.2 Messaging

### What STAYS (unchanged from v0.5.2):

- **The origin story:** "Two agents. One browser. They're fighting." -- This is permanent. It's the emotional entry point for anyone who hasn't heard of Leapfrog. Still opens cold outreach, first-touch content, and origin-story angles.
- **The multi-session pitch:** 15 isolated sessions, separate cookies/storage/fingerprints. This is the structural foundation. Every v0.6.0 piece still includes it as Level 2.
- **The benchmark numbers:** Up to 10x fewer tokens, the per-page-type table (HN 10.3x, Wikipedia 5.6x, etc.). These are verified benchmarks -- they don't change. Still cited as proof.
- **The honest comparison stance:** "agent-browser wins on raw token count." "browser-use has 81K stars." We don't hide competitors' strengths. That posture stays.
- **The spec line:** "34 tools. 778 tests. 15 sessions. MIT." -- Updated from 19/74 to 34/778. Always current.
- **Channel calibration rules:** Reddit gets the frog personality. HN gets architecture. X gets the hook. Discord gets the config snippet. This is still the law.
- **"Zero cloud" as closer:** This always anchors the end of any pitch. Stays.

### What CHANGES (updated for v0.6.0):

| v0.5.2 Element | v0.6.0 Update |
|---|---|
| **Hook order:** Multi-session first, then stealth, then tokens | **Hook order:** Self-improving first, then multi-session, then UX proof, then trust |
| **Tagline:** "Your agent's context window isn't getting bigger. Your browser should get smaller." | **Tagline:** "Your browser learns. Your agent benefits." (old tagline demoted to supporting copy for token-focused contexts) |
| **Backup tagline:** "15 browsers. Up to 10x lighter. Zero cloud." | **Backup tagline:** "15 browsers. Self-improving. Zero cloud." |
| **npm description:** "Multi-session browser MCP for AI agents -- 34 tools, up to 10x fewer tokens than Playwright, stealth mode" | **npm description:** "Self-improving multi-session browser MCP for AI agents -- 34 tools, per-domain learning, up to 10x fewer tokens, stealth mode" |
| **Reddit title pattern:** "I built a browser MCP that cuts snapshots by up to 10x..." | **Reddit title pattern:** "Leapfrog v0.6.0: my browser MCP now learns from every visit..." |
| **HN title:** "Show HN: Leapfrog -- Multi-session browser MCP (3-10x fewer tokens)" | **HN title:** "Show HN: Leapfrog v0.6.0 -- Self-improving browser MCP with per-domain learning" |
| **Token stat positioning:** Lead stat in tweets and headers | **Token stat positioning:** Supporting stat. The lead stat is now "40% fewer tokens on revisited sites through learning" |
| **Stealth mention:** "12 anti-bot patches" | **Stealth mention:** "14 anti-detection patches" (updated count) |
| **Test/tool count:** "19 tools, 74 tests" | **Test/tool count:** "34 tools, 778 tests, 31 suites" |

### What Gets ADDED (new for v0.6.0):

- **The flywheel narrative:** Visit #1 / Visit #10 / Visit #50 progression. This is the new signature storytelling device. Use it everywhere: social threads, README, landing page, video.
- **The `~/.leapfrog/domains/` reveal:** Showing the actual file path where knowledge lives is a trust move. Technical audiences love seeing the mechanism. "Open the file. Read the JSON. That's what it learned."
- **The command center visual:** Tiled windows with click ripples and scroll-to-target. This is the new "scroll-stopping" visual asset. The v0.5.2 scroll-stopper was the token comparison bar chart. v0.6.0's is the command center screenshot/GIF.
- **The intervention story:** "Your agent hits a CAPTCHA. A red top bar appears with the reason. The tab title changes to 'NEEDS HUMAN.' A warm chime plays. You solve it. The agent continues. All without you polling terminal output." -- This is a new narrative beat, used in Reddit/blog/video but not in HN.
- **The bridge sentence:** "v0.5.2 gave your agents their own browsers. v0.6.0 teaches those browsers to remember." -- Use this in any context that references the upgrade (changelog, release thread, returning-user content).
- **The "Expanding Brain" visual:** New creative asset for social and video. See Section 6 for the full brief.

### Outreach Angle Updates:

| Outreach Channel | v0.5.2 Angle | v0.6.0 Angle |
|---|---|---|
| **Cold DM to Claude Code users** | "15 isolated browsers for your agents -- no more session conflicts" | "Your agents visit the same sites every day. Leapfrog v0.6.0 remembers what works. 40% fewer tokens on revisited domains." |
| **Reply to "browser MCP" threads** | "I built a multi-session alternative to Playwright MCP" | "Leapfrog v0.6.0 just shipped self-improving per-domain learning. Visit #1 costs 1,550 tokens. Visit #50 costs 487." |
| **Reply to "my agent is slow" threads** | "Could be context window bloat -- Playwright MCP sends ~14K tokens per page" | "Could be relearning the same sites. Leapfrog caches per-domain intelligence -- wait strategies, stealth tiers, API routes. Gets faster with use." |
| **Competitive threads (vs agent-browser)** | "agent-browser wins on raw tokens. Leapfrog wins on parallel sessions + network intel." | Same, plus: "Leapfrog also learns per-domain -- tokens decrease over time as it optimizes for each site." |
| **Arcee-style reply chains** | Token comparison stats + multi-session hook | Flywheel stats (visit progression) + "it learns" hook + command center GIF |

### Video Beat Updates (for launch video / Kling clips):

| v0.5.2 Video Beat | v0.6.0 Update |
|---|---|
| Beat 1: "Two agents fighting over one browser" | **KEEP** -- origin story opener, unchanged |
| Beat 2: "15 separate browsers materialize" | **KEEP** -- multi-session visual, still powerful |
| Beat 3: "Token comparison split screen" | **KEEP but demote** -- move later in the video, it's now supporting evidence |
| Beat 4: "Stealth mode activating" | **KEEP** -- visual drama, works at any position |
| NEW Beat 5: "The flywheel" | **ADD** -- show the same page visited 3 times, each visit faster/cheaper. Counter ticking down: 1,550... 1,100... 487. |
| NEW Beat 6: "The command center" | **ADD** -- reveal the tiled grid. Click ripples firing. Scroll-to-target in action. The money shot. |
| NEW Beat 7: "Intervention" | **ADD** -- agent hits CAPTCHA. @..@ frog eyes appear. Chime plays. Human solves it. Agent continues. |
| NEW Beat 8: "The meditating frog" | **ADD** -- Kling clip of transcendent frog from Expanding Brain Level 5. Final image. "It learns." |

---

*This document is the source of truth for all v0.6.0 marketing content. All copy, visuals, video, and outreach should be checked against these hierarchies before publishing. When in doubt, lead with the learning. Close with the trust.*
