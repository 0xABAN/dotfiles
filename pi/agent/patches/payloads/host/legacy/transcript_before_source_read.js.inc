// configs:pi-transcript-v1
// Display only: native components still own execution, expansion, images and state.
import { Container, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

const USER_SEPARATOR = new DynamicBorder(line => theme.fg("toolOutput", line));

const ACTIONS = {
    read: ["□", "Read"],
    edit: ["◈", "Edit"],
    write: ["◇", "Write"],
    bash: ["↯", "Run"],
    grep: ["◎", "Search"],
    find: ["⊙", "Find"],
    ls: ["▧", "List"],
};

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

function canCompact(component, nativeLines) {
    if (component.transcriptRole !== "tool" || component.expanded || component.hideComponent) return false;
    // Custom interactive renderers and image output keep their native presentation.
    if (component.result?.content?.some(part => part.type === "image")) return false;
    if ((component.toolDefinition?.renderCall || component.toolDefinition?.renderResult)
        && component.toolDefinition.configsTranscriptCompact !== true) return false;
    // Empty custom bodies still get an invocation row, but no invented result body.
    return nativeLines.some(line => plain(line));
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
        case "bash": return plain(args.command);
        case "grep":
        case "find": return [plain(args.pattern), plain(args.path)].filter(Boolean).join(" · ");
        case "ls": return plain(args.path) || ".";
        default: return "";
    }
}

/** Only native producer metadata supplies counts: no banner/filename/diff heuristics. */
function metricVariants(component) {
    if (!component.result || component.isPartial) return [];
    const duration = component.transcriptDurationMs;
    const elapsed = Number.isFinite(duration) && duration >= 0
        ? duration < 100 ? "<0.1s" : `${(duration / 1000).toFixed(1)}s`
        : "";
    const stats = component.result.isError ? undefined : component.result.details?.configsTranscript;
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
    const nativeAction = Object.hasOwn(ACTIONS, component.toolName) ? ACTIONS[component.toolName] : undefined;
    const [glyph, label] = nativeAction ?? ["⌇", "Tool"];
    const failed = component.result?.isError;
    const complete = component.result && !component.isPartial;
    const status = failed ? "×" : complete ? "✓" : component.executionStarted ? "◌" : "○";
    const color = failed ? "error" : complete ? "muted" : "accent";
    // Generic rows identify the invocation without exposing arbitrary extension arguments.
    const target = nativeAction
        ? targetFor(component) || (component.argsComplete ? "" : "…")
        : plain(component.toolName) || "unknown";
    const shownLabel = width < 60 ? label : label.padEnd(6);
    const heading = theme.fg(color, status) + " " + theme.fg("accent", glyph)
        + " " + theme.bold(theme.fg("muted", shownLabel));
    const title = heading + " " + theme.fg("text", target);
    const lines = [actionTitle(title, heading, component, width)];

    if (failed) {
        const text = component.result.content?.find(part => part.type === "text" && part.text?.trim())?.text;
        const firstLine = text?.split(/\r?\n/).find(line => plain(line));
        lines.push(truncateToWidth("  " + theme.fg("error", plain(firstLine) || "Tool failed; expand for details."), width));
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

    render(width) {
        const lines = [];
        const actions = [];
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
            const nativeLines = child.render(width);
            if (child.transcriptRole === "tool") {
                // Every call keeps its row, even when its renderer is silent. Custom,
                // image and expanded bodies stay intact immediately below that row.
                actions.push(child);
                if (canCompact(child, nativeLines)) continue;
            }
            if (!nativeLines.length) continue;

            flushActions();
            lines.push(...nativeLines);
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
        return lines;
    }
}
