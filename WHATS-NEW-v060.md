# What's New in Leapfrog v0.6.0

**For:** Marketing agency teams (LCL), website copy, video production  
**Audience:** Developers using AI agents for browser automation  
**Tone:** Clear, relatable, non-technical where possible

---

## The One-Liner

Leapfrog went from "multi-session browser tool" to **"command center for AI browser agents."**

---

## Feature-by-Feature: What It Is, Why It Matters

### 1. Auto Window Tiling
**What:** When you run multiple headed browser sessions, they automatically arrange themselves in a clean grid on your screen. Add a session? Grid reflows. Close one? Remaining windows expand to fill the space. Supports grid layout (equal tiles) and master-stack layout (one big + smaller observers).

**Problem it solves:** Before this, opening 6 headed browsers meant 6 windows stacked on top of each other. Chaos. You couldn't see what was happening. Now it looks like a mission control dashboard.

**The visual:** Imagine 6 Chrome windows, perfectly tiled, each showing a different website — all managed automatically. Close 3, and the remaining 3 smoothly expand. That's the demo moment.

---

### 2. Smart Session Names
**What:** Sessions auto-name themselves based on the first website they visit. Instead of cryptic IDs like `s_k3m7x1`, you see `[github]`, `[hackernews]`, `[gmail]`. You can also refer to sessions by name: "focus on the github session" instead of memorizing random codes.

**Problem it solves:** When running 10+ sessions, nobody can remember which random ID is which. The AI agent wastes tokens repeating meaningless IDs. Names make everything readable instantly.

**Relatable analogy:** It's like browser tabs showing the site favicon and title instead of just "Tab 1, Tab 2, Tab 3."

---

### 3. HUD: Click Ripple + Scroll-to-Target
**What:** When the AI agent clicks something, a green ripple animates at the click point. Before each click, the page scrolls to bring the target element into view so you can see what the agent is about to interact with. That's it -- no borders, no status bar, no cursor overlay. The HUD was stripped to only the feedback that matters.

**Problem it solves:** Watching an AI agent work is disorienting when you can't see what it's doing. The ripple and scroll-to-target make agent actions visible without cluttering the viewport with chrome that gets in the way at tile sizes.

**The visual:** An agent clicks a "Submit" button -- the page smoothly scrolls to reveal the button, then a green ripple expands from the click point. Clean, minimal, informative.

---

### 4. Human Intervention Alert (@..@ the Frog)
**What:** When a session hits something it can't handle -- a captcha, a login page, a "verify you're human" challenge -- a red persistent top bar (32px, #ef4444) appears at the top of the window with reason text, the tab title changes to "NEEDS HUMAN", and a gentle chime plays. Handle the issue, and the agent resumes automatically.

**Problem it solves:** The #1 frustration with multi-session automation: a window pops up needing your help (captcha, login) but you don't notice, don't know which window, and don't know if you should act or wait. Now the tool tells you exactly when and where you're needed.

**Relatable analogy:** It's like a car's lane departure warning — the system handles driving, but taps you on the shoulder when it needs a human decision.

**Brand moment:** The `@..@` frog eyes are Leapfrog's mascot. They blink every 5 seconds. It's charming, not annoying.

---

### 5. Click Ripple + Scroll-to-Target
**What:** When the AI agent clicks something in a headed browser, a green ripple animation appears at the click point -- like the touch feedback on a phone screen. Before each click, scrollIntoView brings the target element on-screen so you can see what the agent is about to interact with. When YOU take over the browser manually, the effects disappear so they don't interfere.

**Problem it solves:** Watching an AI agent work in a browser is disorienting -- the page changes but you can't see what the agent did. The ripple and scroll-to-target make agent actions visible in real-time.

**The visual:** The page smoothly scrolls to reveal a "Login" button, then a satisfying green ripple expands from the click point. You always see what the agent is doing, even on long pages.

---

### 6. Sidecar Control API
**What:** A small control server runs alongside Leapfrog that lets you send commands via simple URLs: focus a specific session, zoom into one window, restore the grid, take screenshots, or emergency-stop all sessions. Works with keyboard shortcuts, Alfred/Raycast, shell scripts, or just curl.

**Problem it solves:** Leapfrog is controlled by the AI agent — there's no way for the human to interact with the tiled windows directly. The sidecar gives the human a remote control.

**Relatable analogy:** It's the remote control for your browser command center. Point, click, zoom in, zoom out.

---

### 7. Pinned Sessions
**What:** Mark a session as "pinned" and it won't be automatically closed when idle. Normal sessions time out after 30 minutes of inactivity. Pinned sessions stay alive until you explicitly close them.

**Problem it solves:** You have a session logged into Gmail that you want available all day, but Leapfrog keeps killing it for being idle. Pin it, forget about it, it's always there.

---

