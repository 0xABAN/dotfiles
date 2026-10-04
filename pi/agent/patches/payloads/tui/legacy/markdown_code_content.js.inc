        const codeBlockBgFn = this.theme.codeBlockBackground;
        for (const line of wrappedLines) {
            if (isImageLine(line)) {
                contentLines.push(line);
                continue;
            }
            const isCodeBlockLine = line.includes(CODE_BLOCK_MARKER);
            const lineWithoutMarker = line.replaceAll(CODE_BLOCK_MARKER, "");
            const lineWithMargins = leftMargin + lineWithoutMarker + rightMargin;
            if (isCodeBlockLine && codeBlockBgFn) {
                contentLines.push(applyBackgroundToLine(lineWithMargins, width, codeBlockBgFn));
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
