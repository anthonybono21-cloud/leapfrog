// ─── Role classification ───────────────────────────────────────────────────
const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "listbox",
    "option",
    "menuitem",
    "tab",
    "switch",
    "slider",
    "spinbutton",
    "searchbox",
    "menuitemcheckbox",
    "menuitemradio",
]);
const STRUCTURAL_ROLES = new Set(["heading"]);
const SKIP_ROLES = new Set(["none", "presentation", "generic"]);
/** Form input roles that must NEVER be suppressed by stable element filtering. */
const FORM_INPUT_ROLES = new Set([
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "searchbox",
    "spinbutton",
    "slider",
    "switch",
    "listbox",
]);
// ─── YAML parser ───────────────────────────────────────────────────────────
/**
 * Parses Playwright's YAML aria snapshot (mode: "ai") into structured nodes.
 *
 * Example input:
 *   - navigation "Main" [ref=e1]:
 *     - link "Home" [ref=e2]
 *     - link "About" [ref=e3]
 *   - heading "Welcome" [level=1] [ref=e4]
 *   - textbox "Search" [ref=e5]: "current value"
 */
function parseAriaYaml(yaml) {
    const lines = yaml.split("\n");
    const roots = [];
    // Stack tracks (depth, node) to build parent-child relationships
    const stack = [];
    for (const rawLine of lines) {
        if (!rawLine.trim())
            continue;
        // Measure indent: count leading spaces, each 2 spaces = 1 level
        const stripped = rawLine.replace(/^\s*-\s*/, "");
        const dashMatch = rawLine.match(/^(\s*)-\s*/);
        if (!dashMatch)
            continue;
        const indent = dashMatch[1].length;
        const depth = indent / 2;
        const parsed = parseLine(stripped, depth);
        if (!parsed)
            continue;
        // Pop stack until we find the parent
        while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
            stack.pop();
        }
        if (stack.length > 0) {
            stack[stack.length - 1].node.children.push(parsed);
        }
        else {
            roots.push(parsed);
        }
        stack.push({ depth, node: parsed });
    }
    return roots;
}
// Match: role "name" [attr=val] [ref=eN]: "value"
// Or:    role [attr=val] [ref=eN]
// Or:    text: "some text"   (static text nodes)
const LINE_RE = /^(\w[\w-]*)(?:\s+"([^"]*)")?(?:\s+(.+?))?(?:\s*:\s*"([^"]*)")?$/;
const ATTR_RE = /\[(\w+)=([^\]]*)\]/g;
function parseLine(line, depth) {
    // Handle "- text: ..." lines (static text — skip)
    if (line.startsWith("text:") || line.startsWith('"'))
        return null;
    const match = line.match(LINE_RE);
    if (!match)
        return null;
    const role = match[1];
    const name = match[2] ?? "";
    const attrStr = match[3] ?? "";
    const value = match[4];
    const attrs = new Map();
    let ariaRef = "";
    // Extract bracketed attributes
    let attrMatch;
    ATTR_RE.lastIndex = 0;
    while ((attrMatch = ATTR_RE.exec(attrStr)) !== null) {
        const key = attrMatch[1];
        const val = attrMatch[2];
        if (key === "ref") {
            ariaRef = val;
        }
        else {
            attrs.set(key, val);
        }
    }
    // Also check for ref in the rest of the line (sometimes after the colon section)
    if (!ariaRef) {
        const refInLine = line.match(/\[ref=([^\]]+)\]/);
        if (refInLine)
            ariaRef = refInLine[1];
    }
    if (value !== undefined) {
        attrs.set("value", value);
    }
    return { role, name, ariaRef, attrs, depth, children: [] };
}
// ─── Filtering + output ───────────────────────────────────────────────────
function shouldKeep(node, interactiveOnly) {
    if (INTERACTIVE_ROLES.has(node.role))
        return true;
    if (STRUCTURAL_ROLES.has(node.role))
        return true;
    if (node.role === "img" && node.name)
        return true;
    if (!interactiveOnly) {
        if (SKIP_ROLES.has(node.role) && !node.name)
            return false;
        if (node.role === "group" && !node.name)
            return false;
        return !!node.name;
    }
    if (node.role === "group" && node.name)
        return true;
    return false;
}
/**
 * Build a case-insensitive fingerprint for a parsed node.
 * Format: "role:lowercased_name" — e.g. "link:home", "button:sign in".
 */
