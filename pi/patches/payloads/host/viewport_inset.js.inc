    // configs:pi-horizontal-inset-v1
    getHorizontalInset(width = this.terminal.columns) {
        return width < 16 ? 0 : Math.max(1, Math.floor(width * 0.02));
    }
    insetLines(lines, width) {
        const padding = " ".repeat(this.getHorizontalInset(width));
        // Empty image-reservation rows must remain empty. Never slice image or
        // cursor escape payloads here; components already receive the inner width.
        return lines.map((line) => {
            if (!line) return line;
            // OSC 133 prompt starts must stay at column zero: Ghostty otherwise
            // advances to a fresh line, leaving the old editor border behind.
            const markers = line.match(/^(?:\x1b\]133;[ABC](?:\x07|\x1b\\))+/)?.[0] ?? "";
            return markers + padding + line.slice(markers.length);
        });
    }
    resetRenderState() { }