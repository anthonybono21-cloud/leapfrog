# Session 8 Prompt — Stealth, Humanization & Self-Improvement

## Context

Session 8 (part 1) shipped:
- **Self-improvement loop CLOSED** — 7 bugs found and fixed:
  - `recordBlock()` now called on BLOCKED/challenge pages with signal fingerprint
  - `recordConsent()` now reads back browser-side cache after 2.5s, persists via domain knowledge
  - `hints.stealthTier` now applied to `maxRetryLevel` on revisit
  - Domain key normalization fix (www. vs bare domain)
  - 5 new block detection keywords (has been denied, bot or not, press & hold, etc.)
- **Consent learning proven**: B&BW visit 1→2, 173→103 elements = 40% fewer tokens
- **Stealth escalation proven**: H&M 0→1→2 tier across 3 visits
- **Load time trends**: Wikipedia -41%, CNN -39%, Nike -29% over 10 visits
- **Project cleanup**: 50 loose docs → 13 root + 23 in docs/, 25 test screenshots deleted, 23GB disk recovered
- **LCL backlinks**: mssg.me (DR 88) + Linktree (DR 92) live, Behance exists

### Key Finding: Autonomous Signup = 1/15 (7%)
Deep research (5 agents) identified the 5 walls and solutions. See `research/leapfrog-autonomous-signup-research-2026.md`.

### Commit: `dbf9070` — self-improvement loop fixes
- `src/index.ts` — block recording, stealth tier application, consent readback
- `src/adaptive-wait.ts` — 5 new STRONG_KEYWORDS for block detection
- 777/778 tests passing

---

## Step 1: Stealth & Humanization Upgrades

The self-improvement loop works. Now make the stealth foundation stronger so fewer blocks happen in the first place.

### 1a. rebrowser-patches Integration (Highest Priority)
**Why**: Runtime.enable CDP leak is the #1 automation detection signal. rebrowser-patches fixes it as a drop-in for existing Playwright. Currently undetectable by Cloudflare/DataDome.

- Already noted in `src/stealth.ts` as future upgrade
- Two modes: Isolated Contexts (safest) or Rapid Enable/Disable (most compatible)
- Toggleable via env var: `LEAP_REBROWSER=true`
- Test against: Cloudflare Turnstile (hashnode.com), DataDome, Akamai (hm.com, kroger.com)
- Verify all 778 tests still pass after integration

### 1b. Profile Warming
**Why**: Fresh browser profiles with zero history score near 0 on reCAPTCHA v3. A 60-90 second warm-up dramatically improves trust scores.

- New tool: `profile_warm` or auto-warm on first use of new profile
- Flow: create profile → browse Google search → Wikipedia → YouTube → accept cookie banners → scroll pages → click links
- Store warm-up state in profile metadata so it doesn't repeat
- Configurable via `LEAP_AUTO_WARM=true` (default off, don't slow down users who don't need it)

### 1c. Enhanced Typing Humanization
**Why**: Current `humanize-typing.ts` uses fixed delay ranges. Real humans type with key-distance-based delays, make typos, and slow down on long forms.

- Key-distance delay model: adjacent keys (e.g., 'a'→'s') = 50-80ms, cross-keyboard (e.g., 'a'→'p') = 100-180ms
- Markov chain typo simulation: ~2% error rate, followed by backspace + correction
- Fatigue model: typing speed decreases 10-15% over 30+ seconds of continuous input
- Tab-order navigation: fill fields top-to-bottom with click-into-field before typing
- Reference: `HumanTyping` library (github.com/Lax3n/HumanTyping)

### 1d. Enhanced Mouse Humanization
**Why**: Mathematically perfect Bezier curves are detectable. Real mouse movement has jitter, micro-pauses, and overshoot.

- Bezier curves with Gaussian noise injection (±2-5px)
- Micro-pauses mid-movement (50-150ms, ~10% chance per movement)
- Overshoot on targets: move past target by 5-15px, then correct
- Variable movement speed: faster in open space, slower near targets
- Reference: `emunium` library, DMTG (Diffusion-based Mouse Trajectory Generator)

### 1e. Scroll Humanization
**Why**: Instant `scrollTo()` calls are a bot signal. Humans scroll with variable speed, pauses, and re-reads.

- Variable scroll speed: faster through whitespace, slower through content
- Reading pauses: brief stop every ~800px (simulating reading)
- Occasional reverse scroll: ~5% chance of small upward scroll (re-reading)
- Smooth scroll with easing, not discrete jumps

