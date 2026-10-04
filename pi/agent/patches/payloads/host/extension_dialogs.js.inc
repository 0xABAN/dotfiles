// configs:pi-extension-dialogs-v2
import { Container, CURSOR_MARKER, Editor, Input, ScrollView, Spacer, Text, sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
// Pi 0.84.2 exposes the layout engine here, not from its public barrel.
import { renderLayoutFrame } from "@earendil-works/pi-tui/dist/layout.js";
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

/** Responsive chrome around unchanged native selection and input components. */
export class ExtensionDialogContainer extends Container {
    constructor(terminalRows = () => undefined) {
        super();
        // Capture the stable TUI owner, not its swappable backing renderer or a
        // snapshot of rows. The supplied closure follows resizes and screen modes.
        this.terminalRows = terminalRows;
        this.bodyLines = [];
        this.bodyViewport = new ScrollView({ render: () => this.bodyLines, invalidate() {} });
    }

    render(width) {
        if (width <= 0) return [];
        const rows = this.terminalRows() ?? Infinity;
        const short = rows < 24;
        const padding = Math.min(width < 80 ? 1 : 3, Math.max(0, Math.floor((width - 2) / 2)));
        const inner = width - padding * 2;
        const gutter = " ".repeat(padding);
        const body = this.listContainer ?? this.input ?? this.editor;
        // Short-window activity budgets reserve this native editor slot. Keep
        // replacement dialogs inside it, leaving both widget summaries and the
        // footer visible. This does not change Editor's own viewport formula.
        const budget = short ? Math.max(5, Math.floor(rows * 0.3)) + 2 : Math.max(1, rows - 2);

        // Input needs three columns for its IME marker. Editor's native wrapper
        // recurses on a two-column grapheme when its content width is only one.
        const rendered = this.children.map(child => {
            const minimum = child instanceof Editor ? child.getPaddingX() * 2 + 3
                : child instanceof Input ? 3 : 1;
            return { child, lines: child.render(Math.max(minimum, inner), short) };
        });
        const overflowing = rendered.reduce((count, part) => count + part.lines.length, 0) > budget;
        const parts = rendered.filter(({ child }) => {
            if ((short || overflowing) && child instanceof Spacer) return false;
            // The editor already has native borders (including scroll counts).
            if (short && body instanceof Editor && child instanceof DialogBorder) return false;
            return true;
        });
        const content = parts.find(part => part.child === body);
        if (content) {
            const chromeRows = parts.reduce((count, part) => count + (part === content ? 0 : part.lines.length), 0);
            const height = Math.max(1, budget - chromeRows);
            if (content.lines.length > height) {
                this.bodyLines = content.lines.map(line => fitDialogLine(line, inner));
                this.bodyViewport.updateLayout(this.bodyLines.length, height, () => {});
                // Native selection indices stay authoritative. Measure wrapped
                // options so the entire selected row, when it fits, is visible.
                let start = content.lines.findIndex(line => line.includes(CURSOR_MARKER));
                let end = start + 1;
                if (body === this.listContainer) {
                    const sizes = body.children.map(child => child.render(inner).length);
                    start = sizes.slice(0, this.selectedIndex).reduce((sum, size) => sum + size, 0);
                    end = start + (sizes[this.selectedIndex] ?? 1);
                }
                const top = this.bodyViewport.scrollTop;
                if (start >= 0) {
                    if (start < top || end - start > height) this.bodyViewport.scrollTo(start);
                    else if (end > top + height) this.bodyViewport.scrollTo(end - height);
                }
                content.lines = renderLayoutFrame(this.bodyViewport, inner, height, () => {}).lines;
            }
        }
        return parts.flatMap(part => part.lines).map(line => gutter + fitDialogLine(line, inner));
    }
}

/** Titles, options and key hints resolve their ANSI on every render. */
export class DialogText {
    constructor(display, compactDisplay = display) {
        this.display = display;
        this.compactDisplay = compactDisplay;
        this.content = new Text("", 0, 0);
    }
    render(width, compact = false) {
        this.content.setText((compact ? this.compactDisplay : this.display)());
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
