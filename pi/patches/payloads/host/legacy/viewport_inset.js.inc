    // configs:pi-horizontal-inset-v1
    getHorizontalInset(width = this.terminal.columns) {
        return width < 16 ? 0 : Math.max(1, Math.floor(width * 0.02));
    }
    insetLines(lines, width) {
        const padding = " ".repeat(this.getHorizontalInset(width));
        // Empty image-reservation rows must remain empty. Never slice image or
        // cursor escape payloads here; components already receive the inner width.
        return lines.map((line) => line ? padding + line : line);
    }
    resetRenderState() { }