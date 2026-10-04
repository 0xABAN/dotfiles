// configs:pi-activity-notices-v1
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

/** Keep wrapped notices aligned while retaining native status coalescing. */
export class ActivityNotice {
    constructor(text, getPadding) {
        this.content = new Text(text, 0, 0);
        this.getPadding = getPadding;
    }
    setText(text) {
        this.content.setText(text);
    }
    invalidate() {
        this.content.invalidate();
    }
    render(width) {
        if (width <= 0) return [];
        const padding = Math.min(Math.max(0, this.getPadding()), Math.max(0, Math.floor((width - 2) / 2)));
        const gutter = " ".repeat(padding);
        const innerWidth = width - padding * 2;
        return this.content.render(innerWidth)
            .map(line => gutter + truncateToWidth(line, innerWidth, "") + gutter);
    }
}
