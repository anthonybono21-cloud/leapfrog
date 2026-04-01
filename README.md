# HydraChrome

Multi-session browser MCP for AI agents. 19 tools. 5-10x fewer tokens than Playwright MCP.

## Token Savings

| Site | Playwright MCP | HydraChrome | Savings |
|------|---------------|-------------|---------|
| Average page | ~15,000 tokens | ~1,200 tokens | **10x** |

## What It Does

- **15 parallel isolated browser sessions** -- separate cookies, storage, and state per session. No cross-contamination.
- **Compact @eN ref snapshots** -- agents click by ref (`@e3`), not CSS selector. Snapshots run 200-500 tokens instead of 15,000.
- **Network intelligence** -- see every API call, intercept traffic, mock responses, capture console errors.

## Feature Matrix

| Feature | HydraChrome | Playwright MCP | agent-browser |
|---------|-------------|---------------|---------------|
| Multi-session isolation | 15 parallel | No (tabs fight) | No (single) |
| Token efficiency | ~1,200/page | ~15,000/page | ~300/page |
| Network interception | Yes | No | No |
| Stealth mode | Yes | No | No |
| Multi-tab/popup | Yes | No | No |
| Console capture | Yes | Yes | No |
| Crash recovery | Yes | No | No |

## Quick Start

```bash
npx hydrachrome --doctor   # verify setup
npx hydrachrome --config   # get MCP config to paste
```

Add to `~/.mcp.json`:

```json
{
  "hydrachrome": {
    "command": "npx",
    "args": ["-y", "hydrachrome"],
    "env": {
      "HYDRA_MAX_SESSIONS": "15"
    }
  }
}
```

Chromium installs automatically via `postinstall`. If it fails, run manually:

```bash
npx playwright install chromium
```

## Tools (19)

### Session Management

| Tool | Description |
|------|-------------|
| `session_create` | Create an isolated browser session with its own cookies and state |
| `session_destroy` | Close and clean up a session, freeing a pool slot |
| `session_list` | List all active sessions with URLs and idle times |
| `session_save_profile` | Save cookies/auth state to disk for reuse across sessions |
| `session_list_profiles` | List all saved authentication profiles |
| `pool_status` | Pool stats, memory usage, uptime, and session summaries |
| `session_health` | Check if sessions are healthy (browser connected, page responsive) |

### Navigation and Interaction

| Tool | Description |
|------|-------------|
| `navigate` | Go to a URL and return a compact @eN ref snapshot |
| `snapshot` | Re-snapshot the current page for fresh refs (scope with CSS selector) |
| `act` | Click, fill, type, check, select, press, scroll, hover, back, forward |
| `wait_for` | Wait for element, text, network idle, navigation, or JS expression |
| `screenshot` | Capture a PNG screenshot (full page or element) |
| `extract` | Pull text, HTML, title, URL, or evaluate JS on the page |

### Tab Management

| Tool | Description |
|------|-------------|
| `tabs_list` | List all open tabs with index, URL, and active status |
| `tab_switch` | Switch to a tab by index (-1 for most recent popup) |
| `tab_close` | Close a tab by index (cannot close the last tab) |

### Network Intelligence

| Tool | Description |
|------|-------------|
| `network_log` | View HTTP traffic with filters for URL, method, status, content-type |
| `console_log` | View browser console messages filtered by level |
| `network_intercept` | Block, mock, or log network requests by URL pattern |

## Tests

52 tests passing across session management, snapshot engine, and security (SSRF protection, URL scheme blocking, path traversal).

```bash
npm test
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HYDRA_MAX_SESSIONS` | `15` | Maximum concurrent browser sessions |
| `HYDRA_IDLE_TIMEOUT` | `300000` | Session idle timeout in ms (default 5 min) |
| `HYDRA_HEADLESS` | `true` | Run browsers headless. Set `false` to watch. |
| `HYDRA_ALLOW_JS` | `true` | Allow `extract` type=js and `wait_for` condition=js |
| `HYDRA_STEALTH` | `true` | Anti-detection patches (WebDriver flag, plugins, etc.) |
| `HYDRA_LOG_LEVEL` | `info` | Log verbosity: debug, info, warn, error |

## Requirements

- Node.js >= 18
- Chromium (installed automatically via Playwright)

## License

MIT
