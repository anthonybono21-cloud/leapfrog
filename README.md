<p align="center">
<img src="hero.png" alt="Leapfrog" width="400" />
</p>

<h1 align="center">Leapfrog</h1>
<p align="center"><strong>Multi-session browser MCP for AI agents.</strong><br/>21 tools. 15 parallel sessions. Stealth. Humanization. Up to 10x fewer tokens.</p>

<p align="center">
<code>npm i leapfrog</code>&nbsp;&nbsp;|&nbsp;&nbsp;Works with Claude Code, Cursor, Windsurf
</p>

---

## The Problem

Playwright MCP sends **~14,000 tokens** for a content-heavy page like Hacker News. Most of that is noise. Your context window fills up. Your agent gets confused. You pay for it.

Leapfrog sends **~1,400 tokens**. Same page. Same information. Up to 10x less noise.

```
┌─────────────────────────────────────────────────────┐
│  Playwright MCP                                     │
│  ████████████████████████████████████████  ~14,000   │
│                                                     │
│  Leapfrog                                           │
│  █████                                    ~1,400    │
└─────────────────────────────────────────────────────┘
          tokens per page (Hacker News, real test)
```

Savings range from 2-10x depending on page complexity. Content-heavy pages see the biggest wins. Dense forms see the smallest. The median across real-world sites is **~4-5x**.

## Quick Start

```bash
npx leapfrog --doctor   # verify everything works
npx leapfrog --config   # print MCP config to paste
```

Add to `~/.mcp.json` (Claude Code) or your editor's MCP config:

```json
{
  "leapfrog": {
    "command": "npx",
    "args": ["-y", "leapfrog"],
    "env": {
      "LEAP_MAX_SESSIONS": "15"
    }
  }
}
```

Chromium installs automatically. If it fails: `npx playwright install chromium`

## Feature Matrix

| | Leapfrog | Playwright MCP | agent-browser |
|---|:---:|:---:|:---:|
| Tokens per page | **~1,200-2,500** | ~3,800-15,000 | ~300 |
| Parallel sessions | **15** | 1 | 1 |
| Session isolation | Yes | No | No |
| Multi-tab / popups | Yes | No | No |
| Network intercept | Yes | No | No |
| Console capture | Yes | Yes | No |
| Stealth / anti-bot | Yes | No | No |
| Smart wait (5 types) | Yes | Basic | No |
| Crash recovery | Yes | No | No |
| Batch actions (100/call) | Yes | No | No |
| Init script injection | Yes | Yes | No |
| Drag / upload / resize | Yes | Yes | No |
| Per-session proxy | Yes | No | No |
| Humanization (opt-in) | Yes | No | No |
| Auth profile reuse | Yes | No | No |
| SSRF protection | Yes | No | No |

## Stealth

Leapfrog ships 14 anti-detection patches enabled by default (`LEAP_STEALTH=true`). These cover the vectors that fingerprint services like CreepJS and fingerprint-pro actually check:

- Client Hints brands (strips HeadlessChrome)
- `navigator.webdriver` forced to `undefined`
- WebGL vendor/renderer (replaces SwiftShader with real GPU strings)
- Connection RTT (non-zero)
- Alert dismiss timing (human-speed delay)
- Window outer/inner height offset
- MIME type array population
- Platform inference from user agent
- `chrome.app` emulation
- iframe `contentWindow` protection
- Media codec spoofing (`canPlayType`)
- `document.hasFocus()` override
- Source URL comment stripping
- Custom UA + stealth coexistence (custom user agents no longer disable stealth context)

Per-session stealth control: pass `stealth: false` in `session_create` to disable for a specific session.

## Humanization (Experimental)

Set `LEAP_HUMANIZE=true` to enable human-like browser interaction. This is opt-in and adds latency in exchange for more realistic behavior. Six modules:

- **Mouse** — Bezier curve paths with Fitts's Law timing and micro-tremor jitter
- **Typing** — Log-normal inter-key delays (200ms median), key dwell time, bigram-aware speed, rollover typing
- **Scroll** — Inertial simulation with ramp-up and momentum decay (touchpad/mouse-wheel physics)
- **Pause** — Inter-action "think" delays that simulate cognitive gaps between actions
- **Fingerprint** — Coherent browser fingerprint generation (platform, device memory, GPU, timezone)
- **Utils** — Shared math primitives (Box-Muller gaussian, distributions)

## The Ecosystem

Leapfrog uses pond metaphors to keep things memorable. Your agent is the frog.

| Concept | Leapfrog term | What it means |
|---|---|---|
| Sessions | **Ponds** | Isolated browser contexts — cookies, storage, state |
| Tabs | **Lily pads** | Where the frog lands within a pond |
| Navigate | **Leap** | Jump to a URL, get a compact snapshot back |
| Snapshots | **Surface** | What you see on the surface — interactive `@eN` refs |
| Network traffic | **Ripple** | HTTP requests flowing under the surface |
| Console errors | **Croak** | Something went wrong in the browser |
| Stealth mode | **Camouflage** | Anti-bot evasion patches |

## All 21 Tools

### Pond Management (7)

| Tool | What it does |
|---|---|
| `session_create` | Open a new pond — isolated cookies, state, viewport, locale, timezone, stealth, proxy |
| `session_destroy` | Drain a pond and free the slot |
| `session_list` | See all active ponds with URLs and idle times |
| `session_save_profile` | Save auth state to disk for future ponds |
| `session_list_profiles` | List saved auth profiles |
| `pool_status` | Pool stats, memory, uptime |
| `session_health` | Is the pond healthy? Browser connected, page responsive? |

### Navigation & Snapshots (8)

| Tool | What it does |
|---|---|
| `navigate` | Leap to a URL, return a compact `@eN` snapshot |
| `snapshot` | Re-read the surface (scope with CSS selector) |
| `act` | Click, fill, type, check, select, press, scroll, hover, mousemove, drag, upload, resize, back, forward |
| `batch_actions` | Up to 100 sequential actions in one MCP call — eliminates round-trip overhead |
| `add_init_script` | Inject JS that runs before every page load, persists across navigations |
| `wait_for` | Wait for element / text / network idle / navigation / JS expression |
| `screenshot` | Capture PNG (full page or element) |
| `extract` | Pull text, HTML, title, URL, or evaluate JS |

### Tab Management (3)

| Tool | What it does |
|---|---|
| `tabs_list` | List all pads in a pond |
| `tab_switch` | Hop to another pad (-1 for most recent popup) |
| `tab_close` | Close a pad (can't close the last one) |

### Network Intelligence (3)

| Tool | What it does |
|---|---|
| `network_log` | See HTTP traffic — filter by URL, method, status, content-type |
| `console_log` | Read browser console output, filtered by level |
| `network_intercept` | Block, mock, or log requests by URL pattern |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LEAP_MAX_SESSIONS` | `15` | Max concurrent sessions |
| `LEAP_IDLE_TIMEOUT` | `1800000` | Session idle timeout in ms (30 min). Set `0` to disable. |
| `LEAP_HEADLESS` | `true` | Set `false` to watch the browser |
| `LEAP_CHANNEL` | _(bundled chromium)_ | Set `chrome` to use your installed Chrome |
| `LEAP_ALLOW_JS` | `true` | Allow JS evaluation in `extract` and `wait_for` |
| `LEAP_STEALTH` | `true` | Stealth mode (anti-bot evasion) — 14 patches |
| `LEAP_HUMANIZE` | `false` | Experimental. Human-like mouse movement, typing cadence, and scroll behavior. |
| `LEAP_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Tests

```
 237 passing across 13 suites
```

Session management, snapshot engine, network intelligence, tab management, security, stealth patches, humanization (mouse, typing, scroll), extended actions, bug regression, stress tests, benchmarks.

```bash
npm test
```

## Requirements

- Node.js >= 20
- Chromium (auto-installed via Playwright)

## License

MIT