---

## Step 2: CAPTCHA Solver Integration

The single highest-impact change for autonomous success rate (7% → 53%).

### Architecture
```
Navigate → Page loads → intervention.ts detects CAPTCHA type
  → If LEAP_CAPTCHA_PROVIDER set:
      → Extract sitekey + pageURL
      → POST to solver API (CapSolver/2Captcha)
      → Poll for token (3-9s for AI, 20-60s for human)
      → Inject token into page
      → Submit form
  → Else: fall back to wait_for_human
```

### Implementation
- New env vars: `LEAP_CAPTCHA_PROVIDER` (capsolver|2captcha|nopecha), `LEAP_CAPTCHA_API_KEY`
- New file: `src/captcha-solver.ts`
- Supported types: reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile
- Integration point: `intervention.ts` detection → `captcha-solver.ts` resolution → `domain-knowledge.ts` records outcome
- Self-improvement: record which solver worked per domain, cache sitekeys

### Testing
- reCAPTCHA v2: dev.to, dribbble.com, gumroad.com, carrd.co
- Cloudflare Turnstile: hashnode.com, producthunt.com, crunchbase.com
- Measure: solve rate, solve time, cost per solve
- Compare: with solver vs without solver vs human-in-the-loop

---

## Step 3: Terms/Consent Auto-Accept in Forms

### 3a. Terms Checkbox Auto-Check
Like `CONSENT_SELECTORS` but for signup forms:
```typescript
const TERMS_SELECTORS = [
  'input[type="checkbox"][name*="terms"]',
  'input[type="checkbox"][name*="agree"]',
  'input[type="checkbox"][name*="accept"]',
  'input[type="checkbox"][name*="tos"]',
  'input[type="checkbox"][name*="privacy"]',
  'input[type="checkbox"][id*="terms"]',
  'input[type="checkbox"][id*="agree"]',
];
```
- Auto-check during form interaction (not page load — only when filling a form)
- Record in domain knowledge for instant replay on revisit

### 3b. Press-and-Hold Challenge Auto-Solver
PerimeterX "Press & Hold" is solvable — we proved it today with B&BW (8s mouse hold).
- Detect `#px-captcha` element
- Execute: mouse.move → mouse.down → wait 8s → mouse.up
- Record success in domain knowledge

---

## Step 4: Publish & Distribute

- [ ] Fix CI tests (stealth-enhanced.test.ts, cdp-connector.test.ts)
- [ ] `npm publish --access public` (v0.6.1)
- [ ] `npx leapfrog --doctor` sanity check from clean terminal
- [ ] Glama submission (required for awesome-mcp-servers PR)
- [ ] Re-open awesome-mcp-servers PR
- [ ] Registry submissions: Smithery.ai, PulseMCP, MCP.so, MCPServers.org, LobeHub

---

## Step 5: OAuth & Email Verification Documentation

### OAuth Flow
- Document `session_create profile="google"` workflow
- Add guided first-time auth: "Sign into Google in this headed window. Your profile is saved."
- Profile health check: detect expired sessions before running tasks

### Email Verification
- Document IMAP MCP server setup (`codefuturist/email-mcp`)
- OTP extraction regex: `/(?:code|verify|otp)\s*(?:is|:)?\s*(\d{4,8})/i`
- Magic link extraction: parse `<a href>`, filter by `/verify/|/confirm/|/activate/`

---

## Critical Rules
- Self-improving intelligence is ALWAYS the lead
- Multi-session is foundation
- Visit counter narrative (Visit 1 → Visit 50) is core proof point
- Self-improvement loop is CLOSED and PROVEN (consent: 40% token savings, blocks: tier escalation)
- Token savings is proof the learning works, not the story
- Origin story: "Two agents, one browser, fighting"
- Positioning: "Human-assisted automation" — speed multiplier, not human replacement
- NEVER mix Zebra and LCL content

## Session 8 Part 1 Stats
- 1 commit pushed (`dbf9070`)
- 777 tests passing, 31 suites
- 34 tools
- 7 self-improvement bugs found and fixed
- 142 test navigations across 7 domains
- 15 backlink signup attempts: 2 live, 1 existing, 2 pending verification
- 5-agent deep research on autonomous signup
- 23GB disk space recovered
- Project root: 50 loose files → 13 clean
