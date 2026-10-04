// configs:pi-transcript-v1
// Display only: native components still own execution, expansion, images and state.
import { Container, stripTerminalSequences, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

const USER_SEPARATOR = new DynamicBorder(line => theme.fg("toolOutput", line));

const NATIVE_ACTIONS = {
    read: ["□", "Read"],
    edit: ["◈", "Edit"],
    write: ["◇", "Write"],
    bash: ["↯", "Run"],
    powershell: ["↯", "Run"],
    grep: ["◎", "Search"],
    find: ["⊙", "Find"],
    ls: ["▧", "List"],
};

const ACTIONS = {
    web_search: ["◎", "Web"],
    fetch_content: ["◎", "Web"],
    source_check: ["◎", "Web"],
    get_search_content: ["◎", "Web"],
    mcp: ["⌇", "MCP"],
    mcpScript: ["⋈", "Batch"],
    Agent: ["◇", "Agent"],
    get_subagent_result: ["◇", "Agent"],
    steer_subagent: ["◇", "Agent"],
    SubagentWorkflow: ["⋈", "Flow"],
    ask_user_question: ["◇", "Ask"],
    todo: ["☷", "Tasks"],
    create_goal: ["◇", "Goal"],
    intercom: ["⇄", "Chat"],
};

// Exact operation names, never a fuzzy "search" match (which could be a database).
const WEB_MCP_TOOLS = new Set([
    "web_search_exa", "web_fetch_exa", "crawling_exa", "get_code_context_exa",
    "firecrawl_search", "firecrawl_scrape", "firecrawl_crawl", "firecrawl_map",
    "tavily_search", "tavily_extract", "brave_web_search", "searxng_web_search",
    "web_search", "fetch_content",
]);

function ownedBy(component, packageName) {
    const source = component.toolDefinition?.configsTranscriptSource;
    return source === `npm:${packageName}` || source?.startsWith(`npm:${packageName}@`) === true;
}

/** Identify the requested MCP operation without parsing scripts or contacting servers. */
function toolInvocation(component) {
    const name = component.toolName;
    const args = component.args ?? {};
    if (!ownedBy(component, "pi-mcp-adapter")) return { name, args, operation: name };

    const label = component.toolDefinition?.label;
    const namespace = name.startsWith("mcp__") && label === `MCP: ${name.slice(5)}`;
    if ((name === "mcp" && !args.action || namespace) && typeof args.tool === "string") {
        const server = namespace ? name.slice(5) : plain(args.server);
        const target = server && !args.tool.includes("/") ? `${server}/${args.tool}` : args.tool;
        let forwarded = args.args ?? {};
        if (typeof forwarded === "string") {
            try {
                // Never echo malformed/oversized JSON: sensitive fields cannot be identified safely.
                forwarded = forwarded.length <= 50_000 ? JSON.parse(forwarded) : "[oversized JSON arguments]";
            } catch {
                forwarded = "[invalid JSON arguments]";
            }
        }
        return { name: target, args: forwarded, operation: args.tool.split("/").at(-1) };
    }
    // Direct registrations expose the original operation through the adapter's label.
    const operation = label?.startsWith("MCP: ") ? label.slice(5) : name;
    return { name, args, operation };
}

function toolAction(component) {
    const name = component.toolName;
    if (Object.hasOwn(NATIVE_ACTIONS, name)) return NATIVE_ACTIONS[name];
    if (ownedBy(component, "pi-web-access")) return ["◎", "Web"];
    if (ownedBy(component, "pi-mcp-adapter")) {
        const invocation = toolInvocation(component);
        const operation = invocation.operation;
        // The gateway also accepts canonical prefixed names, not only server/tool paths.
        const bare = operation.replace(/^(?:mcp__)?(?:exa|firecrawl|tavily|brave|searxng)_/, "");
        if (WEB_MCP_TOOLS.has(operation) || WEB_MCP_TOOLS.has(bare)) return ["◎", "Web"];
        if (invocation.name !== name) return ["⌇", "Tool"];
    }
    return Object.hasOwn(ACTIONS, name) ? ACTIONS[name] : ["⌇", "Tool"];
}

export const TOOL_TIMING_FIELD = "configsToolTiming";

/** Observe call latency, including preparation/hooks; never time argument streaming. */
export function startToolTiming(component, now = performance.now()) {
    if (Number.isFinite(now) && component.transcriptStartedAt === undefined
        && component.transcriptDurationMs === undefined) {
        component.transcriptStartedAt = now;
    }
}

/** Settle once. Replay and calls cancelled before execution have no start time. */
export function finishToolTiming(component, now = performance.now()) {
    const durationMs = now - component.transcriptStartedAt;
    if (component.transcriptDurationMs !== undefined || !Number.isFinite(durationMs) || durationMs < 0) return;
    component.transcriptDurationMs = durationMs;
    return { toolCallId: component.toolCallId, toolName: component.toolName, durationMs };
}

/** Read the active branch: message-only UI rebuilds omit entry-wrapper metadata. */
export function collectToolTimings(entries) {
    const timings = new Map();
    for (const entry of entries) {
        const data = entry?.[TOOL_TIMING_FIELD];
        const message = entry?.message;
        if (entry?.type !== "message" || message?.role !== "toolResult"
            || typeof data?.toolCallId !== "string" || !data.toolCallId
            || typeof data.toolName !== "string" || !data.toolName
            || data.toolCallId !== message.toolCallId || data.toolName !== message.toolName
            || !Number.isFinite(data.durationMs) || data.durationMs < 0) continue;
        timings.set(data.toolCallId, {
            toolCallId: data.toolCallId, toolName: data.toolName, durationMs: data.durationMs,
        });
    }
    return timings;
}

/** Tool arguments/output are untrusted terminal text, not pre-styled UI. */
function plain(value) {
    return typeof value === "string"
        ? stripTerminalSequences(value).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim()
        : "";
}

function sensitiveKey(key) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    return /(?:password|passwd|passphrase|secret|token|apikey|authorization|cookie|credentials?|privatekey|accesskey|accesskeyid|signature)$/.test(normalized)
        || ["auth", "headers", "env", "sig"].includes(normalized);
}

