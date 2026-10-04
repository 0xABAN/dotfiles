// configs:pi-transcript-v1
// Display only: native components still own execution, expansion, images and state.
import { Container, stripTerminalSequences, truncateToWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";

const ACTIONS = {
    read: ["□", "Read"],
    edit: ["◈", "Edit"],
    write: ["◇", "Write"],
    bash: ["↯", "Run"],
    grep: ["◎", "Search"],
    find: ["⊙", "Find"],
    ls: ["▧", "List"],
};

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
    // Respect renderers which intentionally hide a tool (including pi-pretty).
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
        default: return plain(args.path ?? args.query ?? args.command ?? args.url ?? args.description);
    }
}

/** Return compact text only; expanded bodies always come from the native renderer. */
export function actionLines(component, width) {
    const [glyph, label] = ACTIONS[component.toolName] ?? ["⧉", plain(component.toolName) || "Tool"];
    const failed = component.result?.isError;
    const complete = component.result && !component.isPartial;
    const status = failed ? "×" : complete ? "✓" : component.executionStarted ? "◌" : "○";
    const color = failed ? "error" : complete ? "muted" : "accent";
    const target = targetFor(component) || (component.argsComplete ? "" : "…");
    const shownLabel = width < 60 ? label : label.padEnd(6);
    const title = theme.fg(color, status) + " " + theme.fg("accent", glyph)
        + " " + theme.fg("muted", shownLabel) + " " + theme.fg("text", target);
    const lines = [truncateToWidth(title, width)];

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
            lines.push(truncateToWidth(indent + theme.fg("muted", `${actions.length} action${actions.length === 1 ? "" : "s"}`), width));
            for (let i = 0; i < actions.length; i++) {
                const isLast = i === actions.length - 1;
                let branch = "";
                let continuation = "";
                if (width - bodyPadding >= 6) {
                    branch = isLast ? "╰─ " : "├─ ";
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
            const nativeLines = child.render(width);
            if (canCompact(child, nativeLines)) {
                actions.push(child);
                continue;
            }
            if (!nativeLines.length) continue;

            flushActions();
            lines.push(...nativeLines);
            if (child.transcriptRole === "pi") speaker = "pi";
            else if (child.transcriptRole === "user") speaker = "user";
            else if (child.transcriptRole !== "tool") speaker = undefined;
        }
        flushActions();
        return lines;
    }
}
