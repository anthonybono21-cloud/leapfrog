# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-04-02

### Bug Fixes

- **BUG-001**: Idle timeout default increased from 5 min to 30 min; `LEAP_IDLE_TIMEOUT=0` now disables sweep entirely
- **BUG-002**: `window.open()` popups no longer auto-switch the active tab, preventing session confusion and zombie pages
- **BUG-003**: Client Hints `brands` array no longer contains "HeadlessChrome" (launch args + `userAgentData` override)
- **BUG-004**: `navigator.webdriver` forced to `undefined` via delete + defineProperty + prototype patch
- **BUG-005**: Custom user agent no longer disables other stealth context options
- **BUG-006**: Network request duration uses wall-clock fallback when Playwright timing returns 0ms
- **BUG-007**: Double-destroy of a session now returns an error instead of succeeding silently
- **BUG-008**: Browser crash recovery only clears sessions belonging to the crashed browser, not all sessions
- **BUG-009**: Page crash detection via health check; zombie sessions cleaned up instead of lingering
- Typing humanization uses log-normal distribution with 200ms mean and key dwell time (research-validated)

### Stealth & Anti-Detection

14 evasion patches, all enabled by default (`LEAP_STEALTH=true`):

- Client Hints brands — strips HeadlessChrome from `navigator.userAgentData.brands`
- `navigator.webdriver` — forced to `undefined` with prototype-level patching
- WebGL vendor/renderer — launch args (`--use-gl=angle`) + WebGL1/2 getParameter override
- Connection RTT — `navigator.connection.rtt` returns non-zero value
- Alert dismiss timing — 200-500ms delay instead of instant (< 30ms) dismissal
- Window dimensions — fake 85px chrome offset so `outerHeight !== innerHeight`
- MIME type array — populated `MimeTypeArray` instead of empty
- Platform inference — `navigator.platform` auto-matched to user agent OS
- `chrome.app` emulation
- iframe `contentWindow` protection — patches propagate to child frames
- Media codecs — `canPlayType` override for realistic codec support
- `document.hasFocus()` — returns `true` in headless (was returning `false`)
- Source URL stripping — removes Playwright-injected `sourceURL` comments
- Per-session stealth toggle — `stealth: false` in `session_create` to disable per-session

### Humanization

6 modules, opt-in via `LEAP_HUMANIZE=true`:

- **humanize-mouse** — Bezier curve paths with Fitts's Law timing, ease-in-out parameterization, micro-tremor jitter
- **humanize-typing** — Log-normal inter-key delays (200ms median IKI, ~52 WPM), key dwell time, bigram-aware speed multipliers, rollover typing, QWERTY-adjacency typo model with backspace correction
- **humanize-scroll** — Inertial scroll simulation with ramp-up and momentum decay (touchpad/mouse-wheel physics)
- **humanize-pause** — Inter-action think delays simulating cognitive gaps between actions
- **humanize-fingerprint** — Coherent browser fingerprint generation (platform, deviceMemory, GPU, timezone, screen tier)
- **humanize-utils** — Shared math (Box-Muller gaussian, clamping, human delay distributions)

### New Features

- **`batch_actions` tool** — execute up to 100 sequential browser actions in a single MCP call with optional `delayAfter` per step
- **`add_init_script` tool** — inject JavaScript that runs before every page load and persists across navigations
- **`typeDelay` parameter** on `act` and `batch_actions` — per-keystroke delay for human-like typing speed
- **`mousemove` action** — move mouse to x/y coordinates
- **`drag` action** — drag from source element to destination element
- **`upload` action** — file upload via file input element
- **`resize` action** — resize browser viewport to specified width/height
- **Extended `session_create` options** — viewport, locale, timezoneId, geolocation, permissions, colorScheme, acceptDownloads, per-session stealth toggle, per-session proxy
- **Per-session proxy** — each session can use a different proxy server (HTTP, SOCKS5) with auth support
- **Dockerfile** for Glama registry and CI/CD deployments

### Testing

- **237 tests** across **13 suites** (up from 75 tests across 5 suites in v0.2.0)
- New suites: bugfixes (9 regression tests), stealth-enhanced, humanize-mouse, humanize-typing, humanize-scroll, actions-extended, stress tests, benchmarks
- Dropped Node 18 from CI matrix (EOL; vitest requires Node 20+)

---

## [0.2.0] - 2026-04-01

### Added

- 19 MCP tools across 4 categories: session management (7), navigation & snapshots (6), tab management (3), network intelligence (3)
- Multi-session browser pool -- up to 15 isolated sessions running in parallel
- Compact snapshot engine producing ~1,200-2,500 tokens per page (up to 10x less than Playwright MCP)
- Interactive `@eN` element references for click, fill, and extract operations
- Stealth mode with anti-bot evasion patches (navigator, webdriver, plugins, languages)
- Crash recovery -- automatic session resurrection on browser disconnect
- Network intelligence -- intercept, mock, block, and log HTTP traffic by pattern
- Multi-tab support with popup detection and tab switching
- Auth profile save/load for persistent login state across sessions
- Smart wait system -- 5 strategies (element, text, network idle, navigation, JS expression)
- `--doctor` and `--config` CLI flags for setup verification
- 75 tests across 5 suites (session, snapshot, network, tabs, security)

### Security

- SSRF protection -- blocks requests to private/internal IP ranges
- URL scheme validation -- blocks `file://`, `javascript:`, `data:`, and other dangerous schemes
- Profile path sanitization -- prevents directory traversal in profile names
- Session isolation -- each session gets its own browser context with separate cookies and storage

## [0.1.0] - 2026-03-31

Initial internal prototype. Not published.
