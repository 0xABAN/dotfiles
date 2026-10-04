// configs:pi-extension-dialogs-v1
import { Container, CURSOR_MARKER, Editor, Input, Text, sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.js";

/** Clamp a tiny viewport around the real cursor, without changing input state. */
function fitDialogLine(line, width) {
    if (visibleWidth(line) <= width) return line;
    const marker = line.indexOf(CURSOR_MARKER);
    if (marker < 0) return truncateToWidth(line, width, "…");

    const column = visibleWidth(line.slice(0, marker));
    const start = Math.max(0, column - width + 1);
    const clean = line.replace(CURSOR_MARKER, "");
    const before = sliceByColumn(clean, start, column - start, true);
    const after = sliceByColumn(clean, column, width - visibleWidth(before), true);
    return before + CURSOR_MARKER + after;
}

/** One fixed body gutter after the host's existing outer viewport inset. */
export class ExtensionDialogContainer extends Container {
    render(width) {
        if (width <= 0) return [];
        const padding = Math.min(3, Math.max(0, Math.floor((width - 2) / 2)));
        const inner = width - padding * 2;
        const gutter = " ".repeat(padding);
        // Input needs three columns for its IME marker. Editor's native wrapper
        // recurses on a two-column grapheme when its content width is only one.
        // At these tiny widths, render a safe viewport then crop around the caret;
        // do not mutate padding, text, selection, focus or keyboard handlers.
        const lines = this.children.flatMap(child => {
            const minimum = child instanceof Editor ? child.getPaddingX() * 2 + 3
                : child instanceof Input ? 3 : 1;
            return child.render(Math.max(minimum, inner));
        });
        return lines.map(line => gutter + fitDialogLine(line, inner));
    }
}

/** Titles, options and key hints resolve their ANSI on every render. */
export class DialogText {
    constructor(display) {
        this.display = display;
        this.content = new Text("", 0, 0);
    }
    render(width) {
        this.content.setText(this.display());
        return this.content.render(width);
    }
    invalidate() {
        this.content.invalidate();
    }
}

export function dialogHeading(text) {
    return theme.fg("accent", "◈ ") + theme.fg("muted", theme.bold(text));
}

/** Keep the native top/bottom separators, with quiet rounded endpoints. */
export class DialogBorder {
    constructor(bottom = false) {
        this.bottom = bottom;
    }
    render(width) {
        if (width <= 0) return [];
        const line = width === 1 ? "─"
            : (this.bottom ? "╰" : "╭") + "─".repeat(width - 2) + (this.bottom ? "╯" : "╮");
        return [theme.fg("borderMuted", line)];
    }
    invalidate() {}
}
