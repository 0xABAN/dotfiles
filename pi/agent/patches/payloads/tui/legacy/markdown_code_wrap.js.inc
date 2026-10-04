        for (const line of renderedLines) {
            if (isImageLine(line)) {
                wrappedLines.push(line);
            }
            else {
                const isCodeBlockLine = line.includes(CODE_BLOCK_MARKER);
                const lineWithoutMarker = line.replaceAll(CODE_BLOCK_MARKER, "");
                for (const wrappedLine of wrapTextWithAnsi(lineWithoutMarker, contentWidth)) {
                    wrappedLines.push(isCodeBlockLine ? CODE_BLOCK_MARKER + wrappedLine : wrappedLine);
                }
            }
        }
