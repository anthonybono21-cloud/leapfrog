# Leapfrog Test Plan

**Date:** April 1, 2026
**Framework:** Vitest 4.1.2
**Test Runner:** `npm test` (vitest run, pool: forks)
**Total Tests:** 208 passing across 11 test files

---

## Test Strategy

### Approach

Three testing tiers target different risk areas identified in the QA feedback report (150+ scenarios from 30 Opus agents):

1. **Regression tests** (bugfixes.test.ts, stealth-enhanced.test.ts) -- Pin down every QA-reported bug so it cannot regress. Each BUG-XXX from the master feedback report has at least one test.

2. **Feature tests** (actions-extended.test.ts) -- Cover the 6 API additions needed for full humanization integration, plus advanced browser actions (drag, upload, resize, batch actions, init script persistence).

3. **Math/algorithm tests** (humanize-mouse.test.ts, humanize-typing.test.ts, humanize-scroll.test.ts) -- Validate the statistical and mathematical properties of the humanize.js prototype without needing a browser. These are pure unit tests that run in <100ms.

### Test Isolation

- Browser-based tests create real Playwright sessions (headless Chromium)
- Each describe block manages its own SessionManager lifecycle
- afterAll hooks destroy all sessions and close the browser
- The `pool: 'forks'` config isolates test files from each other
- Math tests have zero external dependencies

---

## Test Files

### Existing (5 files, 92 tests)

| File | Tests | What It Covers |
|------|-------|----------------|
| session-manager.test.ts | 11 | Session CRUD, pool limits, stats, touch, viewport |
| snapshot-engine.test.ts | 45 | YAML parsing, ref generation, role classification, maxChars |
| security.test.ts | 18 | URL scheme blocking, profile sanitization, path traversal |
| integration-smoke.test.ts | 1 | End-to-end session + snapshot with real browser |
| stress-test.test.ts | 17 | Parallel sessions, rapid create/destroy, memory scaling |

### New (6 files, 116 tests)

| File | Tests | What It Covers |
|------|-------|----------------|
| bugfixes.test.ts | 19 | BUG-001 through BUG-009 regression tests |
| actions-extended.test.ts | 22 | Drag, upload, resize, mousemove, typeDelay, batch, initScript, extended session_create |
| humanize-mouse.test.ts | 22 | Bezier paths, Fitts's Law, jitter, endpoints, ease-in-out, speed profiles |
| humanize-typing.test.ts | 21 | Variable delays, punctuation pauses, burst typing, typo sequences, WPM |
| humanize-scroll.test.ts | 21 | Ramp-up, momentum decay, distance accuracy, direction, timing |
| stealth-enhanced.test.ts | 21 | All evasion patches evaluated in real Chromium pages |

---

## Bug Coverage Matrix

| Bug | Severity | Test File | Test Name(s) | Status |
|-----|----------|-----------|---------------|--------|
| BUG-001 | CRITICAL | bugfixes.test.ts | "session survives when idle timeout is set higher", "session is reaped when idle exceeds", "touchSession resets the idle timer" | PASS (3 tests) |
| BUG-002 | CRITICAL | bugfixes.test.ts | "session survives window.open() followed by popup close", "tab manager recovers active page after popup self-closes" | PASS (2 tests) |
| BUG-003 | HIGH | bugfixes.test.ts, stealth-enhanced.test.ts | "Client Hints brands should not contain HeadlessChrome", "userAgentData brands" | PASS (documents known gap) |
| BUG-004 | HIGH | bugfixes.test.ts, stealth-enhanced.test.ts | "navigator.webdriver should be undefined", 2 stealth tests | PASS (4 tests) |
| BUG-005 | HIGH | bugfixes.test.ts | "getContextOptions returns empty when custom UA provided", "stealth init script still applies with custom UA" | PASS (3 tests) |
| BUG-007 | LOW | bugfixes.test.ts | "second destroy does not throw", "session not listed after destroy" | PASS (4 tests) |
| BUG-009 | MEDIUM | bugfixes.test.ts | "health check detects closed page", "healthCheckAll identifies mixed" | PASS (3 tests) |