export function elementFingerprint(node) {
    return `${node.role}:${node.name.toLowerCase()}`;
}
function formatLine(ref, node, depth) {
    const indent = "  ".repeat(depth);
    const parts = [indent, ref, " ", node.role];
    if (node.name) {
        parts.push(` "${node.name}"`);
    }
    // Heading level
    if (node.role === "heading" && node.attrs.has("level")) {
        parts.push(` (h${node.attrs.get("level")})`);
    }
    // State attributes
    const value = node.attrs.get("value");
    if (value !== undefined && value !== "") {
        parts.push(` value="${value}"`);
    }
    const checked = node.attrs.get("checked");
    if (checked === "true") {
        parts.push(" checked");
    }
    else if (checked === "mixed") {
        parts.push(" mixed");
    }
    if (node.attrs.get("disabled") === "true") {
        parts.push(" disabled");
    }
    const expanded = node.attrs.get("expanded");
    if (expanded === "true") {
        parts.push(" expanded");
    }
    else if (expanded === "false") {
        parts.push(" collapsed");
    }
    return parts.join("");
}
function buildSelector(node) {
    // Best option: use Playwright's aria-ref selector (fast, exact match)
    if (node.ariaRef) {
        return `aria-ref=${node.ariaRef}`;
    }
    // Fallback: role-based selector
    if (node.name) {
        const escaped = node.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `role=${node.role}[name="${escaped}"]`;
    }
    return `role=${node.role}`;
}
function walkTree(node, depth, ctx) {
    if (ctx.truncated)
        return;
    if (depth > ctx.maxDepth)
        return;
    const keep = shouldKeep(node, ctx.interactiveOnly);
    if (keep) {
        ctx.totalBeforeSuppression++;
        const fp = elementFingerprint(node);
        // Check suppression: skip stable elements unless they're form inputs
        const isSuppressed = ctx.suppressFingerprints &&
            ctx.suppressFingerprints.has(fp) &&
            !FORM_INPUT_ROLES.has(node.role);
        if (isSuppressed) {
            ctx.suppressedCount++;
            // Still recurse into children — they might not be stable
            for (const child of node.children) {
                if (ctx.truncated)
                    break;
                walkTree(child, depth, ctx);
            }
            return;
        }
        ctx.session.refCounter++;
        const ref = `@e${ctx.session.refCounter}`;
        const selector = buildSelector(node);
        ctx.session.refMap.set(ref, selector);
        // Record fingerprint for selector healing — maps @eN → "role:name"
        if (ctx.session.refFingerprints) {
            ctx.session.refFingerprints.set(ref, fp);
        }
        // Track fingerprint → selector for domain knowledge recording
        ctx.elementMappings.push({ fingerprint: fp, selector });
        const line = formatLine(ref, node, depth);
        const lineLen = line.length + 1;
        if (ctx.maxChars > 0 && ctx.charCount + lineLen > ctx.maxChars) {
            ctx.truncated = true;
            return;
        }
        ctx.lines.push(line);
        ctx.charCount += lineLen;
        ctx.nodeCount++;
        ctx.fingerprints.push(fp);
    }
    // Recurse — if we skipped this node, children bubble up to the same depth
    const childDepth = keep ? depth + 1 : depth;
    for (const child of node.children) {
        if (ctx.truncated)
            break;
        walkTree(child, childDepth, ctx);
    }
}
/** Lightweight counting pass — no ref assignment, no line building. */
function walkTreeCount(node, depth, ctx) {
    if (depth > ctx.maxDepth)
        return;
    const keep = shouldKeep(node, ctx.interactiveOnly);
    if (keep) {
        ctx.totalBeforeSuppression++;
        ctx.fingerprints.push(elementFingerprint(node));
    }
    const childDepth = keep ? depth + 1 : depth;
    for (const child of node.children) {
        walkTreeCount(child, childDepth, ctx);
    }
}
// ─── Engine ────────────────────────────────────────────────────────────────
export class SnapshotEngine {
    async snapshot(page, session, opts) {
        const interactiveOnly = opts?.interactiveOnly ?? true;
        const maxDepth = opts?.maxDepth ?? 20;
        const maxChars = opts?.maxChars ?? 0;
        // Don't clear refMap — refs accumulate across snapshots so that
        // session_export can resolve historical @eN refs to stable selectors.
        // refCounter always increments, so there are no key collisions.
        // navGeneration handles stale-ref detection for the act tool.
        let yaml;
        try {
            if (opts?.selector) {
                // Scoped snapshot via locator
                yaml = await page
                    .locator(opts.selector)
                    .first()
                    .ariaSnapshot({ mode: "ai" });
            }
            else {
                // Full page snapshot
                yaml = await page.ariaSnapshot({ mode: "ai" });
            }
        }
        catch {
            return {
                text: "(page not loaded or empty)",
                refs: session.refMap,
                nodeCount: 0,
            };
        }
        if (!yaml || !yaml.trim()) {
            return {
                text: "(page not loaded or empty)",
                refs: session.refMap,
                nodeCount: 0,
            };
        }
        // Parse YAML into structured nodes
        const roots = parseAriaYaml(yaml);
        // Build effective suppress set, respecting the 60% floor:
        // If suppressing would remove more than 60% of elements, limit to highest-usage only.
        // We do a two-pass approach when suppression is requested:
        //   Pass 1: count total keepable elements (no suppression)
        //   Pass 2: apply suppression, capped at 60% of total
        let effectiveSuppress = opts?.suppressFingerprints;
        if (effectiveSuppress && effectiveSuppress.size > 0) {
            // Pass 1: count total keepable (without suppression)
            const countCtx = {
                session: { ...session, refCounter: session.refCounter, refMap: new Map() },
                interactiveOnly,
                maxDepth,
                lines: [],
                nodeCount: 0,
                charCount: 0,
                maxChars: 0,
                truncated: false,
                fingerprints: [],
                elementMappings: [],
                suppressedCount: 0,
                totalBeforeSuppression: 0,
            };
            for (const root of roots) {
                walkTreeCount(root, 0, countCtx);
            }
            const totalKeepable = countCtx.totalBeforeSuppression;
            const maxSuppressable = Math.floor(totalKeepable * 0.6);
            // Count how many would be suppressed
            let wouldSuppress = 0;
            for (const fp of countCtx.fingerprints) {
                if (effectiveSuppress.has(fp) && !FORM_INPUT_ROLES.has(fp.split(":")[0])) {
                    wouldSuppress++;
                }
            }
            if (wouldSuppress > maxSuppressable) {
                // Need to limit — but we don't have seenCount here.
                // The caller should pre-limit. As a safety net, just clear suppression.
                // In practice, the caller (index.ts) handles the 60% cap with seenCount ordering.
                effectiveSuppress = undefined;
            }
        }
        // Walk and filter
        const ctx = {
            session,
            interactiveOnly,
            maxDepth,
            lines: [],
            nodeCount: 0,
            charCount: 0,
            maxChars,
            truncated: false,
            fingerprints: [],
            elementMappings: [],
            suppressFingerprints: effectiveSuppress,
            suppressedCount: 0,
            totalBeforeSuppression: 0,
        };
        for (const root of roots) {
            if (ctx.truncated)
                break;
            walkTree(root, 0, ctx);
        }
        let text = ctx.lines.join("\n");
        if (ctx.truncated) {
            text += "\n... (truncated)";
        }
        if (ctx.nodeCount === 0) {
            text = "(no interactive elements found)";
        }
        const elementsSuppressed = ctx.suppressedCount;
        const elementsTotal = ctx.totalBeforeSuppression;
        return {
            text,
            refs: session.refMap,
            nodeCount: ctx.nodeCount,
            fingerprints: ctx.fingerprints,
            elementMappings: ctx.elementMappings,
            elementsTotal,
            elementsSuppressed,
            tokensSaved: elementsSuppressed > 0 ? elementsSuppressed * 30 : 0,
        };
    }
}
export default SnapshotEngine;
