        const codeBlockBgFn = this.theme.codeBlockBackground;
        const codeBlockBorderFn = this.theme.codeBlockBorder;
        const panelWidth = Math.max(2, width - visibleWidth(leftMargin) - visibleWidth(rightMargin));
        const panelInnerWidth = Math.max(0, panelWidth - 2);
        for (const line of wrappedLines) {
            if (isImageLine(line)) {
                contentLines.push(line);
                continue;
            }
            const codeBlockMarker = line.startsWith(CODE_BLOCK_TOP_MARKER)
                ? CODE_BLOCK_TOP_MARKER
                : line.startsWith(CODE_BLOCK_BOTTOM_MARKER)
                    ? CODE_BLOCK_BOTTOM_MARKER
                    : line.startsWith(CODE_BLOCK_MARKER) ? CODE_BLOCK_MARKER : "";
            const lineWithoutMarker = codeBlockMarker ? line.slice(codeBlockMarker.length) : line;
            const lineWithMargins = leftMargin + lineWithoutMarker + rightMargin;
            if (codeBlockMarker && codeBlockBgFn && codeBlockBorderFn) {
                let panelLine;
                if (codeBlockMarker === CODE_BLOCK_TOP_MARKER) {
                    panelLine = codeBlockBorderFn(`╭${"─".repeat(panelInnerWidth)}╮`);
                }
                else if (codeBlockMarker === CODE_BLOCK_BOTTOM_MARKER) {
                    panelLine = codeBlockBorderFn(`╰${"─".repeat(panelInnerWidth)}╯`);
                }
                else {
                    const contentPadding = Math.max(0, panelInnerWidth - visibleWidth(lineWithoutMarker));
                    const panelContent = lineWithoutMarker + " ".repeat(contentPadding);
                    panelLine = codeBlockBorderFn("│") + codeBlockBgFn(panelContent) + codeBlockBorderFn("│");
                }
                contentLines.push(leftMargin + panelLine + rightMargin);
            }
            else if (codeBlockMarker) {
                const visibleLen = visibleWidth(lineWithMargins);
                const paddingNeeded = Math.max(0, width - visibleLen);
                contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
            }
            else if (bgFn) {
                contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
            }
            else {
                // No background - just pad to width
                const visibleLen = visibleWidth(lineWithMargins);
                const paddingNeeded = Math.max(0, width - visibleLen);
                contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
            }
        }