/** Redact URL credentials as well as secret query/fragment fields, including OAuth callbacks. */
function redactUrls(text) {
    return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, raw => {
        try {
            const url = new URL(raw);
            let changed = !!(url.username || url.password);
            if (changed) {
                url.username = "redacted";
                url.password = "";
            }
            for (const params of [url.searchParams, new URLSearchParams(url.hash.slice(1))]) {
                for (const key of [...params.keys()]) {
                    if (sensitiveKey(key) || ["code", "state"].includes(key.toLowerCase())) {
                        params.set(key, "[redacted]");
                        changed = true;
                    }
                }
                if (params !== url.searchParams && changed && url.hash.includes("=")) url.hash = params.toString();
            }
            return changed ? url.href : raw;
        } catch {
            return "[invalid URL]";
        }
    });
}

/** Display-only serialization: never mutate invocation arguments or evaluate script text. */
function invocationText(component, width) {
    const invocation = toolInvocation(component);
    // ponytail: bounded previews (50K expanded, 20 levels); native results/session data remain intact.
    const limit = component.expanded ? 50_000 : Math.max(256, width * 8);
    let remaining = limit;
    let truncated = false;
    const parents = new Set();
    const take = text => {
        if (text.length > remaining) truncated = true;
        const part = text.slice(0, remaining);
        remaining -= part.length;
        return part;
    };
    const render = (value, key = "", depth = 0, named = false) => {
        if (remaining <= 0 || depth > 20) {
            truncated = true;
            return "";
        }
        if (sensitiveKey(key)) return take('"[redacted]"');
        if (typeof value === "string") {
            // Redact before truncating: a cut inside URL userinfo must not expose credentials.
            return take(JSON.stringify(redactUrls(plain(value))));
        }
        if (value === null || typeof value !== "object") return take(JSON.stringify(value) ?? '"[unavailable]"');
        if (parents.has(value)) return take('"[circular]"');
        parents.add(value);
        const array = Array.isArray(value);
        const parts = [take(named ? "" : array ? "[" : "{")];
        let count = 0;
        for (const key of Object.keys(value)) {
            if (remaining <= 0) { truncated = true; break; }
            if (count++) parts.push(take(", "));
            if (!array) {
                const safeKey = plain(key);
                parts.push(take(named && /^\w+$/.test(safeKey) ? safeKey : JSON.stringify(safeKey)));
                parts.push(take(named ? "=" : ": "));
            }
            parts.push(render(value[key], key, depth + 1));
        }
        parents.delete(value);
        parts.push(take(named ? "" : array ? "]" : "}"));
        return parts.join("");
    };
    let argumentsText;
    try {
        argumentsText = render(invocation.args, "", 0, !!invocation.args
            && typeof invocation.args === "object" && !Array.isArray(invocation.args));
    } catch {
        argumentsText = "[unavailable arguments]";
    }
    return `${plain(invocation.name) || "unknown"}(${argumentsText}${truncated ? "… [arguments truncated]" : ""})`;
}

