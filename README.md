<p align="center">
<pre align="center">
       ╱▔▔▔╲
      ▕ ●  ● ▏
      ╰╲ ▽▽ ╱╯
    ╱▔▔▔▔╲╱▔▔▔▔╲
   ▕ ░░░░░░░░░░░ ▏
    ╲▁▁▁╱  ╲▁▁▁╱
     ╱╱      ╲╲
</pre>
</p>

<h1 align="center">Leapfrog</h1>
<p align="center"><strong>Multi-session browser MCP for AI agents.</strong><br/>19 tools. 15 parallel sessions. 10x fewer tokens.</p>

<p align="center">
<code>npm i leapfrog</code>&nbsp;&nbsp;|&nbsp;&nbsp;Works with Claude Code, Cursor, Windsurf
</p>

---

## The Problem

Playwright MCP sends **~15,000 tokens per page** to your agent. Most of that is noise. Your context window fills up. Your agent gets confused. You pay for it.

Leapfrog sends **~1,200 tokens**. Same page. Same information. Just the parts that matter.

```
┌─────────────────────────────────────────────────────┐
│  Playwright MCP                                     │
│  ████████████████████████████████████████  ~15,000   │
│                                                     │
│  Leapfrog                                           │
│  ████                                     ~1,200    │
└─────────────────────────────────────────────────────┘
                    per page snapshot
```

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
| Tokens per page | **~1,200** | ~15,000 | ~300 |
| Parallel sessions | **15** | 1 | 1 |
| Session isolation | Yes | No | No |
| Multi-tab / popups | Yes | No | No |
| Network intercept | Yes | No | No |
| Console capture | Yes | Yes | No |
| Stealth / anti-bot | Yes | No | No |
| Smart wait (5 types) | Yes | Basic | No |
| Crash recovery | Yes | No | No |
| Auth profile reuse | Yes | No | No |
| SSRF protection | Yes | No | No |

## The Ecosystem

Leapfrog speaks in pond metaphors. Your agent is the frog.

| Concept | Leapfrog term | What it means |
|---|---|---|
| Sessions | **Ponds** | Isolated browser contexts (cookies, storage, state) |
| Tabs | **Pads** | Lily pads -- where the frog lands within a pond |
| Navigate | **Leap** | Jump to a URL, get a compact snapshot back |
| Snapshots | **Splash** | What you see when you land -- interactive `@eN` refs |
| Network traffic | **Ripple** | HTTP requests under the surface |
| Console errors | **Croak** | Something went wrong in the browser |
| Stealth mode | **Camouflage** | Anti-bot evasion patches |

## All 19 Tools

### Pond Management (7)

| Tool | What it does |
|---|---|
| `session_create` | Open a new pond -- isolated cookies, state, viewport |
| `session_destroy` | Drain a pond and free the slot |
| `session_list` | See all active ponds with URLs and idle times |
| `session_save_profile` | Save auth state to disk for future ponds |
| `session_list_profiles` | List saved auth profiles |
| `pool_status` | Pool stats, memory, uptime |
| `session_health` | Is the pond healthy? Browser connected, page responsive? |

### Leaping & Splashing (6)

| Tool | What it does |
|---|---|
| `navigate` | Leap to a URL, return a compact `@eN` snapshot |
| `snapshot` | Re-splash the current page (scope with CSS selector) |
| `act` | Click, fill, type, check, select, press, scroll, hover, back, forward |
| `wait_for` | Wait for element / text / network idle / navigation / JS expression |
| `screenshot` | Capture PNG (full page or element) |
| `extract` | Pull text, HTML, title, URL, or evaluate JS |

### Pad Management (3)

| Tool | What it does |
|---|---|
| `tabs_list` | List all pads in a pond |
| `tab_switch` | Hop to another pad (-1 for most recent popup) |
| `tab_close` | Close a pad (can't close the last one) |

### Ripple Intelligence (3)

| Tool | What it does |
|---|---|
| `network_log` | See HTTP traffic -- filter by URL, method, status, content-type |
| `console_log` | Read croaks -- browser console filtered by level |
| `network_intercept` | Block, mock, or log requests by URL pattern |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `LEAP_MAX_SESSIONS` | `15` | Max concurrent ponds |
| `LEAP_IDLE_TIMEOUT` | `300000` | Pond idle timeout in ms (5 min) |
| `LEAP_HEADLESS` | `true` | Set `false` to watch the browser |
| `LEAP_ALLOW_JS` | `true` | Allow JS evaluation in `extract` and `wait_for` |
| `LEAP_STEALTH` | `true` | Camouflage mode (anti-bot evasion) |
| `LEAP_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Tests

```
 74 passing across 5 suites
```

Session management, snapshot engine, network intelligence, tab management, security (SSRF, URL scheme blocking, path traversal).

```bash
npm test
```

## Requirements

- Node.js >= 18
- Chromium (auto-installed via Playwright)

## License

MIT
