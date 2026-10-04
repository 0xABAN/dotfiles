    // configs:pi-horizontal-inset-v1
    renderInsetLayout(root, width, height) {
        const inset = this.getHorizontalInset(width);
        const frame = renderLayoutFrame(root, width - 2 * inset, height, () => this.requestRender());
        // Paint at x=0 first: native Kitty cropping depends on the full-width fast
        // path. Then move screen-space boxes, leaving scrollContentLines local.
        const translate = (box) => {
            box.rect.x += inset;
            box.clip.x += inset;
            for (const child of box.children) translate(child);
        };
        translate(frame.root);
        frame.width = width;
        frame.lines = this.insetLines(frame.lines, width);
        return frame;
    }
    getMountedRoots() {