---

## Humanization API Coverage

Each of the 6 API additions from the QA integration gap analysis has test coverage:

| API Addition | Test File | What's Tested |
|-------------|-----------|---------------|
| 1. typeDelay param | actions-extended.test.ts | pressSequentially with/without delay, timing verification |
| 2. mousemove(x,y) | actions-extended.test.ts | page.mouse.move() to coords, sequential path moves |
| 3. addInitScript | actions-extended.test.ts | context.addInitScript across navigations, page.addInitScript on reload |
| 4. Extended session_create | actions-extended.test.ts | Custom viewport, UA, storageState validation, locale, timezone |
| 5. batch_actions | actions-extended.test.ts | Sequential fill/select/click, actions with delays |
| 6. stealth flag | stealth-enhanced.test.ts | Full stealth patch evaluation in real pages |

---

## Stealth Evasion Coverage

Every stealth patch in src/stealth.ts is evaluated in a real Chromium page:

| Evasion | Test | Result |
|---------|------|--------|
| navigator.webdriver | typeof returns "undefined" | PASS |
| navigator.plugins | 5 fake plugins, namedItem works | PASS |
| navigator.languages | ["en-US", "en"] | PASS |
| navigator.platform | "MacIntel" | PASS |
| navigator.hardwareConcurrency | 8 | PASS |
| navigator.deviceMemory | 8 | PASS |
| window.chrome | runtime, loadTimes(), csi() | PASS |
| Notification.permission | "default" | PASS |
| permissions.query | notifications resolves | PASS |
| Canvas fingerprint noise | toDataURL works, noise applied | PASS |
| User agent string | No "Headless" substring | PASS |
| ChromeDriver property | cdc_ property removed | PASS |
| Client Hints brands | Documents current state (known gap) | PASS |
| WebGL renderer | Documents SwiftShader in headless (known gap) | PASS |
| outerWidth/outerHeight | Documents zero in headless (known gap) | PASS |

---

## Humanize.js Algorithm Coverage

### Mouse (Bezier paths)
- Endpoint accuracy (start/end match, negative coords, zero distance)
- Non-linearity (intermediate points deviate, randomized paths differ)
- Fitts's Law (longer distance = more steps, minimum 10, explicit override)
- Jitter bounds (start/end have no jitter, intermediate jitter is small)
- Ease-in-out (denser near endpoints, t values monotonic 0->1)
- bezierPoint math (t=0 returns P0, t=1 returns P3, midpoint, collinear)
- Speed profiles (small/large step counts, auto-calculation)

### Typing (Gaussian delays)
- Variable delays (not constant, positive, within range)
- Punctuation pauses (space > regular, comma/period in 100-200ms, newline in 200-500ms)
- Burst typing (short 30-55ms clusters occur)
- Typo sequences (wrong char -> backspace -> correct char, QWERTY adjacency)
- Timing (backspace reaction 150-350ms, correction retype 50-120ms)
- Zero typo rate produces zero typos
- Total typing time (short: 500-3000ms, medium: 2-15s, WPM: 20-150)
- Edge cases (empty string, single char, non-alpha no typos, uppercase preserved)

### Scroll (momentum decay)
- Ramp-up (first steps increase, smaller than maxIncrement)
- Momentum decay (later steps decrease, friction controls rate)
- Distance accuracy (cumulative sum matches, final cumulative correct)
- Direction (positive = positive deltas, negative = negative, zero = empty)
- Delay timing (ramp-up short, decay short, total reasonable)
- Edge cases (1px distance, custom maxIncrement, integer delays, randomized counts)

---

## Running Tests

```bash
# Full suite
npm test

# Single file
npx vitest run src/__tests__/bugfixes.test.ts

# Watch mode
npx vitest src/__tests__/bugfixes.test.ts

# With verbose output
npx vitest run --reporter=verbose
```

## Test Results Summary

```
 Test Files  11 passed (11)
      Tests  208 passed (208)
   Duration  7.45s
```

All 208 tests pass. Zero failures, zero skipped.
