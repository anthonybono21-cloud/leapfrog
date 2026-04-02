# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
