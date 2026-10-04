// configs:pi-compact-layout-v1
import { Spacer } from "@earendil-works/pi-tui";

/** Share one short-window preview budget; package renderers decide what to show.
 * Only our activity widgets participate. Unknown extensions keep their contract.
 * Read live maps and rows so resize/removal never leaves a stale allocation.
 */
export function installActivityBudget(tui, above, below) {
    tui.configsActivityRows = () => {
        const rows = tui.terminal.rows;
        if (!Number.isFinite(rows) || rows >= 24) return Infinity;
        const count = ["rpiv-todos", "agents"].filter(key => above.has(key) || below.has(key)).length;
        return Math.max(1, Math.floor(Math.floor(rows / 3) / Math.max(1, count)));
    };
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
