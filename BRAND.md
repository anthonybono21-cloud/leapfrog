# Leapfrog Brand Package

## 1. ASCII Art Frog Logo

### Small (startup banner, 3 lines)

```
  @..@
 (----)
( >__< )
```

### Medium (--doctor header, 7 lines)

```
     @..@
    (----)
   / >  < \
  | |    | |
  \ \    / /
   '-.~~.-'
     |__|
```

### Large (README / npm page, 11 lines)

```
        @..@
       (----)
      / >  < \
     |        |
     | \    / |
     \  '--'  /
      '.    .'
     /| `--` |\
    / |        | \
   '  '.____.'  '
        |  |
```

### Rendering notes

- Use `\x1b[92m` (bright green) for the entire frog.
- Reset with `\x1b[0m` after.
- The `@..@` eyes are the most recognizable feature -- keep them in all sizes.
- Standard ASCII only. No Unicode, no emoji. Every character is printable 7-bit ASCII.
- All versions are under 80 columns wide so they never wrap in default terminals.


---

## 2. Terminal Color Palette

| Role             | ANSI Code        | Escape Sequence   | Preview Use                    |
|------------------|------------------|-------------------|--------------------------------|
| Frog / logo      | Bright green     | `\x1b[92m`        | ASCII art, brand text          |
| Success          | Green            | `\x1b[32m`        | `[pass]`, "Session created"    |
| Warning          | Yellow           | `\x1b[33m`        | `[warn]`, deprecation notices  |
| Error            | Red              | `\x1b[31m`        | `[fail]`, fatal messages       |
| Info / labels    | Cyan             | `\x1b[36m`        | Headers, section titles        |
| Primary text     | White (bold)     | `\x1b[1m`         | Values, key output             |
| Muted / dim      | Gray             | `\x1b[90m`        | Secondary info, timestamps     |
| Reset            | --               | `\x1b[0m`         | After every colored span       |

### Code constants

```typescript
const C = {
  frog:    "\x1b[92m",  // bright green
  ok:      "\x1b[32m",  // green
  warn:    "\x1b[33m",  // yellow
  err:     "\x1b[31m",  // red
  info:    "\x1b[36m",  // cyan
  bold:    "\x1b[1m",   // bold white
  dim:     "\x1b[90m",  // gray
  reset:   "\x1b[0m",
} as const;
```


---

## 3. Terminal Startup Banner

When `npx leapfrog` starts the MCP server, print this to `stderr`:

```
  @..@    Leapfrog v0.2.0
 (----)   19 tools | 15 max sessions | stealth on
( >__< )  Ready.
```

### Exact implementation

```typescript
function printBanner(version: string, tools: number, maxSessions: number, stealth: boolean): void {
  const G = "\x1b[92m";
  const D = "\x1b[90m";
  const R = "\x1b[0m";

  console.error(
    `${G}  @..@${R}    Leapfrog ${D}v${version}${R}\n` +
    `${G} (----)${R}   ${tools} tools ${D}|${R} ${maxSessions} max sessions ${D}|${R} stealth ${stealth ? "on" : "off"}\n` +
    `${G}( >__< )${R}  Ready.`
  );
}
```

### Design decisions

- Printed to `stderr` so it never pollutes JSON-RPC on `stdout`.
- The frog sits left, stats sit right. Reads like a business card.
- Version is dimmed -- it's info, not the headline.
- "Ready." is the last thing printed. Clean signal that the server is live.
- No box drawing. No horizontal rules. Three lines, done.


---

## 4. --doctor Output Design

```
     @..@
    (----)      Leapfrog Doctor
   / >  < \
  | |    | |
  \ \    / /
   '-.~~.-'
     |__|

  [pass]  Node.js         v22.0.0
  [pass]  Chromium         /Users/ted/.cache/ms-playwright/chromium-1234
  [pass]  Browser launch   131ms cold start
  [pass]  Profiles dir     ~/.leapfrog/profiles
  [pass]  Screenshots dir  ~/.leapfrog/screenshots
  [warn]  Stealth          Disabled (LEAP_STEALTH=false)

  Environment:

  LEAP_MAX_SESSIONS   = 15
  LEAP_IDLE_TIMEOUT   = 300000 (5m)
  LEAP_HEADLESS       = true
  LEAP_ALLOW_JS       = true
  LEAP_STEALTH        = false
  LEAP_LOG_LEVEL      = info

  5 passed, 1 warning, 0 failed
```

### Color rules