### 8. Auto-Dismiss Cookie Consent
**What:** Leapfrog automatically detects and dismisses cookie consent popups (OneTrust, CookieBot, TrustArc, and other common frameworks). No more "Accept All" blocking every single page load.

**Problem it solves:** Every EU website (and most US sites now) shows a cookie consent popup that blocks the page. When you're automating across dozens of sites, clicking "Accept" on every single one is maddening. Leapfrog handles it silently.

**Relatable analogy:** It's like having an assistant who automatically closes every "we use cookies" popup before you even see it.

---

### 9. Session Recording & Tracing
**What:** Every session can optionally record a full trace (DOM snapshots, screenshots, network activity) and/or a video screencast with auto-annotated clicks. Export the trace as a ZIP file viewable in Playwright's trace viewer — a full timeline of everything the agent did.

**Problem it solves:** "What happened?" When a session fails or produces unexpected results, you currently have no way to replay what the agent did. Traces give you time-travel debugging — scrub through the timeline and see the exact page state at each step.

**Relatable analogy:** It's the flight recorder (black box) for your browser sessions. When something goes wrong, you can replay exactly what happened.

---

### 10. Sound & Notifications
**What:** A single, warm chime sound plays when Leapfrog needs your attention (human intervention required). A macOS notification also appears. That's it — one sound for the one thing that matters. No constant pinging, no notification fatigue.

**Problem it solves:** You're working in another app while 6 sessions run. One hits a captcha. How do you know? The chime tells you — look up, handle it, go back to what you were doing.

**Design philosophy:** We tested dozens of sounds. No pings, no beeps, no system sounds. A custom warm marimba chime. Subtle enough for an office, noticeable enough to catch your attention.

---

### 11. Self-Improving Intelligence (Closed Loop)
**What:** Leapfrog remembers what it learns about each website -- and now feeds that learned data back into navigation decisions. Visit github.com 50 times? Leapfrog knows the optimal wait strategy, which anti-bot measures are needed, how to dismiss their specific popups, and which API endpoints power the page. Learned data actively drives wait strategy selection, consent selector matching, and stealth tier escalation. Every visit makes the next visit faster, cheaper, and more reliable.

**Problem it solves:** Today, every session starts from zero -- same default settings, same timeouts, same stealth level, regardless of how many times you've visited a site. The self-improvement loop means Leapfrog gets smarter with use, not just more used. This is not just recording observations -- it is a functional closed loop where learned data feeds into real navigation decisions.

**The flywheel:**
- Visit #1: Default everything. Full stealth. Full page scan.
- Visit #50: Optimal settings. 40% fewer tokens. Known API endpoints. Instant cookie dismissal. Zero configuration.

**Relatable analogy:** It's like how your phone keyboard learns your typing patterns. Leapfrog learns your browsing patterns -- and types faster because of it.

---

## For the Website

### Hero Section Update
**Before:** "Multi-session browser MCP for AI agents. 19 tools. 15 parallel sessions."  
**After:** "The command center for AI browser agents. Auto-tiling windows. Smart intervention alerts. Self-improving intelligence. 15 parallel sessions that get smarter with every visit."

### Feature Grid (suggested)
| Icon | Feature | One-liner |
|------|---------|-----------|
| 🪟 | Auto Tiling | Windows arrange themselves. Add, remove, reflow. |
| 🐸 | Smart Alerts | @..@ tells you exactly when and where you're needed. |
| 🎨 | Live HUD | Click ripple + scroll-to-target on agent actions. |
| 🏷️ | Auto Naming | Sessions name themselves. No more random IDs. |
| 🧠 | Self-Improving | Gets faster and smarter with every visit. |
| 🍪 | Cookie Crusher | Auto-dismisses consent popups across the web. |
| 🎬 | Session Replay | Full trace + video recording of everything the agent did. |
| 🎮 | Remote Control | Sidecar API for keyboard shortcuts and quick actions. |

### Competitive Positioning Update
**Before:** "10x fewer tokens than Playwright MCP"  
**Add:** "And it gets smarter every time. Visit #50 uses 31x fewer tokens than Playwright MCP on the same page."

---

## For the Video

The demo sequence that shows everything:

1. **Empty screen** → run Leapfrog → 6 windows tile automatically (tiling)
2. **Each window gets a name** (auto-naming)
3. **Agent works** — pages scroll to targets, green ripples on each click (click ripple + scroll-to-target)
4. **One window hits a captcha** → red top bar appears, tab title changes, chime plays (intervention)
5. **User solves captcha** → red bar clears, agent resumes (reflow)
6. **All sessions complete** → one final chime (completion)
7. **Text overlay:** "Visit #1: 1,550 tokens. Visit #50: 487 tokens. It learns."

That's a 30-60 second clip that tells the entire v0.6.0 story.