/** Narrow panes reclaim the two decorative body columns before truncating prose. */
export function transcriptPadding(base, width) {
    return Math.min(width < 80 ? 1 : Math.max(0, base + 2), Math.max(0, Math.floor((width - 2) / 2)));
}

export function speakerHeader(name, timestamp, padding, width) {
    const glyph = name === "You" ? "◆" : "●";
    const color = name === "Pi" ? "warning" : "accent";
    let text = theme.fg(color, glyph) + " " + theme.bold(theme.fg("text", name));
    if (Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())) {
        const time = new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        text += theme.fg("dim", ` · ${time}`);
    }
    return truncateToWidth(" ".repeat(Math.max(0, padding)) + text, width);
}

function targetFor(component) {
    const args = component.args ?? {};
    switch (component.toolName) {
        case "read": {
            const path = plain(args.path);
            return path + (Number.isFinite(args.offset) ? `:${args.offset}` : "");
        }
        case "edit":
        case "write": return plain(args.path);
        case "bash":
        case "powershell": return plain(args.command);
        case "grep":
        case "find": return [plain(args.pattern), plain(args.path)].filter(Boolean).join(" · ");
        case "ls": return plain(args.path) || ".";
        default: return "";
    }
}

/** Interpret only documented package metadata; never rewrite stored/model-visible results. */
function toolState(component) {
    const result = component.result;
    const details = result?.details;
    const web = ownedBy(component, "pi-web-access");
    const mcp = ownedBy(component, "pi-mcp-adapter");
    if (!result || component.isPartial) {
        const waiting = web && ["curating", "waiting-for-approval", "curator-fallback"].includes(details?.phase);
        return {
            status: component.executionStarted || result ? "◌" : "○", color: "accent",
            notice: waiting ? "Waiting for browser approval; expand for details." : "",
        };
    }
    if (result.isError || (web || mcp) && details?.error) {
        const text = result.content?.find(part => part.type === "text" && typeof part.text === "string" && part.text.trim())?.text;
        const message = plain(details?.message) || plain(details?.error?.message)
            || (web ? plain(details?.error) : "") || text?.split(/\r?\n/).find(line => plain(line))
            || plain(details?.error) || "Tool failed; expand for details.";
        // MCP auth/connection/validation feedback is actionable, not a failed execution.
        const failed = result.isError || web || ["tool_error", "call_failed", "input_required_needs_ui"].includes(details?.error)
            || details?.mode === "script" && ["timeout", "aborted", "script_error"].includes(details?.error);
        return { status: failed ? "×" : "!", color: failed ? "error" : "warning", notice: plain(message) };
    }
    if (web) {
        for (const [total, successful, unit] of [
            [details?.urlCount, details?.successful, "URLs"],
            [details?.queryCount, details?.successfulQueries, "queries"],
        ]) {
            if (Number.isSafeInteger(total) && total > 0 && Number.isSafeInteger(successful)
                && successful >= 0 && successful < total) {
                return { status: successful ? "!" : "×", color: successful ? "warning" : "error",
                    notice: `${total - successful} of ${total} ${unit} failed; expand for details.` };
            }
        }
        const errors = details?.artifact?.errors;
        if (Array.isArray(errors) && errors.length) {
            return { status: "!", color: "warning", notice: "Research includes search errors; expand for details." };
        }
    }
    if (mcp && details?.mode === "script" && Array.isArray(details.calls)) {
        const failed = details.calls.filter(call => call?.ok === false).length;
        if (failed) return { status: "!", color: "warning",
            notice: `${failed} of ${details.calls.length} MCP operations failed or unfinished; expand for details.` };
    }
    return { status: "✓", color: "muted", notice: "" };
}