| Element          | Color                                  |
|------------------|----------------------------------------|
| ASCII frog       | `\x1b[92m` bright green                |
| "Leapfrog Doctor"| `\x1b[1m` bold white                   |
| `[pass]`         | `\x1b[32m` green                       |
| `[warn]`         | `\x1b[33m` yellow                      |
| `[fail]`         | `\x1b[31m` red                         |
| Check labels     | default (no color)                     |
| Check details    | `\x1b[90m` dim gray                    |
| Env var names    | `\x1b[36m` cyan                        |
| Env var values   | default                                |
| Summary line     | matches worst status color in the run  |

### Behavior

- If any check is `[fail]`, exit code 1. Otherwise exit 0.
- Summary line adapts: all pass = green, any warn = yellow, any fail = red.
- Env var section always prints regardless of check results.
- The medium frog anchors the top. "Leapfrog Doctor" floats to the right of it.


---

## 5. Ecosystem Naming Guide

### The naming philosophy

Frog metaphors earn attention. They don't replace clarity. The rule:
**If a term appears in CLI output or tool responses, it must be instantly clear to someone who has never read the docs.** Marketing and README prose get more latitude — but only when the metaphor makes the concept *stickier*, not just cuter.

### Full vocabulary

| Concept               | Frog Term      | Where to use it                              |
|-----------------------|----------------|----------------------------------------------|
| Browser session       | Pond           | Marketing, README prose, blog posts           |
| Tab                   | Lily pad       | Marketing, README prose only                  |
| Navigate to URL       | Leap           | Marketing, tagline                            |
| DOM snapshot          | Surface        | Marketing ("read the surface"), `snapshot` stays literal in CLI |
| Network intelligence  | Ripple          | Marketing ("see every ripple")               |
| Console errors        | Croak          | Marketing ("catch every croak"), easter egg potential in logs |
| Stealth mode          | Camouflage     | Marketing, README                             |
| Screenshot            | Screenshot     | Everywhere (already literal, no rename)       |
| Session pool          | Pool / Pond    | Marketing ("a pool of ponds")                 |

### What DOES appear in CLI output

```
Session created: s_k3m7x1       <-- not "Pond spawned"
Navigated to https://...        <-- not "Leaped to"
Snapshot: 847 tokens            <-- "Snapshot" is already the right word
[pass]  Browser launch          <-- no frog language in doctor output
```

### What appears in marketing / README only

> "Each session is a **pond** — an isolated browser with its own cookies, storage,
> and fingerprint. Leapfrog manages up to 15 ponds simultaneously, each one
> invisible thanks to built-in **camouflage**."

> "**Leap** between pages. Read the **surface**. See every **ripple** on the network.
> Catch every **croak** in the console."

### The line

- `snapshot`, `screenshot`, `session`, `navigate`, `extract`, `act` -- these are tool names. They stay literal in all contexts.
- `pond`, `lily pad`, `leap`, `ripple`, `croak`, `camouflage` -- these are flavor. README intros, taglines, landing page copy. Never in tool names, never in JSON output, never in error messages.

### Tagline candidates

- **"Your agent's context window isn't getting bigger. Your browser should get smaller."** *(positioning)*
- "Multi-session browsing for AI agents." *(straight, for npm/GitHub)*
- "15 browsers. Up to 10x lighter. Zero cloud." *(spec line)*


---

## 6. npm Package Card

### `description` field (94 chars)

```
"Multi-session browser MCP for AI agents -- 19 tools, up to 10x fewer tokens than Playwright, stealth mode"
```

### `keywords` array

```json
[
  "mcp",
  "browser",
  "headless",
  "playwright",
  "ai-agent",
  "automation",
  "web-scraping",
  "multi-session",
  "stealth",
  "dom-snapshot",
  "model-context-protocol",
  "claude",
  "cursor",
  "windsurf",
  "browser-automation"
]
```

### Rationale

- `mcp` and `model-context-protocol` cover the protocol space.
- `claude`, `cursor`, `windsurf` target the three biggest MCP client audiences.
- `ai-agent` and `automation` are high-volume search terms.
- `web-scraping` captures the use case even though it's not the primary pitch.
- `stealth` and `dom-snapshot` are differentiators from competing browser MCPs.
- `playwright` is the engine, and people search for Playwright wrappers.
- 15 keywords total. npm displays all of them on the package page.


---

## Quick Reference: Color Escape Sequences

Copy-paste ready for any TypeScript file:

```typescript
// Leapfrog terminal colors
const FROG   = "\x1b[92m";   // bright green -- logo, brand
const OK     = "\x1b[32m";   // green -- success, [pass]
const WARN   = "\x1b[33m";   // yellow -- warnings, [warn]
const ERR    = "\x1b[31m";   // red -- errors, [fail]
const INFO   = "\x1b[36m";   // cyan -- labels, headers
const BOLD   = "\x1b[1m";    // bold -- emphasis
const DIM    = "\x1b[90m";   // gray -- secondary, muted
const RESET  = "\x1b[0m";    // reset -- end every colored span
```
