// configs:pi-activity-notices-v2
import { truncateToWidth } from "@earendil-works/pi-tui";
import { ThemedText } from "./themed-text.js";

/** Keep native theme invalidation and status updates, adding only responsive gutters. */
export class ActivityNotice extends ThemedText {
    constructor(build, getPadding) {
        super(build, 0, 0);
        this.getPadding = getPadding;
    }
    render(width) {
        if (width <= 0) return [];
        const padding = Math.min(width < 80 ? 1 : Math.max(0, this.getPadding()), Math.max(0, Math.floor((width - 2) / 2)));
        const gutter = " ".repeat(padding);
        const innerWidth = width - padding * 2;
        return super.render(innerWidth)
            .map(line => gutter + truncateToWidth(line, innerWidth, "") + gutter);
    }
}
