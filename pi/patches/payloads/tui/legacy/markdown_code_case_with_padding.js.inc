            case "code": {
                const indent = this.theme.codeBlockIndent ?? "  ";
                const renderCodeLine = (line) => `${CODE_BLOCK_MARKER}${indent}${line}`;
                lines.push(renderCodeLine(""));
                if (this.theme.highlightCode) {
                    const highlightedLines = this.theme.highlightCode(token.text, token.lang);
                    for (const hlLine of highlightedLines) {
                        lines.push(renderCodeLine(hlLine));
                    }
                }
                else {
                    // Split code by newlines and style each line
                    const codeLines = token.text.split("\n");
                    for (const codeLine of codeLines) {
                        lines.push(renderCodeLine(this.theme.codeBlock(codeLine)));
                    }
                }
                lines.push(renderCodeLine(""));
                if (nextTokenType && nextTokenType !== "space") {
                    lines.push(""); // Add spacing after code blocks (unless space token follows)
                }
                break;
            }