/** Only native producer metadata supplies counts: no banner/filename/diff heuristics. */
function metricVariants(component) {
    if (!component.result || component.isPartial) return [];
    const duration = component.transcriptDurationMs;
    const elapsed = Number.isFinite(duration) && duration >= 0
        ? duration < 100 ? "<0.1s" : `${(duration / 1000).toFixed(1)}s`
        : "";
    const stats = toolState(component).status === "✓" ? component.result.details?.configsTranscript : undefined;
    const unit = component.toolName === "edit" ? "edits"
        : ["read", "write"].includes(component.toolName) ? "lines" : undefined;
    const count = unit && stats?.[unit];
    const knownCount = Number.isSafeInteger(count) && count >= 0;
    const fullCount = knownCount ? `${count} ${count === 1 ? unit.slice(0, -1) : unit}` : "";
    const shortCount = knownCount ? `${count}${unit === "lines" ? "L" : "ed"}` : "";
    return [
        [fullCount, elapsed].filter(Boolean).join(" · "),
        [shortCount, elapsed].filter(Boolean).join(" "),
        elapsed,
    ].filter(Boolean);
}

/** Budget for inline metrics first; paths yield before counts, then counts before time. */
function actionTitle(title, heading, component, width) {
    const variants = metricVariants(component);
    const minimumTitle = Math.min(visibleWidth(heading), width < 20 ? 3 : 12);
    const candidates = width < 60 ? variants.slice(1) : variants;
    let metrics = candidates.find(value => visibleWidth(value) + 1 + minimumTitle <= width);
    // On tiny rows, even the tool glyph/label yields to status plus the last metric.
    const smallest = candidates.at(-1);
    if (!metrics && smallest && visibleWidth(smallest) + 2 <= width) metrics = smallest;
    if (!metrics) return truncateToWidth(title, width, width < 4 ? "" : "...");
    const leftWidth = width - visibleWidth(metrics) - 1;
    const left = truncateToWidth(title, leftWidth, leftWidth < 4 ? "" : "…");
    return left + " " + theme.fg("muted", metrics);
}

/** Return compact text only; expanded bodies always come from the native renderer. */
export function actionLines(component, width) {
    const nativeAction = Object.hasOwn(NATIVE_ACTIONS, component.toolName);
    const [glyph, label] = toolAction(component);
    const { status, color, notice } = toolState(component);
    const target = nativeAction
        ? targetFor(component) || (component.argsComplete ? "" : "…")
        : invocationText(component, width);
    const shownLabel = width < 60 ? label : label.padEnd(6);
    const heading = theme.fg(color, status) + " " + theme.fg("accent", glyph)
        + " " + theme.bold(theme.fg("muted", shownLabel));
    const title = heading + " " + theme.fg("text", target);
    const metrics = metricVariants(component)[0];
    const targetColumn = visibleWidth(heading) + 1;
    const lines = component.expanded && !nativeAction && width > targetColumn
        ? wrapTextWithAnsi(theme.fg("text", target) + (metrics ? " " + theme.fg("muted", metrics) : ""), width - targetColumn)
            .map((line, i) => (i === 0 ? heading + " " : " ".repeat(targetColumn)) + line)
        : [actionTitle(title, heading, component, width)];

    if (notice) {
        lines.push(truncateToWidth("  " + theme.fg(color === "error" ? "error" : "warning", redactUrls(notice)), width));
    }
    return lines;
}

/**
 * Keep the native flat child list: expansion, theme invalidation and history replay
 * continue to reach the exact same components. Group only adjacent visible tools;
 * never move prose, custom messages or tool results to manufacture a cleaner turn.
 */
export class TranscriptContainer extends Container {
    constructor(getPadding = () => 1, getRows = () => Infinity) {
        super();
        this.getPadding = getPadding;
        this.getRows = getRows;
    }

    handleMouse(event) {
        if (this.mouseLayout?.width !== event.width) this.render(event.width);
        return super.handleMouse(event);
    }

