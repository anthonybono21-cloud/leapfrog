import { describe, it, expect, beforeEach } from "vitest";
import {
  HarnessIntelligence,
  djb2,
  formatHarnessOutput,
  type ActionOutcome,
} from "../harness-intelligence.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

const SNAPSHOT_A = `@e1 navigation "Main Nav"
  @e2 link "Home"
  @e3 link "Products"
@e4 heading "Welcome"
@e5 button "Get Started"`;

const SNAPSHOT_B = `@e1 navigation "Main Nav"
  @e2 link "Home"
  @e3 link "Products"
@e4 heading "Welcome"
@e5 button "Get Started"
@e6 button "Confirm"`;

const SNAPSHOT_CAPTCHA = `@e1 heading "Checking your browser"
@e2 text "Please complete the CAPTCHA below"
@e3 button "Verify you're human"`;

const SNAPSHOT_CLOUDFLARE = `@e1 heading "Just a moment"
@e2 text "Checking if the site connection is secure"
@e3 text "cloudflare"`;

const URL_A = "https://example.com/page-a";
const URL_B = "https://example.com/page-b";

function recordAction(
  sessionId: string,
  opts: {
    actionType?: string;
    target?: string;
    value?: string;
    preUrl?: string;
    postUrl?: string;
    preSnapshot?: string;
    postSnapshot?: string;
    error?: string;
  } = {},
) {
  const preUrl = opts.preUrl ?? URL_A;
  const postUrl = opts.postUrl ?? preUrl;
  const preSnap = opts.preSnapshot ?? SNAPSHOT_A;
  const postSnap = opts.postSnapshot ?? SNAPSHOT_A;

  HarnessIntelligence.capturePreState(sessionId, preUrl, preSnap);
  return HarnessIntelligence.analyzePostAction(
    sessionId,
    opts.actionType ?? "click",
    opts.target,
    opts.value,
    postUrl,
    postSnap,
    opts.error,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("HarnessIntelligence", () => {
  beforeEach(() => {
    HarnessIntelligence.clearSession("s1");
    HarnessIntelligence.clearSession("s2");
  });

  // ─── Outcome Classifier ─────────────────────────────────────────────

  describe("Outcome Classifier", () => {
    // 1. URL change detected as NAVIGATION
    it("classifies URL change as NAVIGATION", () => {
      const state = recordAction("s1", {
        preUrl: URL_A,
        postUrl: URL_B,
        postSnapshot: SNAPSHOT_B,
      });
      expect(state.outcome).toBe("NAVIGATION");
      expect(state.outcomeDetail).toContain(URL_A);
      expect(state.outcomeDetail).toContain(URL_B);
    });

    // 2. Identical snapshot hash → SILENT_CLICK
    it("classifies identical snapshot as SILENT_CLICK", () => {
      const state = recordAction("s1", {
        preSnapshot: SNAPSHOT_A,
        postSnapshot: SNAPSHOT_A,
      });
      expect(state.outcome).toBe("SILENT_CLICK");
      expect(state.outcomeDetail).toContain("No DOM changes");
    });

    // 3. Different hash with normal changes → SUCCESS
    it("classifies DOM change as SUCCESS", () => {
      const state = recordAction("s1", {
        preSnapshot: SNAPSHOT_A,
        postSnapshot: SNAPSHOT_B,
      });
      expect(state.outcome).toBe("SUCCESS");
      expect(state.outcomeDetail).toContain("DOM changed");
    });

    // 4. Different hash with "captcha" in snapshot → BLOCKED
    it("classifies captcha page as BLOCKED", () => {
      const state = recordAction("s1", {
        preSnapshot: SNAPSHOT_A,
        postSnapshot: SNAPSHOT_CAPTCHA,
      });
      expect(state.outcome).toBe("BLOCKED");
      expect(state.outcomeDetail).toContain("Anti-bot");
    });

    it("classifies cloudflare page as BLOCKED", () => {
      const state = recordAction("s1", {
        preSnapshot: SNAPSHOT_A,
        postSnapshot: SNAPSHOT_CLOUDFLARE,
      });
      expect(state.outcome).toBe("BLOCKED");
    });

    // 5. Error string provided → ERROR
    it("classifies error as ERROR", () => {
      const state = recordAction("s1", {
        error: "Element not found",
      });
      expect(state.outcome).toBe("ERROR");
      expect(state.outcomeDetail).toBe("Element not found");
    });

    // 6. No pre-state captured → defaults to SUCCESS
    it("defaults to SUCCESS when no pre-state was captured", () => {
      // Call analyzePostAction without calling capturePreState first
      const state = HarnessIntelligence.analyzePostAction(
        "s1",
        "click",
        "@e1",
        undefined,
        URL_A,
        SNAPSHOT_A,
      );
      expect(state.outcome).toBe("SUCCESS");
      expect(state.outcomeDetail).toContain("no pre-state");
    });
  });

  // ─── Loop Detector ──────────────────────────────────────────────────

  describe("Loop Detector", () => {
    // 7. Same element clicked 3x → same-element warning
    it("detects same element clicked 3 times", () => {
      recordAction("s1", { target: "@e5" });
      recordAction("s1", { target: "@e5" });
      const state = recordAction("s1", { target: "@e5" });

      expect(state.loopWarning).toBeDefined();
      expect(state.loopWarning!.type).toBe("same-element");
      expect(state.loopWarning!.count).toBeGreaterThanOrEqual(3);
      expect(state.loopWarning!.message).toContain("@e5");
      expect(state.loopWarning!.suggestion).toBeTruthy();
    });

    // 8. Same URL navigated 3x → same-url warning
    it("detects same URL navigated 3 times", () => {
      recordAction("s1", {
        preUrl: URL_A,
        postUrl: URL_B,
        postSnapshot: SNAPSHOT_B,
      });
      recordAction("s1", {
        preUrl: URL_B,
        postUrl: URL_A,
        postSnapshot: SNAPSHOT_A,
      });
      recordAction("s1", {
        preUrl: URL_A,
        postUrl: URL_B,
        postSnapshot: SNAPSHOT_B,
      });
      recordAction("s1", {
        preUrl: URL_B,
        postUrl: URL_A,
        postSnapshot: SNAPSHOT_A,
      });
      const state = recordAction("s1", {
        preUrl: URL_A,
        postUrl: URL_B,
        postSnapshot: SNAPSHOT_B,
      });

      // URL_B navigated to 3 times
      expect(state.loopWarning).toBeDefined();
      // Could be same-url or ping-pong — both are valid detections
      expect(["same-url", "ping-pong"]).toContain(state.loopWarning!.type);
    });

    // 9. A→B→A→B URL pattern → ping-pong warning
    it("detects ping-pong URL pattern", () => {
      recordAction("s1", {
        preUrl: URL_A,
        postUrl: URL_B,
        postSnapshot: SNAPSHOT_B,
      });
      recordAction("s1", {
        preUrl: URL_B,
        postUrl: URL_A,
        postSnapshot: SNAPSHOT_A,
      });
      recordAction("s1", {
        preUrl: URL_A,
        postUrl: URL_B,
        postSnapshot: SNAPSHOT_B,
      });
      const state = recordAction("s1", {
        preUrl: URL_B,
        postUrl: URL_A,
        postSnapshot: SNAPSHOT_A,
      });

      expect(state.loopWarning).toBeDefined();
      expect(state.loopWarning!.type).toBe("ping-pong");
      expect(state.loopWarning!.count).toBe(4);
    });

    // 10. 2 repetitions (below threshold) → no warning
    it("does not warn with only 2 repetitions", () => {
      recordAction("s1", { target: "@e5" });
      const state = recordAction("s1", { target: "@e5" });

      expect(state.loopWarning).toBeUndefined();
    });

    // 11. Different elements clicked → no warning
    it("does not warn when different elements are clicked", () => {
      recordAction("s1", { target: "@e1" });
      recordAction("s1", { target: "@e2" });
      const state = recordAction("s1", { target: "@e3" });

      expect(state.loopWarning).toBeUndefined();
    });
  });

  // ─── Stuck Detector ─────────────────────────────────────────────────

  describe("Stuck Detector", () => {
    // 12. 5 actions with same snapshot hash → stuck warning
    it("detects 5 consecutive static actions as stuck", () => {
      for (let i = 0; i < 4; i++) {
        recordAction("s1", { target: `@e${i}` });
      }
      const state = recordAction("s1", { target: "@e4" });

      expect(state.stuckWarning).toBeDefined();
      expect(state.stuckWarning!.stuckActions).toBe(5);
      expect(state.stuckWarning!.message).toContain("static");
      expect(state.stuckWarning!.message).toContain("5");
      expect(state.stuckWarning!.suggestions.length).toBeGreaterThan(0);
    });

    // 13. 4 actions (below threshold) → no warning
    it("does not warn with only 4 static actions", () => {
      for (let i = 0; i < 3; i++) {
        recordAction("s1", { target: `@e${i}` });
      }
      const state = recordAction("s1", { target: "@e3" });

      expect(state.stuckWarning).toBeUndefined();
    });

    // 14. Mixed changing/not-changing → resets counter
    it("resets stuck counter when DOM changes", () => {
      // 3 static actions
      recordAction("s1", { target: "@e1" });
      recordAction("s1", { target: "@e2" });
      recordAction("s1", { target: "@e3" });

      // One action that changes the DOM
      recordAction("s1", {
        target: "@e4",
        preSnapshot: SNAPSHOT_A,
        postSnapshot: SNAPSHOT_B,
      });

      // 3 more static (using SNAPSHOT_B as both pre and post)
      recordAction("s1", {
        target: "@e5",
        preSnapshot: SNAPSHOT_B,
        postSnapshot: SNAPSHOT_B,
      });
      recordAction("s1", {
        target: "@e6",
        preSnapshot: SNAPSHOT_B,
        postSnapshot: SNAPSHOT_B,
      });
      const state = recordAction("s1", {
        target: "@e7",
        preSnapshot: SNAPSHOT_B,
        postSnapshot: SNAPSHOT_B,
      });

      // Only 3 consecutive static after the change — below threshold
      expect(state.stuckWarning).toBeUndefined();
    });

    // 15. Suggestions include "scroll" when no scroll attempted
    it("suggests scrolling when no scroll has been attempted", () => {
      for (let i = 0; i < 4; i++) {
        recordAction("s1", { actionType: "click", target: `@e${i}` });
      }
      const state = recordAction("s1", {
        actionType: "click",
        target: "@e4",
      });

      expect(state.stuckWarning).toBeDefined();
      const scrollSuggestion = state.stuckWarning!.suggestions.find((s) =>
        s.toLowerCase().includes("scroll"),
      );
      expect(scrollSuggestion).toBeDefined();
    });

    it("does not suggest scrolling when scrolls were attempted", () => {
      for (let i = 0; i < 4; i++) {
        recordAction("s1", { actionType: "scroll", target: undefined });
      }
      const state = recordAction("s1", {
        actionType: "scroll",
        target: undefined,
      });

      expect(state.stuckWarning).toBeDefined();
      const scrollSuggestion = state.stuckWarning!.suggestions.find((s) =>
        s.toLowerCase().includes("scroll"),
      );
      expect(scrollSuggestion).toBeUndefined();
    });
  });

  // ─── Action History ─────────────────────────────────────────────────

  describe("Action History", () => {
    // 16. Records actions in order
    it("records actions in chronological order", () => {
      recordAction("s1", { target: "@e1", actionType: "click" });
      recordAction("s1", {
        target: "@e2",
        actionType: "fill",
        value: "hello",
      });
      recordAction("s1", { target: "@e3", actionType: "click" });

      const history = HarnessIntelligence.getHistory("s1");
      expect(history).toHaveLength(3);
      expect(history[0].actionType).toBe("click");
      expect(history[0].target).toBe("@e1");
      expect(history[1].actionType).toBe("fill");
      expect(history[1].value).toBe("hello");
      expect(history[2].actionType).toBe("click");
      expect(history[2].target).toBe("@e3");
    });

    // 17. Ring buffer caps at 50
    it("caps history at 50 entries", () => {
      for (let i = 0; i < 60; i++) {
        recordAction("s1", { target: `@e${i}` });
      }

      const history = HarnessIntelligence.getHistory("s1");
      expect(history).toHaveLength(50);
      // The earliest entries (0-9) should have been evicted
      // The last entry should be from the 60th action
      expect(history[history.length - 1].target).toBe("@e59");
    });

    // 18. getHistory returns most recent N
    it("getHistory with limit returns most recent N entries", () => {
      for (let i = 0; i < 10; i++) {
        recordAction("s1", { target: `@e${i}` });
      }

      const last3 = HarnessIntelligence.getHistory("s1", 3);
      expect(last3).toHaveLength(3);
      expect(last3[0].target).toBe("@e7");
      expect(last3[1].target).toBe("@e8");
      expect(last3[2].target).toBe("@e9");
    });

    it("getHistory returns empty array for unknown session", () => {
      expect(HarnessIntelligence.getHistory("unknown")).toEqual([]);
    });

    // 19. clearSession removes all state
    it("clearSession removes all state", () => {
      recordAction("s1", { target: "@e1" });
      recordAction("s1", { target: "@e2" });
      expect(HarnessIntelligence.getHistory("s1")).toHaveLength(2);

      HarnessIntelligence.clearSession("s1");
      expect(HarnessIntelligence.getHistory("s1")).toHaveLength(0);
    });
  });

  // ─── Integration ────────────────────────────────────────────────────

  describe("Integration", () => {
    // 20. Full flow: capturePreState → analyzePostAction → all subsystems fire
    it("full flow triggers all subsystems correctly", () => {
      // Build up enough history for stuck detection
      for (let i = 0; i < 4; i++) {
        HarnessIntelligence.capturePreState("s1", URL_A, SNAPSHOT_A);
        HarnessIntelligence.analyzePostAction(
          "s1",
          "click",
          "@e5",
          undefined,
          URL_A,
          SNAPSHOT_A,
        );
      }

      // 5th identical action should trigger both loop and stuck
      HarnessIntelligence.capturePreState("s1", URL_A, SNAPSHOT_A);
      const state = HarnessIntelligence.analyzePostAction(
        "s1",
        "click",
        "@e5",
        undefined,
        URL_A,
        SNAPSHOT_A,
      );

      expect(state.outcome).toBe("SILENT_CLICK");
      expect(state.loopWarning).toBeDefined();
      expect(state.stuckWarning).toBeDefined();
      expect(state.stuckWarning!.stuckActions).toBe(5);

      // History should have 5 entries
      const history = HarnessIntelligence.getHistory("s1");
      expect(history).toHaveLength(5);
      expect(history.every((r) => r.outcome === "SILENT_CLICK")).toBe(true);
    });

    // 21. Multiple sessions don't interfere
    it("isolates state between sessions", () => {
      // Session 1: build up 5 static actions
      for (let i = 0; i < 5; i++) {
        recordAction("s1", { target: "@e1" });
      }

      // Session 2: single action
      const s2State = recordAction("s2", {
        preSnapshot: SNAPSHOT_A,
        postSnapshot: SNAPSHOT_B,
        target: "@e1",
      });

      // s2 should have SUCCESS, no warnings
      expect(s2State.outcome).toBe("SUCCESS");
      expect(s2State.loopWarning).toBeUndefined();
      expect(s2State.stuckWarning).toBeUndefined();

      // s1 history is 5, s2 history is 1
      expect(HarnessIntelligence.getHistory("s1")).toHaveLength(5);
      expect(HarnessIntelligence.getHistory("s2")).toHaveLength(1);

      // Clearing s1 does not affect s2
      HarnessIntelligence.clearSession("s1");
      expect(HarnessIntelligence.getHistory("s1")).toHaveLength(0);
      expect(HarnessIntelligence.getHistory("s2")).toHaveLength(1);
    });
  });

  // ─── Diagnose ───────────────────────────────────────────────────────

  describe("diagnose", () => {
    it("returns loop/stuck status without recording", () => {
      // Build stuck state
      for (let i = 0; i < 5; i++) {
        recordAction("s1", { target: "@e1" });
      }

      const diag = HarnessIntelligence.diagnose("s1");
      expect(diag.loopWarning).toBeDefined();
      expect(diag.stuckWarning).toBeDefined();

      // History didn't grow from diagnose call
      expect(HarnessIntelligence.getHistory("s1")).toHaveLength(5);
    });

    it("returns no warnings for unknown session", () => {
      const diag = HarnessIntelligence.diagnose("unknown");
      expect(diag.loopWarning).toBeUndefined();
      expect(diag.stuckWarning).toBeUndefined();
    });
  });

  // ─── formatHarnessOutput ────────────────────────────────────────────

  describe("formatHarnessOutput", () => {
    it("formats basic SUCCESS output", () => {
      const output = formatHarnessOutput({
        outcome: "SUCCESS",
        outcomeDetail: "DOM changed after action",
      });
      expect(output).toContain("--- Harness Intelligence ---");
      expect(output).toContain("SUCCESS");
      expect(output).toContain("DOM changed");
    });

    it("formats output with loop warning", () => {
      const output = formatHarnessOutput({
        outcome: "SILENT_CLICK",
        outcomeDetail: "No DOM changes detected after action",
        loopWarning: {
          type: "same-element",
          message: "You've clicked @e14 three times.",
          count: 3,
          suggestion: "Try a different element.",
        },
      });
      expect(output).toContain("Loop detected");
      expect(output).toContain("@e14");
    });

    it("formats output with stuck warning and suggestions", () => {
      const output = formatHarnessOutput({
        outcome: "SILENT_CLICK",
        outcomeDetail: "No DOM changes detected",
        stuckWarning: {
          stuckActions: 5,
          message: "Page appears static after 5 actions",
          suggestions: [
            "Try scrolling down",
            "Check for iframes",
          ],
        },
      });
      expect(output).toContain("Stuck");
      expect(output).toContain("static after 5 actions");
      expect(output).toContain("Try scrolling down");
      expect(output).toContain("Check for iframes");
    });
  });

  // ─── djb2 hash ──────────────────────────────────────────────────────

  describe("djb2", () => {
    it("produces consistent hash for same input", () => {
      expect(djb2("hello")).toBe(djb2("hello"));
    });

    it("produces different hashes for different input", () => {
      expect(djb2("hello")).not.toBe(djb2("world"));
    });

    it("returns a hex string", () => {
      expect(djb2("test")).toMatch(/^[0-9a-f]+$/);
    });
  });

  // ─── ActionRecord fields ────────────────────────────────────────────

  describe("ActionRecord fields", () => {
    it("records all fields correctly", () => {
      const state = recordAction("s1", {
        actionType: "fill",
        target: "@e3",
        value: "search query",
        preUrl: URL_A,
        postUrl: URL_A,
        preSnapshot: SNAPSHOT_A,
        postSnapshot: SNAPSHOT_B,
      });

      const history = HarnessIntelligence.getHistory("s1");
      expect(history).toHaveLength(1);

      const record = history[0];
      expect(record.actionType).toBe("fill");
      expect(record.target).toBe("@e3");
      expect(record.value).toBe("search query");
      expect(record.url).toBe(URL_A);
      expect(record.snapshotHash).toBe(djb2(SNAPSHOT_B));
      expect(record.outcome).toBe("SUCCESS");
      expect(record.timestamp).toBeGreaterThan(0);
      expect(typeof record.duration).toBe("number");
    });
  });
});
