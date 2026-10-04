// configs:pi-compact-layout-v1
import { Container, Spacer } from "@earendil-works/pi-tui";

/** Share one short-window preview budget; package renderers decide what to show.
 * Only our activity widgets participate. Unknown extensions keep their contract.
 * Read live maps and rows so resize/removal never leaves a stale allocation.
 */
export function installActivityBudget(tui, above, below) {
    tui.configsActivityRows = () => {
        const rows = tui.terminal.rows;
        if (!Number.isFinite(rows) || rows >= 24) return Infinity;
        const count = ["rpiv-todos", "agents"].filter(key => above.has(key) || below.has(key)).length;
        // Reserve the native editor's maximum visible input plus its frame,
        // then footer/conversation space. At the smallest heights each widget
        // still gets one summary; unbounded custom docks are outside this budget.
        const editorRows = Math.max(5, Math.floor(rows * 0.3)) + 2;
        const available = Math.min(Math.floor(rows / 3), rows - editorRows - 3);
        return Math.max(1, Math.floor(available / Math.max(1, count)));
    };
}

/** Powerline's real footer is blank; its information lives in widgets. */
export class CompactFooter extends Container {
    constructor(tui) {
        super();
        this.tui = tui;
    }
    render(width) {
        const lines = super.render(width);
        return this.tui.terminal.rows < 24 && lines.every(line => line === "") ? [] : lines;
    }
}

/** Remove host-owned breathing room, never a widget's content or native cursor. */
export class CompactWidgetSpacer extends Spacer {
    constructor(tui) {
        super(1);
        this.tui = tui;
    }
    render(width) {
        return this.tui.terminal.rows < 24 ? [] : super.render(width);
    }
}