    render(width) {
        const lines = [];
        const actions = [];
        const mouseChildren = [];
        let mouseHeight = 0;
        const padding = Math.min(Math.max(0, this.getPadding()), Math.max(0, width - 1));
        const bodyPadding = width < 80
            ? transcriptPadding(padding, width)
            : Math.min(padding + 2, Math.max(0, width - 1));
        const tight = this.getRows() < 24;
        const indent = " ".repeat(bodyPadding);
        let speaker;

        const flushActions = () => {
            if (!actions.length) return;
            if (speaker !== "pi") {
                if (!tight) lines.push("");
                lines.push(speakerHeader("Pi", undefined, padding, width));
                speaker = "pi";
            }
            if (!tight) lines.push("");
            const grouped = actions.length > 1;
            if (grouped) {
                lines.push(truncateToWidth(indent + theme.fg("muted", `${actions.length} actions`), width));
            }
            for (let i = 0; i < actions.length; i++) {
                const isLast = i === actions.length - 1;
                let branch = "";
                let continuation = "";
                if (width - bodyPadding >= 6) {
                    // Keep status and label columns fixed as a singleton grows into a tree.
                    branch = !grouped ? "   " : isLast ? "╰─ " : "├─ ";
                    continuation = isLast ? "   " : "│  ";
                }
                const rows = actionLines(actions[i], Math.max(1, width - bodyPadding - branch.length));
                for (let row = 0; row < rows.length; row++) {
                    const connector = row === 0 ? branch : continuation;
                    lines.push(indent + theme.fg("borderMuted", connector) + rows[row]);
                }
            }
            actions.length = 0;
        };

        for (const child of this.children) {
            // Recompute on every render: removing/clearing/replaying children must
            // not leave a cached speaker identity behind.
            if (child.transcriptRole === "pi") {
                child.transcriptHeader = speaker !== "pi" && actions.length === 0;
            }
            if (child.transcriptRole === "pi" || child.transcriptRole === "user") {
                child.transcriptTight = tight;
            }
            if (child.transcriptRole === "tool") {
                const defaultTextBody = child.getRenderShell?.() === "default"
                    && !child.result?.content?.some(part => part.type === "image");
                const nativePadding = defaultTextBody
                    ? Math.min(bodyPadding, Math.max(0, Math.floor((width - 1) / 2)))
                    : 1;
                // ponytail: pinned 0.84.2 Box/Text fields; use setters if upstream adds them.
                // Only the host shell changes, never extension-owned framing or image rows.
                for (const body of [child.contentBox, child.contentText]) {
                    if (body && body.paddingX !== nativePadding) {
                        body.paddingX = nativePadding;
                        body.invalidate();
                    }
                }
            }
            // Reuse the host's image components: capability checks, conversion and
            // protocol bytes stay native, without bringing back custom text cards.
            const nativeLines = child.transcriptRole === "tool" && !child.expanded
                ? (child.imageComponents ?? []).flatMap((image, i) => [
                    ...(child.imageSpacers?.[i]?.render(width) ?? []), ...image.render(width),
                ])
                : child.render(width);
            if (child.transcriptRole === "tool") actions.push(child);
            if (!nativeLines.length) continue;

            flushActions();
            const nativeStart = lines.length;
            lines.push(...nativeLines);
            if (child.transcriptRole !== "tool" || child.expanded) {
                // Synthetic rows and collapsed images must never route clicks into hidden cards.
                if (nativeStart > mouseHeight) mouseChildren.push({ component: {}, height: nativeStart - mouseHeight });
                mouseChildren.push({ component: child, height: nativeLines.length });
                mouseHeight = lines.length;
            }
            if (child.transcriptRole === "pi") speaker = "pi";
            else if (child.transcriptRole === "user") {
                speaker = "user";
                // Match the textarea's body gutter on both sides.
                lines.push(...USER_SEPARATOR.render(Math.max(1, width - bodyPadding * 2))
                    .map(line => indent + line + indent));
            }
            else if (child.transcriptRole !== "tool") speaker = undefined;
        }
        flushActions();
        if (lines.length > mouseHeight) mouseChildren.push({ component: {}, height: lines.length - mouseHeight });
        this.mouseLayout = { width, children: mouseChildren };
        return lines;
    }
}
